// src/app/api/admin/billing/stats/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/billing/stats — агрегированная аналитика
 *  Query: days (7 | 30 | custom число дней, default 30)
 */
export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const url = new URL(req.url);
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get("days") ?? "30", 10)));
  const since = new Date(Date.now() - days * 86400_000);

  // Общие суммы за период
  const totals = await prisma.aiMessageBilling.aggregate({
    where: { createdAt: { gte: since } },
    _count: { id: true },
    _sum: { chargedRub: true, costRub: true, profitRub: true, inputTokens: true, outputTokens: true },
  });

  // Топ-10 пользователей по расходам
  const topUsers = await prisma.aiMessageBilling.groupBy({
    by: ["userId"],
    where: { createdAt: { gte: since } },
    _count: { id: true },
    _sum: { chargedRub: true, costRub: true, profitRub: true },
    orderBy: { _sum: { chargedRub: "desc" } },
    take: 10,
  });

  // Загружаем email для топ-пользователей
  const userIds = topUsers.map((u) => u.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, username: true },
  });
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  // Распределение по моделям
  const byModel = await prisma.aiMessageBilling.groupBy({
    by: ["model"],
    where: { createdAt: { gte: since } },
    _count: { id: true },
    _sum: { chargedRub: true, costRub: true, profitRub: true },
  });

  // Доход по дням (агрегируем с помощью raw SQL)
  const dailyRaw = await prisma.$queryRaw<
    { date: string; revenue: number; cost: number; profit: number; messages: number }[]
  >`
    SELECT
      DATE("createdAt" AT TIME ZONE 'UTC')::text AS date,
      SUM("chargedRub")::float AS revenue,
      SUM("costRub")::float AS cost,
      SUM("profitRub")::float AS profit,
      COUNT(*)::int AS messages
    FROM "AiMessageBilling"
    WHERE "createdAt" >= ${since}
    GROUP BY DATE("createdAt" AT TIME ZONE 'UTC')
    ORDER BY date ASC
  `;

  const revenue = totals._sum.chargedRub ? Number(totals._sum.chargedRub) : 0;
  const cost = totals._sum.costRub ? Number(totals._sum.costRub) : 0;
  const profit = totals._sum.profitRub ? Number(totals._sum.profitRub) : 0;

  return NextResponse.json({
    ok: true,
    data: {
      days,
      since,
      totals: {
        messages: totals._count.id,
        revenue: +revenue.toFixed(2),
        cost: +cost.toFixed(2),
        profit: +profit.toFixed(2),
        inputTokens: totals._sum.inputTokens ?? 0,
        outputTokens: totals._sum.outputTokens ?? 0,
      },
      topUsers: topUsers.map((u) => {
        const usr = userMap[u.userId];
        return {
          userId: u.userId,
          email: usr?.email ?? null,
          username: usr?.username ?? null,
          messages: u._count.id,
          revenue: +(Number(u._sum.chargedRub ?? 0)).toFixed(2),
          cost: +(Number(u._sum.costRub ?? 0)).toFixed(2),
          profit: +(Number(u._sum.profitRub ?? 0)).toFixed(2),
        };
      }),
      byModel: byModel.map((m) => ({
        model: m.model,
        messages: m._count.id,
        revenue: +(Number(m._sum.chargedRub ?? 0)).toFixed(2),
        cost: +(Number(m._sum.costRub ?? 0)).toFixed(2),
        profit: +(Number(m._sum.profitRub ?? 0)).toFixed(2),
      })),
      daily: dailyRaw.map((d) => ({
        date: d.date,
        revenue: +Number(d.revenue).toFixed(2),
        cost: +Number(d.cost).toFixed(2),
        profit: +Number(d.profit).toFixed(2),
        messages: Number(d.messages),
      })),
    },
  });
}
