// src/app/api/ai-assistant/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — получить текущие настройки AI-ассистента */
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
      apiKey: settings.apiKey ? maskKey(settings.apiKey) : null,
      hasApiKey: !!settings.apiKey,
      assistantId: settings.assistantId ?? "",
      vectorStoreId: settings.vectorStoreId ?? "",
      instructions: settings.instructions ?? "",
    },
  });
}

/** PUT — обновить настройки AI-ассистента */
export async function PUT(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json(
      { ok: false, error: "invalid_body" },
      { status: 400 },
    );
  }

  const { enabled, apiKey, assistantId, vectorStoreId, instructions } = body;

  const data: Record<string, unknown> = {};

  if (typeof enabled === "boolean") data.enabled = enabled;
  if (typeof apiKey === "string") data.apiKey = apiKey || null;
  if (typeof assistantId === "string") data.assistantId = assistantId || null;
  if (typeof vectorStoreId === "string") data.vectorStoreId = vectorStoreId || null;
  if (typeof instructions === "string") data.instructions = instructions || null;

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
      apiKey: settings.apiKey ? maskKey(settings.apiKey) : null,
      hasApiKey: !!settings.apiKey,
      assistantId: settings.assistantId ?? "",
      vectorStoreId: settings.vectorStoreId ?? "",
      instructions: settings.instructions ?? "",
    },
  });
}

/** Маскировать API-ключ: показываем первые 3 и последние 4 символа */
function maskKey(key: string): string {
  if (key.length <= 8) return "***";
  return key.slice(0, 3) + "..." + key.slice(-4);
}
