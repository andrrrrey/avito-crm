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

  if (chat.status !== "MANAGER") {
    return NextResponse.json({ ok: false, error: "Pin only in MANAGER" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as null | { pinned?: unknown };
  const nextPinned = body && body.pinned !== undefined ? Boolean(body.pinned) : !chat.pinned;

  const updated = await prisma.chat.update({
    where: { id },
    data: { pinned: nextPinned },
    select: { pinned: true },
  });

  publish({ type: "chat_pinned", chatId: chat.id, avitoChatId: chat.avitoChatId });
  publish({ type: "chat_updated", chatId: chat.id, avitoChatId: chat.avitoChatId });

  return NextResponse.json({ ok: true, pinned: updated.pinned });
}
