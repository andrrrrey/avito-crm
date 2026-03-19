// src/app/api/avito/subscribe/route.ts
// Управление подпиской на вебхуки Авито для мгновенной доставки сообщений.
import { NextResponse } from "next/server";
import { requireAuth, getSessionUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { getAiSettings } from "@/lib/openai";
import {
  avitoSubscribeWebhook,
  avitoUnsubscribeWebhook,
  avitoGetWebhookSubscriptions,
  getAvitoCredentials,
} from "@/lib/avito";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Кэш состояния подписки — per-account.
 * Avito API не поддерживает GET для проверки статуса вебхука (404),
 * поэтому после успешного POST/DELETE сохраняем состояние здесь.
 * При рестарте сервера сбрасывается — пользователь может нажать кнопку повторно.
 */
const cachedWebhookStateByAccount = new Map<number, {
  subscribed: boolean;
  webhookUrl: string | null;
  subscribedAt: string | null;
}>();

function getCachedState(accountId: number) {
  return cachedWebhookStateByAccount.get(accountId) ?? { subscribed: false, webhookUrl: null, subscribedAt: null };
}

function buildWebhookUrl(accountId?: number): string {
  const base = (env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("PUBLIC_BASE_URL не настроен — задайте публичный URL сервера");
  const url = `${base}/api/avito/webhook?key=${encodeURIComponent(env.CRM_WEBHOOK_KEY)}`;
  if (accountId) return `${url}&accountId=${accountId}`;
  return url;
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

  // Avito credentials — проверяем env, иначе fallback на БД (личный кабинет)
  const avitoCredentialsOk = await getAvitoCredentials().then(() => true).catch(() => false);
  if (!avitoCredentialsOk) {
    if (!env.AVITO_CLIENT_ID) issues.push("AVITO_CLIENT_ID не задан");
    if (!env.AVITO_CLIENT_SECRET) issues.push("AVITO_CLIENT_SECRET не задан");
    if (!env.AVITO_ACCOUNT_ID) issues.push("AVITO_ACCOUNT_ID не задан");
  }

  // AI assistant
  const ai = await getAiSettings().catch(() => null);
  if (!ai?.enabled) {
    issues.push("AI-ассистент выключен — включите на странице /ai-assistant");
  } else {
    if (!ai.apiKey) issues.push("AI-ассистент: не задан OpenAI API ключ");
    if (!ai.model) issues.push("AI-ассистент: не задана модель GPT");
  }

  return {
    publicBaseUrl: base || null,
    hasAvitoCredentials: avitoCredentialsOk,
    aiEnabled: ai?.enabled ?? false,
    aiConfigured: !!(ai?.enabled && ai?.apiKey && ai?.model),
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
      subscriptions: [],
      webhookUrl: null,
      diagnostics,
    });
  }

  const sessionUser = await getSessionUser(req);
  const creds = await getAvitoCredentials(sessionUser?.id ?? undefined).catch(() => null);

  let webhookUrl: string | null = null;
  try {
    webhookUrl = buildWebhookUrl(creds?.accountId);
  } catch {}

  try {
    const subs = await avitoGetWebhookSubscriptions(creds ?? undefined);

    // Считаем подписанными, если есть хотя бы одна подписка с нашим URL
    const ours = webhookUrl
      ? subs.find((s) => s.url && s.url === webhookUrl)
      : null;
    const hasAnySub = subs.some((s) => !!s.url);

    return NextResponse.json({
      ok: true,
      subscribed: !!(ours ?? hasAnySub),
      activeSubscription: ours ?? (hasAnySub ? subs[0] : null),
      subscriptions: subs,
      webhookUrl,
      diagnostics,
    });
  } catch (e: any) {
    // Avito API не поддерживает GET для проверки статуса подписки (404).
    // Используем per-account кэшированное состояние после последнего POST/DELETE.
    const cached = creds ? getCachedState(creds.accountId) : { subscribed: false, webhookUrl: null, subscribedAt: null };

    return NextResponse.json({
      ok: true,
      subscribed: cached.subscribed,
      activeSubscription: cached.subscribed
        ? { url: cached.webhookUrl }
        : null,
      subscriptions: [],
      webhookUrl,
      diagnostics,
      note: "Статус получен из кэша — Avito API не поддерживает GET-проверку подписки",
    });
  }
}

/** POST — подписаться на вебхуки */
export async function POST(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  if (env.MOCK_MODE) {
    return NextResponse.json({ ok: false, error: "В MOCK_MODE подписка невозможна — отключите MOCK_MODE" }, { status: 400 });
  }

  try {
    const sessionUser = await getSessionUser(req);
    const creds = await getAvitoCredentials(sessionUser?.id ?? undefined);
    const webhookUrl = buildWebhookUrl(creds.accountId);
    const sub = await avitoSubscribeWebhook(webhookUrl, creds);
    cachedWebhookStateByAccount.set(creds.accountId, { subscribed: true, webhookUrl, subscribedAt: new Date().toISOString() });
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
    const sessionUser = await getSessionUser(req);
    const creds = await getAvitoCredentials(sessionUser?.id ?? undefined).catch(() => null);
    await avitoUnsubscribeWebhook(creds ?? undefined);
    if (creds) {
      cachedWebhookStateByAccount.set(creds.accountId, { subscribed: false, webhookUrl: null, subscribedAt: null });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 502 }
    );
  }
}
