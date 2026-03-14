// src/app/api/admin/billing/users/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/billing/users — статистика по каждому пользователю
 *  Query: days (default 30), model (фильтр по модели), search (email), page, limit
 */
export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const url = new URL(req.url);
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get("days") ?? "30", 10)));
  const modelFilter = url.searchParams.get("model") ?? "";
  const search = url.searchParams.get("search") ?? "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)));
  const since = new Date(Date.now() - days * 86400_000);

  const billingWhere: Record<string, unknown> = { createdAt: { gte: since } };
  if (modelFilter) billingWhere.model = modelFilter;

  // Агрегация биллинга по пользователям
  const billingGroups = await prisma.aiMessageBilling.groupBy({
    by: ["userId"],
    where: billingWhere,
    _count: { id: true },
    _sum: { chargedRub: true, costRub: true, profitRub: true },
    _avg: { chargedRub: true },
    orderBy: { _sum: { chargedRub: "desc" } },
  });

  // Фильтрация по поиску и пагинация
  let userIds = billingGroups.map((g) => g.userId);

  // Если есть поиск — фильтруем через пользователей
  if (search) {
    const matchingUsers = await prisma.user.findMany({
      where: {
        id: { in: userIds },
        OR: [
          { email: { contains: search, mode: "insensitive" } },
          { username: { contains: search, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });
    const matchingIds = new Set(matchingUsers.map((u) => u.id));
    userIds = userIds.filter((id) => matchingIds.has(id));
  }

  const total = userIds.length;
  const paginatedIds = userIds.slice((page - 1) * limit, page * limit);

  // Загружаем данные пользователей и балансы
  const [users, balances] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: paginatedIds } },
      select: { id: true, email: true, username: true },
    }),
    prisma.userBalance.findMany({
      where: { userId: { in: paginatedIds } },
      select: { userId: true, balance: true },
    }),
  ]);

  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
  const balanceMap = Object.fromEntries(balances.map((b) => [b.userId, Number(b.balance)]));
  const billingMap = Object.fromEntries(billingGroups.map((g) => [g.userId, g]));

  const result = paginatedIds.map((userId) => {
    const usr = userMap[userId];
    const g = billingMap[userId];
    const revenue = g ? Number(g._sum.chargedRub ?? 0) : 0;
    const cost = g ? Number(g._sum.costRub ?? 0) : 0;
    const profit = g ? Number(g._sum.profitRub ?? 0) : 0;
    const messages = g ? g._count.id : 0;
    const avgPrice = g && messages > 0 ? Number(g._avg.chargedRub ?? 0) : 0;

    return {
      userId,
      email: usr?.email ?? null,
      username: usr?.username ?? null,
      messages,
      avgPrice: +avgPrice.toFixed(2),
      revenue: +revenue.toFixed(2),
      cost: +cost.toFixed(2),
      profit: +profit.toFixed(2),
      balance: +(balanceMap[userId] ?? 0).toFixed(2),
    };
  });

  return NextResponse.json({
    ok: true,
    data: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      users: result,
    },
  });
}
