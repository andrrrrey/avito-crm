// src/app/api/avito/webhook/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { publish } from "@/lib/realtime";
import { avitoGetChatInfo, avitoSendTextMessage, avitoGetItemInfo } from "@/lib/avito";
import { pickFirstString, pickFirstNumber } from "@/lib/utils";
import { getAssistantReply } from "@/lib/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireWebhookKey(req: Request) {
  if (env.NODE_ENV !== "production") return null; // dev: пропускаем, чтобы точно видеть запросы

  const url = new URL(req.url);
  const key =
    url.searchParams.get("key") ||
    req.headers.get("x-webhook-key") ||
    (req.headers.get("authorization")?.toLowerCase().startsWith("bearer ")
      ? req.headers.get("authorization")!.slice(7).trim()
      : null);

  if (!key || key !== env.CRM_WEBHOOK_KEY) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

function toDateMaybe(v: any): Date | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v * 1000);
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function extractChatDetailsFromAny(rootLike: any) {
  const root =
    rootLike?.payload?.value ??
    rootLike?.payload ??
    rootLike?.data?.value ??
    rootLike?.data ??
    rootLike?.value ??
    rootLike ??
    {};

  const ctx = root?.context?.value ?? root?.context ?? null;
  const item = ctx?.item ?? ctx?.ad ?? root?.item ?? root?.ad ?? ctx ?? root;

  const users: any[] = Array.isArray(root?.users)
    ? root.users
    : Array.isArray(root?.participants)
      ? root.participants
      : Array.isArray(root?.members)
        ? root.members
        : [];

  const myId = Number(env.AVITO_ACCOUNT_ID ?? 0);
  const other = users.find((u) => Number(u?.id) !== myId);

  const customerName =
    pickFirstString(
      other?.name,
      other?.public_name,
      other?.publicName,
      other?.login,
      root?.user?.name,
      root?.customer?.name
    ) ?? null;

  const itemTitle =
    pickFirstString(item?.title, item?.name, item?.item_title, ctx?.title, root?.title) ?? null;

  const adUrl =
    pickFirstString(item?.url, item?.ad_url, item?.adUrl, ctx?.url, root?.url) ?? null;

  const chatUrl = pickFirstString(root?.chat_url, root?.chatUrl) ?? null;

  // ✅ важное: itemId (чтобы потом тянуть price из /core)
  const itemId =
    pickFirstNumber(
      item?.id,
      item?.item_id,
      item?.itemId,
      ctx?.item_id,
      ctx?.itemId,
      root?.item_id,
      root?.itemId
    ) ?? null;

  return { customerName, itemTitle, adUrl, chatUrl, itemId, rawRoot: root };
}

const DEV_TEST_BOT_CUSTOMER = "Вадим Ли";
const DEV_TEST_BOT_GREETING = "Здравствуйте!";
const DEV_ESCALATE_RE =
  /(?:перевед(?:и|ите)|передай(?:те)?|переключ(?:и|ите))\s+(?:на|к)\s+(?:оператор(?:а|у)?|менеджер(?:а|у)?)(?=\s|$|[.!?,:;])/iu;

function normHuman(s: string | null | undefined) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

async function tryFillChatPrice(chatId: string, itemId: number) {
  if (env.MOCK_MODE) return;

  const cur = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { price: true, itemTitle: true, adUrl: true, raw: true },
  });
  if (!cur) return;
  if (cur.price !== null && cur.price !== undefined) return;

  try {
    const info = await avitoGetItemInfo(itemId);
    const patch: any = {};
    if (info.price !== null && info.price !== undefined) patch.price = info.price;

    // бонус: если title/url вдруг пустые — тоже докинем
    if (!cur.itemTitle && info.title) patch.itemTitle = info.title;
    if (!cur.adUrl && info.url) patch.adUrl = info.url;

    if (!Object.keys(patch).length) return;

    const prevRaw = (cur.raw && typeof cur.raw === "object") ? (cur.raw as any) : {};
    patch.raw = {
      ...prevRaw,
      enrich: {
        ...(prevRaw.enrich ?? {}),
        price: {
          source: "avitoGetItemInfo",
          at: new Date().toISOString(),
          itemId,
        },
      },
    };

    await prisma.chat.update({ where: { id: chatId }, data: patch });

    publish({ type: "chat_updated", chatId });
  } catch {
    // молча: не валим вебхук
  }
}

