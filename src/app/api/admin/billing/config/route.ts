// src/app/api/admin/billing/config/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_CONFIG = {
  openaiMarkupMultiplier: 2.5,
  openaiUsdToRub: 90,
  deepseekMarkupMultiplier: 2.5,
  deepseekUsdToRub: 90,
  gpt52InputPrice: 15,
  gpt52OutputPrice: 60,
  deepseekInputPrice: 0.27,
  deepseekOutputPrice: 1.10,
};

/** GET /api/admin/billing/config — получить настройки биллинга */
export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  let config = await prisma.billingConfig.findUnique({ where: { id: 1 } });
  if (!config) {
    config = await prisma.billingConfig.create({ data: { id: 1 } });
  }

  // Статистика средней стоимости сообщения за 30 дней по моделям
  const since30d = new Date(Date.now() - 30 * 86400_000);
  const stats30d = await prisma.aiMessageBilling.groupBy({
    by: ["model"],
    where: { createdAt: { gte: since30d } },
    _count: { id: true },
    _avg: { costRub: true, chargedRub: true },
  });

  return NextResponse.json({
    ok: true,
    data: {
      openaiMarkupMultiplier: Number(config.openaiMarkupMultiplier),
      openaiUsdToRub: Number(config.openaiUsdToRub),
      deepseekMarkupMultiplier: Number(config.deepseekMarkupMultiplier),
      deepseekUsdToRub: Number(config.deepseekUsdToRub),
      gpt52InputPrice: Number(config.gpt52InputPrice),
      gpt52OutputPrice: Number(config.gpt52OutputPrice),
      deepseekInputPrice: Number(config.deepseekInputPrice),
      deepseekOutputPrice: Number(config.deepseekOutputPrice),
      updatedAt: config.updatedAt,
      modelStats: stats30d.map((s) => ({
        model: s.model,
        messages: s._count.id,
        avgCostRub: s._avg.costRub ? +Number(s._avg.costRub).toFixed(4) : 0,
        avgChargedRub: s._avg.chargedRub ? +Number(s._avg.chargedRub).toFixed(4) : 0,
      })),
    },
  });
}

/** PUT /api/admin/billing/config — обновить настройки биллинга */
export async function PUT(req: Request) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const data: Record<string, number> = {};

  const numFields = [
    "openaiMarkupMultiplier",
    "openaiUsdToRub",
    "deepseekMarkupMultiplier",
    "deepseekUsdToRub",
    "gpt52InputPrice",
    "gpt52OutputPrice",
    "deepseekInputPrice",
    "deepseekOutputPrice",
  ] as const;

  for (const field of numFields) {
    if (typeof body[field] === "number" && body[field] > 0) {
      data[field] = body[field];
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: "nothing_to_update" }, { status: 400 });
  }

  const config = await prisma.billingConfig.upsert({
    where: { id: 1 },
    create: { id: 1, ...DEFAULT_CONFIG, ...data },
    update: data,
  });

  return NextResponse.json({
    ok: true,
    data: {
      openaiMarkupMultiplier: Number(config.openaiMarkupMultiplier),
      openaiUsdToRub: Number(config.openaiUsdToRub),
      deepseekMarkupMultiplier: Number(config.deepseekMarkupMultiplier),
      deepseekUsdToRub: Number(config.deepseekUsdToRub),
      gpt52InputPrice: Number(config.gpt52InputPrice),
      gpt52OutputPrice: Number(config.gpt52OutputPrice),
      deepseekInputPrice: Number(config.deepseekInputPrice),
      deepseekOutputPrice: Number(config.deepseekOutputPrice),
      updatedAt: config.updatedAt,
    },
  });
}
