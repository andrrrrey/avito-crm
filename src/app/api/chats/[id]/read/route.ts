// src/app/api/chats/[id]/read/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import { avitoMarkChatRead } from "@/lib/avito";
import { publish } from "@/lib/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const { id } = await ctx.params;

  const chat = await prisma.chat.findUnique({ where: { id } });
  if (!chat) return NextResponse.json({ ok: false, error: "chat_not_found" }, { status: 404 });

  // Берем последний avitoMessageId (если есть) — полезно для некоторых вариантов API "read"
  const last = await prisma.message.findFirst({
    where: { chatId: chat.id },
    orderBy: { sentAt: "desc" },
    select: { avitoMessageId: true },
  });
  const lastMessageId = last?.avitoMessageId ?? undefined;

  let avitoOk: boolean | null = null;
  let avitoError: string | null = null;

  // 1) Пытаемся пометить прочитанным в Avito (если не MOCK)
  if (!env.MOCK_MODE && chat.avitoChatId) {
    try {
      await avitoMarkChatRead(chat.avitoChatId, lastMessageId);
      avitoOk = true;
    } catch (e: any) {
      avitoOk = false;
      avitoError = String(e?.message ?? e);
    }
  }

  // 2) Локально: все входящие -> прочитаны
  await prisma.$transaction(async (tx) => {
    await tx.message.updateMany({
      where: { chatId: chat.id, direction: "IN", isRead: false },
      data: { isRead: true },
    });

    await tx.chat.update({
      where: { id: chat.id },
      data: { unreadCount: 0 },
    });
  });

  publish({ type: "chat_read", chatId: chat.id, avitoChatId: chat.avitoChatId });
  publish({ type: "chat_updated", chatId: chat.id, avitoChatId: chat.avitoChatId });

  return NextResponse.json({
    ok: true,
    ...(avitoOk !== null ? { avitoOk, avitoError } : {}),
  });
}
