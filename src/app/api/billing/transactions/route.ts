// src/app/api/billing/transactions/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/billing/transactions — полная история с пагинацией
 *  Query: page (default 1), limit (default 20, max 100)
 */
export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)));
  const skip = (page - 1) * limit;

  const [total, transactions] = await Promise.all([
    prisma.balanceTransaction.count({ where: { userId: user.id } }),
    prisma.balanceTransaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        balanceAfter: Number(t.balanceAfter),
        description: t.description,
        aiMessageId: t.aiMessageId,
        createdAt: t.createdAt,
      })),
    },
  });
}
