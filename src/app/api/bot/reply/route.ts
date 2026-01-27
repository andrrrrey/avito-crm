import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { avitoMarkChatRead } from "@/lib/avito";
import { publish } from "@/lib/realtime";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireBotToken(req: Request) {
  // в деве можно не задавать токен, чтобы не мешал разработке
  if (env.NODE_ENV !== "production" && !env.CRM_BOT_TOKEN) return null;

  const token = req.headers.get("x-crm-bot-token") ?? new URL(req.url).searchParams.get("token");

  if (!token || token !== env.CRM_BOT_TOKEN) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

const Body = z.object({
  avitoChatId: z.string().min(1),
  actions: z.array(
    z.union([
      z.object({
        type: z.literal("reply"),
        text: z.string().min(1).max(4000),
        sendToCustomer: z.boolean().optional(),
      }),
      z.object({ type: z.literal("escalate"), reason: z.string().optional() }),
      z.object({ type: z.literal("noop") }),
    ])
  ),
});

export async function POST(req: Request) {
  const guard = requireBotToken(req);
  if (guard) return guard;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "bad_body" }, { status: 400 });
  }

  const { avitoChatId, actions } = parsed.data;

  const chat = await prisma.chat.findUnique({ where: { avitoChatId } });
  if (!chat) return NextResponse.json({ ok: false, error: "chat_not_found" }, { status: 404 });

  // Берем последний входящий avitoMessageId (если есть) — пригодится, чтобы пометить прочитанным в Avito.
  const lastIn = await prisma.message.findFirst({
    where: { chatId: chat.id, direction: "IN" },
    orderBy: { sentAt: "desc" },
    select: { avitoMessageId: true },
  });
  const lastInAvitoMessageId = lastIn?.avitoMessageId ?? undefined;

  let escalated = false;
  let replied = false;

  // чтобы сообщения стабильно шли по времени
  let t = Date.now();

  const createdMessages: Array<{ id: string; text: string; sentAt: Date }> = [];

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    let lastReplyText: string | null = null;
    let lastReplyAt: Date | null = null;

    for (const a of actions) {
      if (a.type === "noop") continue;

      if (a.type === "escalate") {
        await tx.chat.update({ where: { id: chat.id }, data: { status: "MANAGER" } });
        escalated = true;
        continue;
      }

      // reply
      const sentAt = new Date(t);
      t += 5;

      const avitoMessageId = `bot_${sentAt.getTime()}_${Math.random().toString(16).slice(2)}`;

      const msg = await tx.message.create({
        data: {
          chatId: chat.id,
          avitoMessageId,
          direction: "OUT",
          text: a.text,
          sentAt,
          isRead: true,
          raw: { source: "bot_reply", sendToCustomer: a.sendToCustomer ?? true },
        },
        select: { id: true, text: true, sentAt: true },
      });

      createdMessages.push(msg);
      replied = true;
      lastReplyText = a.text;
      lastReplyAt = sentAt;
    }

    if (lastReplyAt && lastReplyText !== null) {
      // Ключевая логика: если бот ответил, значит он "прочитал" входящие.
      // Снимаем непрочитанность со всех IN (которые появились до/в момент ответа).
      await tx.message.updateMany({
        where: {
          chatId: chat.id,
          direction: "IN",
          isRead: false,
          sentAt: { lte: lastReplyAt },
        },
        data: { isRead: true },
      });

      const unread = await tx.message.count({
        where: { chatId: chat.id, direction: "IN", isRead: false },
      });

      await tx.chat.update({
        where: { id: chat.id },
        data: {
          lastMessageAt: lastReplyAt,
          lastMessageText: lastReplyText,
          unreadCount: unread,
        },
      });
    }
  });

  if (replied && !env.MOCK_MODE && chat.avitoChatId) {
    try {
      await avitoMarkChatRead(chat.avitoChatId, lastInAvitoMessageId);
    } catch {}
  }

  const hasChanges = replied || escalated;

  if (hasChanges) {
    // realtime: новые сообщения в открытом чате + рефетч списков
    for (const m of createdMessages) {
      publish({
        type: "message_created",
        chatId: chat.id,
        avitoChatId: chat.avitoChatId,
        messageId: m.id,
        direction: "OUT",
        message: {
          id: m.id,
          chatId: chat.id,
          direction: "OUT",
          text: m.text,
          sentAt: m.sentAt.toISOString(),
          isRead: true,
        },
      });
    }

    if (replied) {
      publish({ type: "chat_read", chatId: chat.id, avitoChatId: chat.avitoChatId });
    }

    publish({ type: "chat_updated", chatId: chat.id, avitoChatId: chat.avitoChatId });
  }

  return NextResponse.json({ ok: true, createdMessages: createdMessages.length, escalated });
}
