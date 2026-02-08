// src/app/api/avito/subscribe/route.ts
// Управление подпиской на вебхуки Авито для мгновенной доставки сообщений.
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  avitoSubscribeWebhook,
  avitoUnsubscribeWebhook,
  avitoGetWebhookSubscriptions,
} from "@/lib/avito";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildWebhookUrl(): string {
  const base = (env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("PUBLIC_BASE_URL is not configured");
  return `${base}/api/avito/webhook?key=${encodeURIComponent(env.CRM_WEBHOOK_KEY)}`;
}

/** GET — текущий статус подписки */
export async function GET(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  if (env.MOCK_MODE) {
    return NextResponse.json({
      ok: true,
      mock: true,
      subscribed: false,
      subscriptions: [],
      webhookUrl: null,
    });
  }

  try {
    const subs = await avitoGetWebhookSubscriptions();
    const webhookUrl = buildWebhookUrl();
    const ours = subs.find((s) => s.url && s.url === webhookUrl);
    return NextResponse.json({
      ok: true,
      subscribed: !!ours,
      activeSubscription: ours ?? null,
      subscriptions: subs,
      webhookUrl,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 502 }
    );
  }
}

/** POST — подписаться на вебхуки */
export async function POST(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  if (env.MOCK_MODE) {
    return NextResponse.json({ ok: false, error: "Cannot subscribe in MOCK_MODE" }, { status: 400 });
  }

  try {
    const webhookUrl = buildWebhookUrl();
    const sub = await avitoSubscribeWebhook(webhookUrl);
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
    return NextResponse.json({ ok: false, error: "Cannot unsubscribe in MOCK_MODE" }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const subscriptionId = (body as any)?.subscriptionId ?? undefined;
    await avitoUnsubscribeWebhook(subscriptionId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 502 }
    );
  }
}