async function runDevTestBotIfNeeded(args: {
  chatId: string;
  avitoChatId: string;
  incomingText: string;
  incomingMessageId?: string | null;
  incomingCreatedAtIso?: string | null;
  hintCustomerName?: string | null;
}) {
  if (env.NODE_ENV === "production") return;

  const chat = await prisma.chat.findUnique({
    where: { id: args.chatId },
    select: { id: true, avitoChatId: true, status: true, customerName: true, raw: true },
  });
  if (!chat?.avitoChatId) return;

  const rawObj = (chat.raw && typeof chat.raw === "object") ? (chat.raw as any) : {};
  const tb = (rawObj?.testBot && typeof rawObj.testBot === "object") ? rawObj.testBot : {};
  const lastInId = pickFirstString(tb?.lastInMessageId, tb?.lastHandledInMessageId) ?? null;

  const inId = args.incomingMessageId ? String(args.incomingMessageId) : null;
  if (inId && lastInId && String(lastInId) === inId) return;

  let customerName = chat.customerName ?? args.hintCustomerName ?? null;

  if (!customerName && !env.MOCK_MODE) {
    try {
      const info = await avitoGetChatInfo(chat.avitoChatId);
      const d = extractChatDetailsFromAny(info);
      customerName = d.customerName ?? null;

      if (customerName && !chat.customerName) {
        await prisma.chat.update({
          where: { id: chat.id },
          data: { customerName },
        });
      }
    } catch {}
  }

  if (normHuman(customerName) !== normHuman(DEV_TEST_BOT_CUSTOMER)) return;
  const t = String(args.incomingText ?? "").trim();
  if (chat.status === "MANAGER") return;

  if (DEV_ESCALATE_RE.test(t)) {
    await prisma.chat.update({
      where: { id: chat.id },
      data: {
        status: "MANAGER",
        raw: {
          ...rawObj,
          testBot: {
            ...tb,
            lastInMessageId: inId ?? tb?.lastInMessageId ?? null,
            lastInText: t,
            lastInAt: args.incomingCreatedAtIso ?? new Date().toISOString(),
            escalatedAt: new Date().toISOString(),
            reason: "operator_requested",
          },
        },
      },
    });

    publish({ type: "chat_updated", chatId: chat.id, avitoChatId: chat.avitoChatId });
    return;
  }

  try {
    if (env.MOCK_MODE) {
      const fakeId = `mock_out_${Date.now()}`;
      const sentAt = new Date();

      const ins = await prisma.message.createMany({
        data: [
          {
            chatId: chat.id,
            avitoMessageId: fakeId,
            direction: "OUT" as any,
            text: DEV_TEST_BOT_GREETING,
            sentAt,
            isRead: true,
            raw: { mock: true, from: "dev_test_bot" },
          },
        ],
        skipDuplicates: true,
      });

      await prisma.chat.update({
        where: { id: chat.id },
        data: {
          lastMessageAt: sentAt,
          lastMessageText: DEV_TEST_BOT_GREETING,
          raw: {
            ...rawObj,
            testBot: {
              ...tb,
              lastInMessageId: inId ?? tb?.lastInMessageId ?? null,
              lastInText: t,
              lastInAt: args.incomingCreatedAtIso ?? new Date().toISOString(),
              greetedAt: new Date().toISOString(),
            },
          },
        },
      });

      // ✅ если бот ответил — считаем входящие прочитанными (для превью/счетчика)
      await prisma.message.updateMany({
        where: { chatId: chat.id, direction: "IN", isRead: false, sentAt: { lte: sentAt } },
        data: { isRead: true },
      });

      const unread = await prisma.message.count({
        where: { chatId: chat.id, direction: "IN", isRead: false },
      });

      await prisma.chat.update({ where: { id: chat.id }, data: { unreadCount: unread } });

      publish({ type: "chat_read", chatId: chat.id, avitoChatId: chat.avitoChatId });

      if (ins.count > 0) {
        publish({
          type: "message_created",
          chatId: chat.id,
          avitoChatId: chat.avitoChatId,
          messageId: fakeId,
          direction: "OUT",
          message: {
            id: fakeId,
            chatId: chat.id,
            direction: "OUT",
            text: DEV_TEST_BOT_GREETING,
            sentAt: sentAt.toISOString(),
            isRead: true,
          },
        });
      }

      publish({ type: "chat_updated", chatId: chat.id, avitoChatId: chat.avitoChatId });
      return;
    }

    const resp: any = await avitoSendTextMessage(chat.avitoChatId, DEV_TEST_BOT_GREETING);

    const outId =
      pickFirstString(resp?.id, resp?.message_id, resp?.value?.id, resp?.result?.id) ?? null;

    if (outId) {
      const sentAt = new Date();

      const ins = await prisma.message.createMany({
        data: [
          {
            chatId: chat.id,
            avitoMessageId: outId,
            direction: "OUT" as any,
            text: DEV_TEST_BOT_GREETING,
            sentAt,
            isRead: true,
            raw: { from: "dev_test_bot", avitoSendResp: resp },
          },
        ],
        skipDuplicates: true,
      });

      await prisma.chat.update({
        where: { id: chat.id },
        data: {
          lastMessageAt: sentAt,
          lastMessageText: DEV_TEST_BOT_GREETING,
          raw: {
            ...rawObj,
            testBot: {
              ...tb,
              lastInMessageId: inId ?? tb?.lastInMessageId ?? null,
              lastInText: t,
              lastInAt: args.incomingCreatedAtIso ?? new Date().toISOString(),
              greetedAt: new Date().toISOString(),
            },
          },
        },
      });

      // ✅ если бот ответил — считаем входящие прочитанными (для превью/счетчика)
      await prisma.message.updateMany({
        where: { chatId: chat.id, direction: "IN", isRead: false, sentAt: { lte: sentAt } },
        data: { isRead: true },
      });

      const unread = await prisma.message.count({
        where: { chatId: chat.id, direction: "IN", isRead: false },
      });

      await prisma.chat.update({ where: { id: chat.id }, data: { unreadCount: unread } });

      publish({ type: "chat_read", chatId: chat.id, avitoChatId: chat.avitoChatId });

      if (ins.count > 0) {
        const dbMsg = await prisma.message.findUnique({
          where: { chatId_avitoMessageId: { chatId: chat.id, avitoMessageId: outId } },
          select: { id: true },
        });

        publish({
          type: "message_created",
          chatId: chat.id,
          avitoChatId: chat.avitoChatId,
          messageId: dbMsg?.id ?? outId,
          direction: "OUT",
          message: {
            id: dbMsg?.id ?? outId,
            chatId: chat.id,
            direction: "OUT",
            text: DEV_TEST_BOT_GREETING,
            sentAt: sentAt.toISOString(),
            isRead: true,
          },
        });
      }

      publish({ type: "chat_updated", chatId: chat.id, avitoChatId: chat.avitoChatId });
    }
  } catch {}
}

