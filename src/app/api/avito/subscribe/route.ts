// src/app/api/avito/subscribe/route.ts
// Управление подпиской на вебхуки Авито для мгновенной доставки сообщений.
//
// Avito API не поддерживает GET-проверку вебхук-подписок (возвращает 404),
// поэтому состояние подписки хранится in-memory. После рестарта сервера
// кнопку нужно нажать снова (подписка на стороне Avito сохраняется).
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import { getAiSettings } from "@/lib/openai";
import {
  avitoSubscribeWebhook,
  avitoUnsubscribeWebhook,
} from "@/lib/avito";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildWebhookUrl(): string {
  const base = (env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("PUBLIC_BASE_URL не настроен — задайте публичный URL сервера");
  return `${base}/api/avito/webhook?key=${encodeURIComponent(env.CRM_WEBHOOK_KEY)}`;
}

// ----- In-memory состояние подписки -----
// Используем globalThis чтобы состояние жило в рамках Node.js процесса
// и не сбрасывалось при HMR в dev режиме.
type WebhookState = { subscribed: boolean; url: string | null; subscribedAt: string | null };
const g = globalThis as any;
if (!g.__webhookState) g.__webhookState = { subscribed: false, url: null, subscribedAt: null };

function getWebhookState(): WebhookState {
  return g.__webhookState;
}

function setWebhookState(url: string | null) {
  g.__webhookState = {
    subscribed: !!url,
    url,
    subscribedAt: url ? new Date().toISOString() : null,
  };
}

/** Диагностика конфигурации */
async function getDiagnostics() {
  const issues: string[] = [];

  // PUBLIC_BASE_URL
  const base = (env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base) {
    issues.push("PUBLIC_BASE_URL не задан — Avito не сможет доставлять сообщения");
  } else if (base.startsWith("http://localhost") || base.startsWith("http://127.0.0.1")) {
    issues.push("PUBLIC_BASE_URL указывает на localhost — Avito не сможет достучаться. Используйте публичный домен или туннель (ngrok, Cloudflare Tunnel)");
  } else if (!base.startsWith("https://")) {
    issues.push("PUBLIC_BASE_URL должен использовать HTTPS — Avito не принимает HTTP и самоподписанные сертификаты");
  }

  // Avito credentials
  if (!env.AVITO_CLIENT_ID) issues.push("AVITO_CLIENT_ID не задан");
  if (!env.AVITO_CLIENT_SECRET) issues.push("AVITO_CLIENT_SECRET не задан");
  if (!env.AVITO_ACCOUNT_ID) issues.push("AVITO_ACCOUNT_ID не задан");

  // AI assistant
  const ai = await getAiSettings().catch(() => null);
  if (!ai?.enabled) {
    issues.push("AI-ассистент выключен — включите на странице /ai-assistant");
  } else {
    if (!ai.apiKey) issues.push("AI-ассистент: не задан OpenAI API ключ");
    if (!ai.assistantId) issues.push("AI-ассистент: не задан Assistant ID");
  }

  return {
    publicBaseUrl: base || null,
    hasAvitoCredentials: !!(env.AVITO_CLIENT_ID && env.AVITO_CLIENT_SECRET && env.AVITO_ACCOUNT_ID),
    aiEnabled: ai?.enabled ?? false,
    aiConfigured: !!(ai?.enabled && ai?.apiKey && ai?.assistantId),
    issues,
    healthy: issues.length === 0,
  };
}

/** GET — текущий статус подписки + диагностика */
export async function GET(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const diagnostics = await getDiagnostics();

  if (env.MOCK_MODE) {
    return NextResponse.json({
      ok: true,
      mock: true,
      subscribed: false,
      webhookUrl: null,
      diagnostics,
    });
  }

  let webhookUrl: string | null = null;
  try {
    webhookUrl = buildWebhookUrl();
  } catch {}

  const state = getWebhookState();

  return NextResponse.json({
    ok: true,
    subscribed: state.subscribed,
    webhookUrl: state.url ?? webhookUrl,
    subscribedAt: state.subscribedAt,
    diagnostics,
  });
}

/** POST — подписаться на вебхуки */
export async function POST(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  if (env.MOCK_MODE) {
    return NextResponse.json({ ok: false, error: "В MOCK_MODE подписка невозможна — отключите MOCK_MODE" }, { status: 400 });
  }

  try {
    const webhookUrl = buildWebhookUrl();
    const sub = await avitoSubscribeWebhook(webhookUrl);

    // Сохраняем состояние in-memory (Avito GET не поддерживает проверку)
    setWebhookState(webhookUrl);

    return NextResponse.json({ ok: true, subscription: sub, webhookUrl });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 502 }
    );
  }
}

/** DELETE — отписаться от вебхуков */
export async function DELETE(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  if (env.MOCK_MODE) {
    return NextResponse.json({ ok: false, error: "В MOCK_MODE отписка невозможна" }, { status: 400 });
  }

  try {
    await avitoUnsubscribeWebhook();
  } catch (e: any) {
    // Даже если DELETE на Avito упал, очищаем локальное состояние
    console.warn("[Webhook] Unsubscribe from Avito failed:", e?.message);
  }

  setWebhookState(null);
  return NextResponse.json({ ok: true });
}
