// src/app/api/billing/balance/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/billing/balance — текущий баланс + последние 10 транзакций */
export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const [balanceRow, transactions] = await Promise.all([
    prisma.userBalance.findUnique({ where: { userId: user.id } }),
    prisma.balanceTransaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      balance: balanceRow ? Number(balanceRow.balance) : 0,
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