/** AI-ассистент: если чат в статусе BOT и ассистент включён — отвечаем через ChatGPT */
async function tryAiAssistantReply(args: {
  chatId: string;
  avitoChatId: string;
  incomingText: string;
}) {
  // Проверяем, что чат в статусе BOT
  const chat = await prisma.chat.findUnique({
    where: { id: args.chatId },
    select: { id: true, avitoChatId: true, status: true, raw: true },
  });
  if (!chat) {
    console.log("[AI] Skip: chat not found", { chatId: args.chatId });
    return;
  }
  if (chat.status !== "BOT") {
    console.log("[AI] Skip: chat status is not BOT", { chatId: args.chatId, status: chat.status });
    return;
  }

  const text = (args.incomingText ?? "").trim();
  if (!text) {
    console.log("[AI] Skip: empty incoming text", { chatId: args.chatId });
    return;
  }

  let replyText: string | null = null;
  try {
    replyText = await getAssistantReply(chat.id, text);
  } catch (e) {
    console.error("[AI] getAssistantReply error:", e);
    return;
  }
  if (!replyText) return;

  // Отправляем ответ
  const sentAt = new Date();
  const rawObj = (chat.raw && typeof chat.raw === "object") ? (chat.raw as Record<string, unknown>) : {};

  if (env.MOCK_MODE) {
    const fakeId = `ai_out_${Date.now()}`;
    const ins = await prisma.message.createMany({
      data: [{
        chatId: chat.id,
        avitoMessageId: fakeId,
        direction: "OUT" as const,
        text: replyText,
        sentAt,
        isRead: true,
        raw: { mock: true, from: "ai_assistant" },
      }],
      skipDuplicates: true,
    });

    await prisma.chat.update({
      where: { id: chat.id },
      data: { lastMessageAt: sentAt, lastMessageText: replyText },
    });

    // Помечаем входящие прочитанными
    await prisma.message.updateMany({
      where: { chatId: chat.id, direction: "IN", isRead: false, sentAt: { lte: sentAt } },
      data: { isRead: true },
    });
    const unread = await prisma.message.count({
      where: { chatId: chat.id, direction: "IN", isRead: false },
    });
    await prisma.chat.update({ where: { id: chat.id }, data: { unreadCount: unread } });

    publish({ type: "chat_read", chatId: chat.id, avitoChatId: chat.avitoChatId });

    if (ins.count > 0) {
      publish({
        type: "message_created",
        chatId: chat.id,
        avitoChatId: chat.avitoChatId,
        messageId: fakeId,
        direction: "OUT",
        message: {
          id: fakeId,
          chatId: chat.id,
          direction: "OUT",
          text: replyText,
          sentAt: sentAt.toISOString(),
          isRead: true,
        },
      });
    }
    publish({ type: "chat_updated", chatId: chat.id, avitoChatId: chat.avitoChatId });
    return;
  }

  // REAL MODE — отправляем в Avito
  try {
    const resp: any = await avitoSendTextMessage(chat.avitoChatId, replyText);
    const outId = pickFirstString(
      resp?.id,
      resp?.message_id,
      resp?.value?.id,
      resp?.result?.id,
    ) ?? `ai_${Date.now()}`;

    const ins = await prisma.message.createMany({
      data: [{
        chatId: chat.id,
        avitoMessageId: outId,
        direction: "OUT" as const,
        text: replyText,
        sentAt,
        isRead: true,
        raw: { from: "ai_assistant", avitoSendResp: resp ?? {} },
      }],
      skipDuplicates: true,
    });

    await prisma.chat.update({
      where: { id: chat.id },
      data: { lastMessageAt: sentAt, lastMessageText: replyText },
    });

    // Помечаем входящие прочитанными
    await prisma.message.updateMany({
      where: { chatId: chat.id, direction: "IN", isRead: false, sentAt: { lte: sentAt } },
      data: { isRead: true },
    });
    const unread = await prisma.message.count({
      where: { chatId: chat.id, direction: "IN", isRead: false },
    });
    await prisma.chat.update({ where: { id: chat.id }, data: { unreadCount: unread } });

    publish({ type: "chat_read", chatId: chat.id, avitoChatId: chat.avitoChatId });

    if (ins.count > 0) {
      const dbMsg = await prisma.message.findUnique({
        where: { chatId_avitoMessageId: { chatId: chat.id, avitoMessageId: outId } },
        select: { id: true },
      });

      publish({
        type: "message_created",
        chatId: chat.id,
        avitoChatId: chat.avitoChatId,
        messageId: dbMsg?.id ?? outId,
        direction: "OUT",
        message: {
          id: dbMsg?.id ?? outId,
          chatId: chat.id,
          direction: "OUT",
          text: replyText,
          sentAt: sentAt.toISOString(),
          isRead: true,
        },
      });
    }

    publish({ type: "chat_updated", chatId: chat.id, avitoChatId: chat.avitoChatId });
  } catch (e) {
    console.error("[AI] Failed to send AI reply to Avito:", e);
  }
}

