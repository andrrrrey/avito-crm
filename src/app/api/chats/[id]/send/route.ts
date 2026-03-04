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

// Outgoing attachments are intentionally disabled.

function getPublicBaseUrl(req: Request) {
  const base = (env.PUBLIC_BASE_URL ?? "").trim();
  if (base) return base.replace(/\/$/, "");

  const proto = (req.headers.get("x-forwarded-proto") || "http").split(",")[0].trim();
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

function makeLocalUploadUrl(fileId: string) {
  return `/api/uploads/${fileId}`;
}

function makePublicUploadUrl(req: Request, localUrl: string) {
  const base = getPublicBaseUrl(req);
  return base ? `${base}${localUrl}` : "";
}

function jsonError(status: number, error: string, extra?: any) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

export async function POST(req: Request, ctx: Ctx) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const { id } = await ctx.params;

  const ct = (req.headers.get("content-type") || "").toLowerCase();

  let text = "";
  let markRead = true;

  if (ct.includes("multipart/form-data")) {
    // UI does not allow attachments; block manual multipart attempts as well.
    return jsonError(400, "attachments_disabled");
  } else {
    const body = (await req.json().catch(() => null)) as null | { text?: unknown; markRead?: unknown };
    if (!body) return jsonError(400, "bad_json");
    text = String(body.text ?? "").trim();
    markRead = body.markRead === undefined ? true : Boolean(body.markRead);
  }

  if (!text) return jsonError(400, "empty_payload");

  const chat = await prisma.chat.findUnique({ where: { id } });
  if (!chat) return jsonError(404, "chat_not_found");

  const now = new Date();

  // --- MOCK ---
  if (env.MOCK_MODE) {
    const avitoMessageId = `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const storedText = text;

    const msg = await prisma.message.create({
      data: {
        chatId: chat.id,
        avitoMessageId,
        direction: "OUT",
        text: storedText,
        sentAt: now,
        isRead: true,
        raw: { mock: true, source: "crm_send" },
      },
    });

    await prisma.chat.update({
      where: { id: chat.id },
      data: {
        status: "MANAGER",
        lastMessageAt: now,
        lastMessageText: storedText,
        followupSentAt: null,
        manualUnread: false,
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

      await prisma.chat.update({ where: { id: chat.id }, data: { unreadCount: unread, manualUnread: false } });
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
        raw: msg.raw,
      },
    });
    publish({ type: "chat_updated", chatId: chat.id, avitoChatId: chat.avitoChatId });

    return NextResponse.json({
      ok: true,
      message: { id: msg.id, chatId: msg.chatId, direction: msg.direction, text: msg.text, sentAt: msg.sentAt, raw: msg.raw },
    });
  }

  // --- REAL AVITO ---
  if (!chat.avitoChatId) return jsonError(409, "chat_not_linked_to_avito");

  let avitoResp: any;
  try {
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
      raw: { ...(avitoResp ?? { source: "avito_send" }) },
    },
  });

  await prisma.chat.update({
    where: { id: chat.id },
    data: {
      status: "MANAGER", // пока бот не подключен — держим в MANAGER
      lastMessageAt: now,
      lastMessageText: msg.text,
      followupSentAt: null,
      manualUnread: false,
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

    await prisma.chat.update({ where: { id: chat.id }, data: { unreadCount: unread, manualUnread: false } });
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
      raw: msg.raw,
    },
  });
  publish({ type: "chat_updated", chatId: chat.id, avitoChatId: chat.avitoChatId });

  return NextResponse.json({
    ok: true,
    message: { id: msg.id, chatId: msg.chatId, direction: msg.direction, text: msg.text, sentAt: msg.sentAt, raw: msg.raw },
  });
}