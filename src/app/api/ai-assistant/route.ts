// src/app/api/ai-assistant/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { fetchAssistantInstructions, updateAssistantInstructions } from "@/lib/openai";

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

  // Подтягиваем актуальные instructions с OpenAI (если есть ключ и assistantId)
  let instructions = settings.instructions ?? "";
  if (settings.apiKey && settings.assistantId) {
    try {
      const remoteInstructions = await fetchAssistantInstructions(
        settings.apiKey,
        settings.assistantId,
      );
      const remote = remoteInstructions ?? "";
      if (remote !== instructions) {
        // Обновляем локальную БД актуальной версией из OpenAI
        await prisma.aiAssistant.update({
          where: { id: 1 },
          data: { instructions: remote || null },
        });
        instructions = remote;
      }
    } catch (e) {
      console.error("[AI] Failed to fetch instructions from OpenAI:", e);
      // При ошибке возвращаем локальную версию
    }
  }

  return NextResponse.json({
    ok: true,
    data: {
      enabled: settings.enabled,
      apiKey: settings.apiKey ? maskKey(settings.apiKey) : null,
      hasApiKey: !!settings.apiKey,
      assistantId: settings.assistantId ?? "",
      vectorStoreId: settings.vectorStoreId ?? "",
      instructions,
      model: settings.model ?? "",
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

  const { enabled, apiKey, assistantId, vectorStoreId, instructions, model } = body;

  const data: Record<string, unknown> = {};

  if (typeof enabled === "boolean") data.enabled = enabled;
  if (typeof apiKey === "string") data.apiKey = apiKey || null;
  if (typeof assistantId === "string") data.assistantId = assistantId || null;
  if (typeof vectorStoreId === "string") data.vectorStoreId = vectorStoreId || null;
  if (typeof instructions === "string") data.instructions = instructions || null;
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

  // Синхронизируем instructions и vector store с OpenAI, если есть ключ и assistantId
  // Модель НЕ синхронизируем — она применяется как per-run override при каждом запуске
  const needSync =
    (typeof instructions === "string" || typeof vectorStoreId === "string") &&
    settings.apiKey &&
    settings.assistantId;

  if (needSync) {
    try {
      await updateAssistantInstructions(
        settings.apiKey!,
        settings.assistantId!,
        settings.instructions,
        settings.vectorStoreId,
      );
    } catch (e) {
      console.error("[AI] Failed to sync assistant config to OpenAI:", e);
      return NextResponse.json({
        ok: false,
        error: "instructions_sync_failed",
        message: "Настройки сохранены, но не удалось синхронизировать конфигурацию с OpenAI. Проверьте API Key и Assistant ID.",
      }, { status: 502 });
    }
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
      model: settings.model ?? "",
    },
  });
}

/** Маскировать API-ключ: показываем первые 3 и последние 4 символа */
function maskKey(key: string): string {
  if (key.length <= 8) return "***";
  return key.slice(0, 3) + "..." + key.slice(-4);
}
