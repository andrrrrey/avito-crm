// src/app/api/chats/[id]/unread/route.ts
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
  if (!chat) return NextResponse.json({ ok: false, error: "chat_not_found" }, { status: 404 });

  // Ручное "непрочитано" только в колонке менеджера
  if (chat.status !== "MANAGER") {
    return NextResponse.json({ ok: false, error: "only_manager" }, { status: 400 });
  }

  const updated = await prisma.chat.update({
    where: { id },
    data: { manualUnread: true },
    select: { manualUnread: true },
  });

  publish({ type: "chat_updated", chatId: chat.id, avitoChatId: chat.avitoChatId });

  return NextResponse.json({ ok: true, manualUnread: updated.manualUnread });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const { id } = await ctx.params;

  const chat = await prisma.chat.findUnique({ where: { id } });
  if (!chat) return NextResponse.json({ ok: false, error: "chat_not_found" }, { status: 404 });

  if (chat.status !== "MANAGER") {
    return NextResponse.json({ ok: false, error: "only_manager" }, { status: 400 });
  }

  const updated = await prisma.chat.update({
    where: { id },
    data: { manualUnread: false },
    select: { manualUnread: true },
  });

  publish({ type: "chat_updated", chatId: chat.id, avitoChatId: chat.avitoChatId });

  return NextResponse.json({ ok: true, manualUnread: updated.manualUnread });
}
