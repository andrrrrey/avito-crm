// src/app/api/analytics/route.ts
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

function parseIsoDateOrNull(v: string | null): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Returns UTC bounds for "today" in user's timezone.
 * tzOffsetMinutes is the value returned by JS Date#getTimezoneOffset().
 */
function todayBoundsUtc(nowUtc: Date, tzOffsetMinutes: number) {
  const localMs = nowUtc.getTime() - tzOffsetMinutes * 60_000;
  const local = new Date(localMs);
  local.setUTCHours(0, 0, 0, 0);
  const startUtc = new Date(local.getTime() + tzOffsetMinutes * 60_000);
  const endExclusiveUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc, endExclusiveUtc };
}

async function computeStats(range: { start: Date; endExclusive: Date }) {
  const whereBase = {
    sentAt: {
      gte: range.start,
      lt: range.endExclusive,
    },
  } as const;

  const [
    messagesTotal,
    messagesIn,
    messagesOut,
    distinctChatsAll,
    distinctChatsBot,
    distinctChatsManager,
    distinctChatsInactive,
  ] = await Promise.all([
    prisma.message.count({ where: whereBase }),
    prisma.message.count({ where: { ...whereBase, direction: "IN" } }),
    prisma.message.count({ where: { ...whereBase, direction: "OUT" } }),
    prisma.message.findMany({
      where: whereBase,
      distinct: ["chatId"],
      select: { chatId: true },
    }),
    prisma.message.findMany({
      where: { ...whereBase, chat: { status: "BOT" } },
      distinct: ["chatId"],
      select: { chatId: true },
    }),
    prisma.message.findMany({
      where: { ...whereBase, chat: { status: "MANAGER" } },
      distinct: ["chatId"],
      select: { chatId: true },
    }),
    prisma.message.findMany({
      where: { ...whereBase, chat: { status: "INACTIVE" } },
      distinct: ["chatId"],
      select: { chatId: true },
    }),
  ]);

  return {
    chats: distinctChatsAll.length,
    chatsBot: distinctChatsBot.length,
    chatsManager: distinctChatsManager.length,
    chatsInactive: distinctChatsInactive.length,
    messages: messagesTotal,
    messagesIn,
    messagesOut,
  };
}

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth) return auth;

  const url = new URL(req.url);

  // Period bounds come from the client (so it's aligned with user's timezone).
  const from = parseIsoDateOrNull(url.searchParams.get("from"));
  const to = parseIsoDateOrNull(url.searchParams.get("to"));

  // If client didn't provide bounds: default to last 7 full days (including today), in UTC.
  const now = new Date();
  const defaultEnd = new Date(now);
  const defaultStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const periodStart = from ?? defaultStart;
  const periodEndExclusive = to ?? defaultEnd;

  // sanity: if swapped, auto-fix
  const fixedStart = periodStart.getTime() <= periodEndExclusive.getTime() ? periodStart : periodEndExclusive;
  const fixedEnd = periodStart.getTime() <= periodEndExclusive.getTime() ? periodEndExclusive : periodStart;

  // Today's bounds are computed using user's tzOffset.
  const tzOffset = Number(url.searchParams.get("tz") ?? "0");
  const tzOffsetMinutes = Number.isFinite(tzOffset) ? tzOffset : 0;
  const { startUtc: todayStart, endExclusiveUtc: todayEnd } = todayBoundsUtc(
    now,
    tzOffsetMinutes
  );

  const [today, period] = await Promise.all([
    computeStats({ start: todayStart, endExclusive: todayEnd }),
    computeStats({ start: fixedStart, endExclusive: fixedEnd }),
  ]);

  return NextResponse.json({
    ok: true,
    today: {
      start: todayStart.toISOString(),
      endExclusive: todayEnd.toISOString(),
      ...today,
    },
    period: {
      start: fixedStart.toISOString(),
      endExclusive: fixedEnd.toISOString(),
      ...period,
    },
  });
}