async function enrichChatFromAvitoIfMissing(chatId: string, avitoChatId: string) {
  const cur = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { customerName: true, itemTitle: true, adUrl: true, chatUrl: true, raw: true, price: true },
  });
  if (!cur) return;

  const needName = !cur.customerName;
  const needTitle = !cur.itemTitle;
  const needAdUrl = !cur.adUrl;
  const needChatUrl = !cur.chatUrl;

  if (!needName && !needTitle && !needAdUrl && !needChatUrl) return;

  const info = await avitoGetChatInfo(avitoChatId);
  const d = extractChatDetailsFromAny(info);

  const patch: any = {};
  if (needName && d.customerName) patch.customerName = d.customerName;
  if (needTitle && d.itemTitle) patch.itemTitle = d.itemTitle;
  if (needAdUrl && d.adUrl) patch.adUrl = d.adUrl;
  if (needChatUrl && d.chatUrl) patch.chatUrl = d.chatUrl;

  if (!Object.keys(patch).length) return;

  const prevRaw = (cur.raw && typeof cur.raw === "object") ? (cur.raw as any) : {};
  patch.raw = {
    ...prevRaw,
    enrich: {
      ...(prevRaw.enrich ?? {}),
      source: "avitoGetChatInfo",
      at: new Date().toISOString(),
      filled: Object.keys(patch).filter((k) => k !== "raw"),
    },
  };

  await prisma.chat.update({ where: { id: chatId }, data: patch });
}

