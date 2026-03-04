// src/app/api/chats/[id]/reactivate/route.ts
// Возвращает INACTIVE чат обратно в BOT (реактивация сделки)
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { publish } from "@/lib/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const { id } = await ctx.params;

  const chat = await prisma.chat.findUnique({ where: { id } });
  if (!chat) return NextResponse.json({ ok: false }, { status: 404 });

  if (chat.status !== "INACTIVE") {
    return NextResponse.json({ ok: false, error: "Only INACTIVE can be reactivated" }, { status: 400 });
  }

  const rawObj = (chat.raw && typeof chat.raw === "object") ? (chat.raw as any) : {};

  await prisma.chat.update({
    where: { id },
    data: {
      status: "BOT",
      followupSentAt: null,
      manualUnread: false,
      raw: {
        ...rawObj,
        reactivated: {
          at: new Date().toISOString(),
          previousStatus: "INACTIVE",
        },
      },
    },
  });

  const snap = await prisma.chat.findUnique({
    where: { id },
    select: {
      id: true, status: true, customerName: true, itemTitle: true, price: true,
      lastMessageAt: true, lastMessageText: true, adUrl: true, chatUrl: true,
      unreadCount: true, pinned: true, avitoChatId: true, manualUnread: true, labelColor: true, followupSentAt: true,
    },
  });

  publish({
    type: "chat_updated",
    chatId: chat.id,
    avitoChatId: chat.avitoChatId,
    chatSnapshot: snap ? {
      id: snap.id,
      avitoChatId: snap.avitoChatId,
      status: snap.status,
      customerName: snap.customerName,
      itemTitle: snap.itemTitle,
      price: snap.price,
      lastMessageAt: snap.lastMessageAt?.toISOString() ?? null,
      lastMessageText: snap.lastMessageText,
      adUrl: snap.adUrl,
      chatUrl: snap.chatUrl,
      unreadCount: snap.unreadCount,
      pinned: snap.pinned,
      manualUnread: (snap as any).manualUnread ?? false,
      labelColor: (snap as any).labelColor ?? null,
      followupSentAt: (snap as any).followupSentAt ? (snap as any).followupSentAt.toISOString() : null,
    } : undefined,
  });

  return NextResponse.json({ ok: true });
}
