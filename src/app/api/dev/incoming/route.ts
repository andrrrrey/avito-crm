import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { publish } from "@/lib/realtime";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireDev(req: Request) {
  if (process.env.NODE_ENV !== "development") return NextResponse.json({ ok: false }, { status: 404 });
  const token = req.headers.get("x-dev-token") ?? new URL(req.url).searchParams.get("token");
  if (!token || token !== env.DEV_TOKEN) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return null;
}

const Body = z.object({
  avitoChatId: z.string().optional(),
  chatId: z.string().optional(),
  text: z.string().min(1).max(4000),
});

function mockBotDecision(text: string) {
  const t = text.toLowerCase();
  const escalate =
    /(оператор|менеджер|человек|живой)/.test(t) ||
    /(скидк|дешевле|торг|уступ)/.test(t) ||
    t.length > 160;

  if (escalate) {
    return {
      type: "escalate" as const,
      reply: "Понял, передаю менеджеру. Он ответит в ближайшее время.",
      reason: "rule_escalate",
    };
  }

  return {
    type: "reply" as const,
    reply: "Здравствуйте! Спасибо за сообщение. Сейчас уточню и отвечу. Подскажите, вам удобнее самовывоз или доставка?",
  };
}

export async function POST(req: Request) {
  const auth = requireDev(req);
  if (auth) return auth;

  const autoBot = new URL(req.url).searchParams.get("autoBot") === "1";

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Bad body" }, { status: 400 });

  const { avitoChatId, chatId, text } = parsed.data;

  const chat =
    chatId
      ? await prisma.chat.findUnique({ where: { id: chatId } })
      : avitoChatId
        ? await prisma.chat.findUnique({ where: { avitoChatId } })
        : null;

  if (!chat) return NextResponse.json({ ok: false, error: "Chat not found" }, { status: 404 });

  const now = new Date();
  const inId = `dev_in_${now.getTime()}_${Math.random().toString(16).slice(2)}`;

  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // CUSTOMER -> IN
    const inMsg = await tx.message.create({
      data: {
        chatId: chat.id,
        avitoMessageId: inId,
        direction: "IN",
        text,
        sentAt: now,
        isRead: false,
        raw: { mock: true, source: "dev_incoming" },
      },
      select: { id: true, text: true, sentAt: true },
    });

    await tx.chat.update({
      where: { id: chat.id },
      data: {
        lastMessageAt: now,
        lastMessageText: text,
        unreadCount: { increment: 1 },
      },
    });

    let outMsg: { id: string; text: string; sentAt: Date } | null = null;

    // если авто-бот и чат в BOT — пишем ответ
    if (autoBot && chat.status === "BOT") {
      const decision = mockBotDecision(text);

      const botAt = new Date(Date.now() + 500);
      const outId = `dev_out_${botAt.getTime()}_${Math.random().toString(16).slice(2)}`;

      outMsg = await tx.message.create({
        data: {
          chatId: chat.id,
          avitoMessageId: outId,
          direction: "OUT",
          text: decision.reply,
          sentAt: botAt,
          isRead: true,
          raw: { mock: true, source: "dev_bot", decision: decision.type, reason: decision.reason },
        },
        select: { id: true, text: true, sentAt: true },
      });

      // обновляем превью чата последним сообщением (ботом)
      await tx.chat.update({
        where: { id: chat.id },
        data: {
          lastMessageAt: botAt,
          lastMessageText: decision.reply,
          ...(decision.type === "escalate" ? { status: "MANAGER" } : {}),
        },
      });

      // ✅ если бот ответил — значит он прочитал входящие (снимаем непрочитанность в превью)
      await tx.message.updateMany({
        where: { chatId: chat.id, direction: "IN", isRead: false, sentAt: { lte: botAt } },
        data: { isRead: true },
      });

      const unread = await tx.message.count({
        where: { chatId: chat.id, direction: "IN", isRead: false },
      });

      await tx.chat.update({ where: { id: chat.id }, data: { unreadCount: unread } });
    }

    return { inMsg, outMsg };
  });

  // realtime
  publish({
    type: "message_created",
    chatId: chat.id,
    avitoChatId: chat.avitoChatId,
    messageId: created.inMsg.id,
    direction: "IN",
    message: {
      id: created.inMsg.id,
      chatId: chat.id,
      direction: "IN",
      text: created.inMsg.text,
      sentAt: created.inMsg.sentAt.toISOString(),
      isRead: false,
    },
  });

  if (created.outMsg) {
    publish({
      type: "message_created",
      chatId: chat.id,
      avitoChatId: chat.avitoChatId,
      messageId: created.outMsg.id,
      direction: "OUT",
      message: {
        id: created.outMsg.id,
        chatId: chat.id,
        direction: "OUT",
        text: created.outMsg.text,
        sentAt: created.outMsg.sentAt.toISOString(),
        isRead: true,
      },
    });
  }

  if (created.outMsg) {
    publish({ type: "chat_read", chatId: chat.id, avitoChatId: chat.avitoChatId });
  }

  publish({ type: "chat_updated", chatId: chat.id, avitoChatId: chat.avitoChatId });

  return NextResponse.json({ ok: true, chatId: chat.id, avitoChatId: chat.avitoChatId });
}