export async function GET(req: Request) {
  return NextResponse.json({ ok: true, method: "GET" });
}

export async function HEAD(req: Request) {
  return new Response(null, { status: 200 });
}

export async function POST(req: Request) {
  const guard = requireWebhookKey(req);
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });

  const payload = (body as any).payload ?? (body as any).data ?? null;
  const type = String(payload?.type ?? (body as any).type ?? "");
  const value = payload?.value ?? payload ?? (body as any);

  const eventId = String((body as any).id ?? value?.id ?? "");
  const avitoChatId = value?.chat_id ?? value?.chatId ?? value?.chatID ?? null;
  const avitoMessageId = value?.id ?? value?.message_id ?? value?.messageId ?? null;
  const authorId = value?.author_id ?? value?.authorId ?? null;

  const createdAt = toDateMaybe(value?.created ?? value?.created_at ?? value?.timestamp) ?? new Date();
  const text = String(value?.content?.text ?? value?.content?.message?.text ?? value?.text ?? "");

  if (eventId) {
    await prisma.webhookEvent.createMany({
      data: [{ source: "AVITO", eventId, type: type ? type : null, payload: body }],
      skipDuplicates: true,
    });
  } else {
    await prisma.webhookEvent.create({
      data: { source: "AVITO", eventId: null, type: type ? type : null, payload: body },
    });
  }

  if (avitoChatId) {
    const accountIdNum = Number(env.AVITO_ACCOUNT_ID ?? 0);

    const direction =
      avitoMessageId && authorId && accountIdNum && Number(authorId) === accountIdNum ? "OUT" : "IN";

    const hints = extractChatDetailsFromAny(body);

    const res = await prisma.$transaction(async (tx) => {
      let chat = await tx.chat.findUnique({
        where: { avitoChatId: String(avitoChatId) },
        select: {
          id: true,
          avitoChatId: true,
          customerName: true,
          itemTitle: true,
          adUrl: true,
          chatUrl: true,
          status: true,
          raw: true,
          price: true,
        },
      });

      let chatWasCreated = false;

      if (!chat) {
        chatWasCreated = true;

        chat = await tx.chat.create({
          data: {
            avitoChatId: String(avitoChatId),
            accountId: accountIdNum,
            status: "BOT",
            customerName: hints.customerName,
            itemTitle: hints.itemTitle,
            adUrl: hints.adUrl,
            chatUrl: hints.chatUrl,
            raw: {
              createdFrom: "webhook",
              type,
              payload: body,
              itemId: hints.itemId ?? null,
            },
          },
          select: {
            id: true,
            avitoChatId: true,
            customerName: true,
            itemTitle: true,
            adUrl: true,
            chatUrl: true,
            status: true,
            raw: true,
            price: true,
          },
        });
      } else {
        const patch: any = {};
        if (!chat.customerName && hints.customerName) patch.customerName = hints.customerName;
        if (!chat.itemTitle && hints.itemTitle) patch.itemTitle = hints.itemTitle;
        if (!chat.adUrl && hints.adUrl) patch.adUrl = hints.adUrl;
        if (!chat.chatUrl && hints.chatUrl) patch.chatUrl = hints.chatUrl;

        // itemId кладем в raw один раз
        const prevRaw = (chat.raw && typeof chat.raw === "object") ? (chat.raw as any) : {};
        if (hints.itemId && !prevRaw.itemId) {
          patch.raw = { ...prevRaw, itemId: hints.itemId };
        }

        if (Object.keys(patch).length) {
          chat = await tx.chat.update({
            where: { id: chat.id },
            data: patch,
            select: {
              id: true,
              avitoChatId: true,
              customerName: true,
              itemTitle: true,
              adUrl: true,
              chatUrl: true,
              status: true,
              raw: true,
              price: true,
            },
          });
        }
      }

      let msgId: string | null = null;
      let created = false;

      if (avitoMessageId) {
        const ins = await tx.message.createMany({
          data: [
            {
              chatId: chat.id,
              avitoMessageId: String(avitoMessageId),
              direction: direction as any,
              text,
              sentAt: createdAt,
              isRead: direction === "OUT" ? true : false,
              raw: body,
            },
          ],
          skipDuplicates: true,
        });
        created = ins.count > 0;

        const existing = await tx.message.findUnique({
          where: { chatId_avitoMessageId: { chatId: chat.id, avitoMessageId: String(avitoMessageId) } },
          select: { id: true },
        });
        msgId = existing?.id ?? null;

        await tx.chat.update({
          where: { id: chat.id },
          data: {
            lastMessageAt: createdAt,
            lastMessageText: text,
            ...(created && direction === "IN" ? { unreadCount: { increment: 1 } } : {}),
          },
        });
      } else {
        await tx.chat.update({
          where: { id: chat.id },
          data: {
            ...(text
              ? {
                  lastMessageAt: createdAt,
                  lastMessageText: text,
                  unreadCount: { increment: 1 },
                }
              : {}),
            raw: {
              ...(((chat.raw && typeof chat.raw === "object") ? (chat.raw as any) : {}) as any),
              lastWebhookType: type,
              lastWebhookAt: new Date().toISOString(),
            },
          },
        });
      }

      const needsEnrich = !chat.customerName || !chat.itemTitle || !chat.adUrl || !chat.chatUrl;

      return {
        chatId: chat.id,
        avitoChatId: chat.avitoChatId,
        messageId: msgId,
        direction,
        created,
        chatWasCreated,
        needsEnrich,
        itemId: hints.itemId ?? null,
      };
    });

    // ✅ СРАЗУ публикуем события — НЕ ждём обогащение/price,
    //    иначе SSE задерживается на секунды-минуты (Avito API медленный)
    if (res.created && res.messageId) {
      publish({
        type: "message_created",
        chatId: res.chatId,
        avitoChatId: res.avitoChatId,
        messageId: res.messageId,
        direction: res.direction as any,
        message: {
          id: res.messageId,
          chatId: res.chatId,
          direction: res.direction as any,
          text,
          sentAt: createdAt.toISOString(),
          isRead: res.direction === "OUT" ? true : false,
        },
      });
    }

    publish({ type: "chat_updated", chatId: res.chatId, avitoChatId: res.avitoChatId });

    // ✅ Обогащение и price — fire-and-forget, не блокируем ответ вебхука
    if (!env.MOCK_MODE && res.needsEnrich && res.avitoChatId) {
      enrichChatFromAvitoIfMissing(res.chatId, res.avitoChatId)
        .then(() => publish({ type: "chat_updated", chatId: res.chatId, avitoChatId: res.avitoChatId }))
        .catch((e) => console.warn("[webhook] enrichChatFromAvitoIfMissing error:", e));
    }

    if (!env.MOCK_MODE && res.itemId) {
      tryFillChatPrice(res.chatId, Number(res.itemId))
        .catch((e) => console.warn("[webhook] tryFillChatPrice error:", e));
    }

    // ✅ Dev-бот и AI-ассистент — fire-and-forget, чтобы не блокировать webhook
    if (res.direction === "IN" && res.avitoChatId) {
      runDevTestBotIfNeeded({
        chatId: res.chatId,
        avitoChatId: res.avitoChatId,
        incomingText: text,
        incomingMessageId: avitoMessageId ? String(avitoMessageId) : null,
        incomingCreatedAtIso: createdAt.toISOString(),
        hintCustomerName: hints.customerName,
      })
        .then(() =>
          tryAiAssistantReply({
            chatId: res.chatId,
            avitoChatId: res.avitoChatId,
            incomingText: text,
          }),
        )
        .catch((e) => console.error("[AI] tryAiAssistantReply error:", e));
    }
  }

  return NextResponse.json({ ok: true });
}
