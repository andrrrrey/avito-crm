import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { env } from "@/lib/env";
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
  const accountId = dbUser?.avitoAccountId ?? env.AVITO_ACCOUNT_ID ?? null;
  if (accountId === null) return NextResponse.json({ ok: false }, { status: 404 });

  const { id } = await ctx.params;

  const chat = await prisma.chat.findUnique({ where: { id, accountId } });
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

  publish({ type: "chat_pinned", chatId: chat.id, avitoChatId: chat.avitoChatId, accountId: chat.accountId });
  publish({ type: "chat_updated", chatId: chat.id, avitoChatId: chat.avitoChatId, accountId: chat.accountId });

  return NextResponse.json({ ok: true, pinned: updated.pinned });
}
