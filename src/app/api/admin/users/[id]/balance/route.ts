// src/app/api/admin/users/[id]/balance/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/users/[id]/balance — пополнить или уменьшить баланс пользователя
 *  Body: { amount: number, description?: string }
 *  amount > 0 — пополнение (TOPUP), amount < 0 — списание (CHARGE)
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const amount = Number(body.amount);
  const description: string = body.description ?? (amount > 0 ? "Пополнение администратором" : "Списание администратором");

  if (!isFinite(amount) || amount === 0) {
    return NextResponse.json({ ok: false, error: "amount must be a non-zero number" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) {
    return NextResponse.json({ ok: false, error: "user not found" }, { status: 404 });
  }

  // Атомарно обновляем баланс и создаём транзакцию
  const result = await prisma.$transaction(async (tx) => {
    // Upsert баланса
    const balanceRow = await tx.userBalance.upsert({
      where: { userId: id },
      update: { balance: { increment: amount } },
      create: { userId: id, balance: amount },
    });

    const newBalance = Number(balanceRow.balance);

    // Запись в лог транзакций
    const transaction = await tx.balanceTransaction.create({
      data: {
        userId: id,
        type: amount > 0 ? "TOPUP" : "CHARGE",
        amount,
        balanceAfter: newBalance,
        description,
      },
    });

    return { balance: newBalance, transaction };
  });

  return NextResponse.json({ ok: true, data: result });
}
