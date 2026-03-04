// src/app/api/ai-assistant/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — получить текущие настройки AI-ассистента (доступно всем авторизованным) */
export async function GET(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  let settings = await prisma.aiAssistant.findUnique({ where: { id: 1 } });

  if (!settings) {
    settings = await prisma.aiAssistant.create({
      data: { id: 1, enabled: false },
    });
  }

  return NextResponse.json({
    ok: true,
    data: {
      enabled: settings.enabled,
      provider: settings.provider ?? "openai",
      apiKey: settings.apiKey ? maskKey(settings.apiKey) : null,
      hasApiKey: !!settings.apiKey,
      deepseekApiKey: settings.deepseekApiKey ? maskKey(settings.deepseekApiKey) : null,
      hasDeepseekApiKey: !!settings.deepseekApiKey,
      vectorStoreId: settings.vectorStoreId ?? "",
      instructions: settings.instructions ?? "",
      escalatePrompt: settings.escalatePrompt ?? "",
      model: settings.model ?? "",
    },
  });
}

/** PUT — обновить настройки AI-ассистента (только для ADMIN) */
export async function PUT(req: Request) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json(
      { ok: false, error: "invalid_body" },
      { status: 400 },
    );
  }

  const { enabled, provider, apiKey, deepseekApiKey, vectorStoreId, instructions, escalatePrompt, model } = body;

  const data: Record<string, unknown> = {};

  if (typeof enabled === "boolean") data.enabled = enabled;
  if (typeof provider === "string") data.provider = provider || "openai";
  if (typeof apiKey === "string") data.apiKey = apiKey || null;
  if (typeof deepseekApiKey === "string") data.deepseekApiKey = deepseekApiKey || null;
  if (typeof vectorStoreId === "string") data.vectorStoreId = vectorStoreId || null;
  if (typeof instructions === "string") data.instructions = instructions || null;
  if (typeof escalatePrompt === "string") data.escalatePrompt = escalatePrompt || null;
  if (typeof model === "string") data.model = model || null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { ok: false, error: "nothing_to_update" },
      { status: 400 },
    );
  }

  const settings = await prisma.aiAssistant.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });

  return NextResponse.json({
    ok: true,
    data: {
      enabled: settings.enabled,
      provider: settings.provider ?? "openai",
      apiKey: settings.apiKey ? maskKey(settings.apiKey) : null,
      hasApiKey: !!settings.apiKey,
      deepseekApiKey: settings.deepseekApiKey ? maskKey(settings.deepseekApiKey) : null,
      hasDeepseekApiKey: !!settings.deepseekApiKey,
      vectorStoreId: settings.vectorStoreId ?? "",
      instructions: settings.instructions ?? "",
      escalatePrompt: settings.escalatePrompt ?? "",
      model: settings.model ?? "",
    },
  });
}

/** Маскировать API-ключ: показываем первые 3 и последние 4 символа */
function maskKey(key: string): string {
  if (key.length <= 8) return "***";
  return key.slice(0, 3) + "..." + key.slice(-4);
}
