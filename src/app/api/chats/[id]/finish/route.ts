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
    return NextResponse.json({ ok: false, error: "Only MANAGER can finish" }, { status: 400 });
  }

  await prisma.chat.update({
    where: { id },
    data: { status: "BOT", pinned: false },
  });

  publish({ type: "chat_finished", chatId: chat.id, avitoChatId: chat.avitoChatId });
  publish({ type: "chat_updated", chatId: chat.id, avitoChatId: chat.avitoChatId });

  return NextResponse.json({ ok: true });
}
