import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { publish } from "@/lib/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const dbUser = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { avitoAccountId: true },
  });
  const accountId = dbUser?.avitoAccountId ?? null;
  if (accountId === null) return NextResponse.json({ ok: false }, { status: 404 });

  const { id } = await ctx.params;

  const chat = await prisma.chat.findUnique({ where: { id, accountId } });
  if (!chat) return NextResponse.json({ ok: false }, { status: 404 });

  if (chat.status !== "MANAGER") {
    return NextResponse.json({ ok: false, error: "Only MANAGER can finish" }, { status: 400 });
  }

  await prisma.chat.update({
    where: { id, accountId },
    data: { status: "BOT", pinned: false },
  });

  publish({ type: "chat_finished", chatId: chat.id, avitoChatId: chat.avitoChatId, accountId: chat.accountId });
  publish({ type: "chat_updated", chatId: chat.id, avitoChatId: chat.avitoChatId, accountId: chat.accountId });

  return NextResponse.json({ ok: true });
}
