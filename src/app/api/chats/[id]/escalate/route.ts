// src/app/api/chats/[id]/escalate/route.ts
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

  // Переводим в менеджера из BOT или INACTIVE (забрать чат руками).
  if (chat.status !== "BOT" && chat.status !== "INACTIVE") {
    return NextResponse.json(
      { ok: false, error: "Only BOT/INACTIVE chats can be escalated" },
      { status: 400 }
    );
  }

  const updated = await prisma.chat.update({
    where: { id },
    data: {
      status: "MANAGER",
      pinned: false,
      manualUnread: false,
      followupSentAt: null,
    },
  });

  publish({ type: "chat_updated", chatId: updated.id, avitoChatId: updated.avitoChatId });

  return NextResponse.json({ ok: true });
}
