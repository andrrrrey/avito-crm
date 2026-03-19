import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function startOfDayUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const daysRaw = url.searchParams.get("days");
  const days = daysRaw ? Math.min(Math.max(1, parseInt(daysRaw, 10) || 30), 365) : 30;

  const dbUser = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { avitoAccountId: true },
  });

  const accountId = dbUser?.avitoAccountId ?? null;

  if (accountId === null) {
    return NextResponse.json({
      ok: true,
      data: {
        period: { days, since: new Date().toISOString() },
        chats: { total: 0, today: 0, period: 0, byStatus: { BOT: 0, MANAGER: 0, INACTIVE: 0 } },
        messages: { total: 0, period: 0, byDirection: { IN: 0, OUT: 0 }, byAuthor: { customer: 0, ai: 0, manager: 0 } },
        conversion: { aiToManager: 0, totalEscalated: 0, totalBotHandled: 0 },
        daily: [],
      },
    });
  }

  const now = new Date();
  const todayStart = startOfDayUTC(now);
  const periodStart = startOfDayUTC(addDays(now, -days));

  // ── Chat counts ────────────────────────────────────────────────────────────
  const [totalChats, todayChats, periodChats, chatsByStatus] = await Promise.all([
    prisma.chat.count({ where: { accountId } }),
    prisma.chat.count({ where: { accountId, createdAt: { gte: todayStart } } }),
    prisma.chat.count({ where: { accountId, createdAt: { gte: periodStart } } }),
    prisma.chat.groupBy({ by: ["status"], where: { accountId }, _count: { _all: true } }),
  ]);

  const byStatus = { BOT: 0, MANAGER: 0, INACTIVE: 0 };
  for (const g of chatsByStatus) {
    byStatus[g.status] = g._count._all;
  }

  // ── Message counts ─────────────────────────────────────────────────────────
  // Total and period messages by direction
  const [allMsgsByDir, periodMsgsByDir] = await Promise.all([
    prisma.message.groupBy({
      by: ["direction"],
      where: { chat: { accountId } },
      _count: { _all: true },
    }),
    prisma.message.groupBy({
      by: ["direction"],
      where: { chat: { accountId }, sentAt: { gte: periodStart } },
      _count: { _all: true },
    }),
  ]);

  const totalIN = allMsgsByDir.find((g) => g.direction === "IN")?._count._all ?? 0;
  const totalOUT = allMsgsByDir.find((g) => g.direction === "OUT")?._count._all ?? 0;
  const periodIN = periodMsgsByDir.find((g) => g.direction === "IN")?._count._all ?? 0;
  const periodOUT = periodMsgsByDir.find((g) => g.direction === "OUT")?._count._all ?? 0;

  // AI vs Manager messages (OUT only): bot_reply source = AI
  // Using raw SQL for JSON field filtering
  type CountRow = { count: bigint };

  const [aiMsgRows, aiPeriodMsgRows] = await Promise.all([
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint as count
      FROM "Message" m
      JOIN "Chat" c ON c.id = m."chatId"
      WHERE c."accountId" = ${accountId}
        AND m.direction = 'OUT'
        AND m.raw->>'source' = 'bot_reply'
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint as count
      FROM "Message" m
      JOIN "Chat" c ON c.id = m."chatId"
      WHERE c."accountId" = ${accountId}
        AND m.direction = 'OUT'
        AND m.raw->>'source' = 'bot_reply'
        AND m."sentAt" >= ${periodStart}
    `,
  ]);

  const aiMsgTotal = Number(aiMsgRows[0]?.count ?? 0);
  const aiMsgPeriod = Number(aiPeriodMsgRows[0]?.count ?? 0);
  const managerMsgTotal = totalOUT - aiMsgTotal;
  const managerMsgPeriod = periodOUT - aiMsgPeriod;

  // ── Conversion ─────────────────────────────────────────────────────────────
  // "Escalated" chats: chats that are MANAGER or INACTIVE and have at least one bot_reply message
  type EscalatedRow = { count: bigint };
  const [escalatedRows, botHandledRows] = await Promise.all([
    prisma.$queryRaw<EscalatedRow[]>`
      SELECT COUNT(DISTINCT c.id)::bigint as count
      FROM "Chat" c
      WHERE c."accountId" = ${accountId}
        AND c.status IN ('MANAGER', 'INACTIVE')
        AND EXISTS (
          SELECT 1 FROM "Message" m
          WHERE m."chatId" = c.id AND m.direction = 'OUT' AND m.raw->>'source' = 'bot_reply'
        )
    `,
    // Total chats that were ever handled by bot (have at least one bot_reply)
    prisma.$queryRaw<EscalatedRow[]>`
      SELECT COUNT(DISTINCT c.id)::bigint as count
      FROM "Chat" c
      WHERE c."accountId" = ${accountId}
        AND EXISTS (
          SELECT 1 FROM "Message" m
          WHERE m."chatId" = c.id AND m.direction = 'OUT' AND m.raw->>'source' = 'bot_reply'
        )
    `,
  ]);

  const totalEscalated = Number(escalatedRows[0]?.count ?? 0);
  const totalBotHandled = Number(botHandledRows[0]?.count ?? 0);
  const aiToManager = totalBotHandled > 0 ? totalEscalated / totalBotHandled : 0;

  // ── Daily breakdown ─────────────────────────────────────────────────────────
  // Generate all dates in period
  type DailyMsgRow = { day: Date; dir: string; count: bigint };
  type DailyChatRow = { day: Date; count: bigint };
  type DailyAiRow = { day: Date; count: bigint };

  const [dailyMsgRows, dailyChatRows, dailyAiMsgRows] = await Promise.all([
    prisma.$queryRaw<DailyMsgRow[]>`
      SELECT DATE_TRUNC('day', m."sentAt") as day, m.direction as dir, COUNT(*)::bigint as count
      FROM "Message" m
      JOIN "Chat" c ON c.id = m."chatId"
      WHERE c."accountId" = ${accountId}
        AND m."sentAt" >= ${periodStart}
        AND m."sentAt" < ${now}
      GROUP BY 1, 2
      ORDER BY 1
    `,
    prisma.$queryRaw<DailyChatRow[]>`
      SELECT DATE_TRUNC('day', c."createdAt") as day, COUNT(*)::bigint as count
      FROM "Chat" c
      WHERE c."accountId" = ${accountId}
        AND c."createdAt" >= ${periodStart}
        AND c."createdAt" < ${now}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw<DailyAiRow[]>`
      SELECT DATE_TRUNC('day', m."sentAt") as day, COUNT(*)::bigint as count
      FROM "Message" m
      JOIN "Chat" c ON c.id = m."chatId"
      WHERE c."accountId" = ${accountId}
        AND m.direction = 'OUT'
        AND m.raw->>'source' = 'bot_reply'
        AND m."sentAt" >= ${periodStart}
        AND m."sentAt" < ${now}
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  // Build day-indexed maps
  const dailyMsgMap = new Map<string, { IN: number; OUT: number }>();
  for (const r of dailyMsgRows) {
    const key = toDateStr(new Date(r.day));
    if (!dailyMsgMap.has(key)) dailyMsgMap.set(key, { IN: 0, OUT: 0 });
    const entry = dailyMsgMap.get(key)!;
    if (r.dir === "IN") entry.IN = Number(r.count);
    else entry.OUT = Number(r.count);
  }

  const dailyChatMap = new Map<string, number>();
  for (const r of dailyChatRows) {
    dailyChatMap.set(toDateStr(new Date(r.day)), Number(r.count));
  }

  const dailyAiMsgMap = new Map<string, number>();
  for (const r of dailyAiMsgRows) {
    dailyAiMsgMap.set(toDateStr(new Date(r.day)), Number(r.count));
  }

  // Generate full date series
  const daily: Array<{
    date: string;
    chats: number;
    messagesIN: number;
    messagesOUT: number;
    aiMessages: number;
    managerMessages: number;
  }> = [];

  for (let i = 0; i < days; i++) {
    const d = addDays(periodStart, i);
    const key = toDateStr(d);
    const msgs = dailyMsgMap.get(key) ?? { IN: 0, OUT: 0 };
    const ai = dailyAiMsgMap.get(key) ?? 0;
    daily.push({
      date: key,
      chats: dailyChatMap.get(key) ?? 0,
      messagesIN: msgs.IN,
      messagesOUT: msgs.OUT,
      aiMessages: ai,
      managerMessages: msgs.OUT - ai,
    });
  }

  return NextResponse.json({
    ok: true,
    data: {
      period: { days, since: periodStart.toISOString() },
      chats: {
        total: totalChats,
        today: todayChats,
        period: periodChats,
        byStatus,
      },
      messages: {
        total: totalIN + totalOUT,
        period: periodIN + periodOUT,
        byDirection: { IN: totalIN, OUT: totalOUT },
        byAuthor: { customer: totalIN, ai: aiMsgTotal, manager: managerMsgTotal },
        byAuthorPeriod: { customer: periodIN, ai: aiMsgPeriod, manager: managerMsgPeriod },
      },
      conversion: {
        aiToManager: Math.round(aiToManager * 1000) / 1000,
        totalEscalated,
        totalBotHandled,
      },
      daily,
    },
  });
}
