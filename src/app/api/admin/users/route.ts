// src/app/api/admin/users/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/users — список всех пользователей с балансами
 *  Query: search (email/username), page, limit
 */
export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)));

  const where = search
    ? {
        OR: [
          { email: { contains: search, mode: "insensitive" as const } },
          { username: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        isActive: true,
        createdAt: true,
        balance: { select: { balance: true } },
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        username: u.username,
        role: u.role,
        isActive: u.isActive,
        createdAt: u.createdAt,
        balance: u.balance ? Number(u.balance.balance) : 0,
      })),
    },
  });
}
