// src/app/api/billing/usage/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/billing/usage — статистика использования AI для текущего пользователя
 *  Query: days (default 30)
 */
export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get("days") ?? "30", 10)));
  const since = new Date(Date.now() - days * 86400_000);

  const billings = await prisma.aiMessageBilling.findMany({
    where: { userId: user.id, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
  });

  // Агрегация по моделям
  const byModel: Record<string, { messages: number; inputTokens: number; outputTokens: number; costRub: number; chargedRub: number }> = {};
  let totalMessages = 0;
  let totalCostRub = 0;
  let totalChargedRub = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const b of billings) {
    const model = b.model;
    if (!byModel[model]) {
      byModel[model] = { messages: 0, inputTokens: 0, outputTokens: 0, costRub: 0, chargedRub: 0 };
    }
    byModel[model].messages++;
    byModel[model].inputTokens += b.inputTokens;
    byModel[model].outputTokens += b.outputTokens;
    byModel[model].costRub += Number(b.costRub);
    byModel[model].chargedRub += Number(b.chargedRub);

    totalMessages++;
    totalCostRub += Number(b.costRub);
    totalChargedRub += Number(b.chargedRub);
    totalInputTokens += b.inputTokens;
    totalOutputTokens += b.outputTokens;
  }

  return NextResponse.json({
    ok: true,
    data: {
      days,
      totalMessages,
      totalCostRub: +totalCostRub.toFixed(4),
      totalChargedRub: +totalChargedRub.toFixed(4),
      totalInputTokens,
      totalOutputTokens,
      avgCostPerMessage: totalMessages > 0 ? +(totalChargedRub / totalMessages).toFixed(4) : 0,
      byModel: Object.entries(byModel).map(([model, stats]) => ({
        model,
        ...stats,
        costRub: +stats.costRub.toFixed(4),
        chargedRub: +stats.chargedRub.toFixed(4),
        avgCostPerMessage: stats.messages > 0 ? +(stats.chargedRub / stats.messages).toFixed(4) : 0,
      })),
    },
  });
}
