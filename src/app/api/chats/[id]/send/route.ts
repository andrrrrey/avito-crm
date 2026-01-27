// src/app/api/chats/[id]/send/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import { avitoSendTextMessage } from "@/lib/avito";
import { publish } from "@/lib/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function jsonError(status: number, error: string, extra?: any) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

export async function POST(req: Request, ctx: Ctx) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as null | { text?: unknown; markRead?: unknown };
  if (!body) return jsonError(400, "bad_json");

  const text = String(body.text ?? "").trim();
  if (!text) return jsonError(400, "empty_text");

  const markRead = body.markRead === undefined ? true : Boolean(body.markRead);

  const chat = await prisma.chat.findUnique({ where: { id } });
  if (!chat) return jsonError(404, "chat_not_found");

  const now = new Date();

  // --- MOCK ---
  if (env.MOCK_MODE) {
    const avitoMessageId = `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const msg = await prisma.message.create({
      data: {
        chatId: chat.id,
        avitoMessageId,
        direction: "OUT",
        text,
        sentAt: now,
        isRead: true,
        raw: { mock: true, source: "crm_send" },
      },
    });

    await prisma.chat.update({
      where: { id: chat.id },
      data: {
        status: chat.status === "BOT" ? "MANAGER" : chat.status,
        lastMessageAt: now,
        lastMessageText: text,
      },
    });

    if (markRead) {
      await prisma.message.updateMany({
        where: { chatId: chat.id, direction: "IN", isRead: false },
        data: { isRead: true },
      });

      const unread = await prisma.message.count({
        where: { chatId: chat.id, direction: "IN", isRead: false },
      });

      await prisma.chat.update({ where: { id: chat.id }, data: { unreadCount: unread } });
    }

    publish({
      type: "message_created",
      chatId: chat.id,
      avitoChatId: chat.avitoChatId,
      messageId: msg.id,
      direction: "OUT",
      message: {
        id: msg.id,
        chatId: chat.id,
        direction: "OUT",
        text: msg.text,
        sentAt: msg.sentAt.toISOString(),
        isRead: true,
      },
    });
    publish({ type: "chat_updated", chatId: chat.id, avitoChatId: chat.avitoChatId });

    return NextResponse.json({
      ok: true,
      message: { id: msg.id, chatId: msg.chatId, direction: msg.direction, text: msg.text, sentAt: msg.sentAt },
    });
  }

  // --- REAL AVITO ---
  if (!chat.avitoChatId) return jsonError(409, "chat_not_linked_to_avito");

  let avitoResp: any;
  try {
    // ВАЖНО: правильная сигнатура (chatId, text)
    avitoResp = await avitoSendTextMessage(chat.avitoChatId, text);
  } catch (e: any) {
    return jsonError(502, "avito_send_failed", { message: String(e?.message ?? e) });
  }

  const avitoMessageId = String(
    avitoResp?.id ??
      avitoResp?.message_id ??
      avitoResp?.result?.id ??
      avitoResp?.message?.id ??
      `avito_${Date.now()}`
  );

  const msg = await prisma.message.create({
    data: {
      chatId: chat.id,
      avitoMessageId,
      direction: "OUT",
      text,
      sentAt: now,
      isRead: true,
      raw: avitoResp ?? { source: "avito_send" },
    },
  });

  await prisma.chat.update({
    where: { id: chat.id },
    data: {
      status: "MANAGER", // пока бот не подключен — держим в MANAGER
      lastMessageAt: now,
      lastMessageText: text,
    },
  });

  if (markRead) {
    await prisma.message.updateMany({
      where: { chatId: chat.id, direction: "IN", isRead: false },
      data: { isRead: true },
    });

    const unread = await prisma.message.count({
      where: { chatId: chat.id, direction: "IN", isRead: false },
    });

    await prisma.chat.update({ where: { id: chat.id }, data: { unreadCount: unread } });
  }

  publish({
    type: "message_created",
    chatId: chat.id,
    avitoChatId: chat.avitoChatId,
    messageId: msg.id,
    direction: "OUT",
    message: {
      id: msg.id,
      chatId: chat.id,
      direction: "OUT",
      text: msg.text,
      sentAt: msg.sentAt.toISOString(),
      isRead: true,
    },
  });
  publish({ type: "chat_updated", chatId: chat.id, avitoChatId: chat.avitoChatId });

  return NextResponse.json({
    ok: true,
    message: { id: msg.id, chatId: msg.chatId, direction: msg.direction, text: msg.text, sentAt: msg.sentAt },
  });
}