import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampInt(raw: string | null, def: number, min: number, max: number) {
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

export async function GET(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const url = new URL(req.url);

  const status = url.searchParams.get("status"); // BOT | MANAGER | null
  const sortField = (url.searchParams.get("sortField") || "lastMessageAt") as
    | "lastMessageAt"
    | "price";
  const sortOrder = (url.searchParams.get("sortOrder") || "desc") as "asc" | "desc";
  const unreadOnly = url.searchParams.get("unreadOnly") === "1";

  // Чтобы UI мог показать все чаты, добавили limit.
  // По умолчанию берем побольше, потому что у тебя уже >1000 чатов.
  const take = clampInt(url.searchParams.get("limit"), 2000, 1, 5000);

  const where: any = {};
  if (status === "BOT" || status === "MANAGER") where.status = status;

  const orderBy =
    sortField === "price"
      ? [{ pinned: "desc" as const }, { price: sortOrder }, { lastMessageAt: "desc" as const }]
      : [{ pinned: "desc" as const }, { lastMessageAt: sortOrder }, { price: "desc" as const }];

  const items = await prisma.chat.findMany({
    where,
    orderBy,
    take,
    select: {
      id: true,
      status: true,
      pinned: true,
      customerName: true,
      itemTitle: true,
      price: true,
      lastMessageAt: true,
      lastMessageText: true,
      adUrl: true,
      chatUrl: true,
      unreadCount: true,
    },
  });

  let rows = items;

  // unreadOnly фильтруем после запроса — чтобы не усложнять SQL
  if (unreadOnly) rows = rows.filter((c) => (c.unreadCount ?? 0) > 0);

  // На всякий случай пересчитаем unreadCount по сообщениям.
  const ids = rows.map((r) => r.id);
  const counts = await prisma.message.groupBy({
    by: ["chatId"],
    where: { chatId: { in: ids }, direction: "IN", isRead: false },
    _count: { _all: true },
  });
  const countMap = new Map(counts.map((c) => [c.chatId, c._count._all]));
  rows = rows.map((r) => ({ ...r, unreadCount: countMap.get(r.id) ?? r.unreadCount ?? 0 }));

  return NextResponse.json({ ok: true, items: rows });
}
