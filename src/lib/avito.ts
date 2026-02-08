// src/lib/avito.ts
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

const AVITO_BASE = "https://api.avito.ru";

// ✅ добавили items:info (нужно для /core/v1/.../items/{item_id})
const DEFAULT_SCOPE = "messenger:read messenger:write items:info";

type TokenResp = {
  access_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
};

function encodePathSegmentStrict(s: string) {
  return encodeURIComponent(s).replace(/~/g, "%7E");
}

function normalizePrice(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  if (typeof v === "object") return normalizePrice(v.value ?? v.amount ?? v.price ?? v.sum ?? v.cost);
  return null;
}

async function getAccessToken(): Promise<string> {
  const st = await prisma.integrationState.findUnique({ where: { id: 1 } });
  const now = Date.now();

  if (st?.accessToken && st.expiresAt && st.expiresAt.getTime() - now > 60_000) {
    return st.accessToken;
  }

  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", env.AVITO_CLIENT_ID!);
  form.set("client_secret", env.AVITO_CLIENT_SECRET!);
  form.set("scope", DEFAULT_SCOPE);

  const r = await fetch(`${AVITO_BASE}/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Avito token error: ${r.status} ${t}`);
  }

  const j = (await r.json()) as TokenResp;
  const expiresAt = new Date(Date.now() + (j.expires_in ?? 0) * 1000);

  await prisma.integrationState.upsert({
    where: { id: 1 },
    create: { id: 1, accessToken: j.access_token, expiresAt },
    update: { accessToken: j.access_token, expiresAt },
  });

  return j.access_token;
}

async function avitoFetch(path: string, init?: RequestInit, retry = true) {
  const token = await getAccessToken();

  const r = await fetch(`${AVITO_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });

  if (r.status === 401 && retry) {
    await prisma.integrationState
      .update({ where: { id: 1 }, data: { accessToken: null, expiresAt: null } })
      .catch(() => null);
    return avitoFetch(path, init, false);
  }

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Avito API error ${r.status} on ${path}: ${t}`);
  }

  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return r.json();
  return r.text();
}

/**
 * Чаты: v2 (как в доке). fallback v1.
 */
/**
 * Чаты: пробуем v3 -> v2 -> v1
 */
export async function avitoListChats(params?: { limit?: number; offset?: number }) {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  const q = qs.toString();
  const suffix = q ? `?${q}` : "";

  const accountId = env.AVITO_ACCOUNT_ID;

  // v3
  try {
    return await avitoFetch(`/messenger/v3/accounts/${accountId}/chats${suffix}`);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    // если v3 не существует/не доступен — идем дальше
    if (!msg.includes("404")) {
      // если это не 404 — может быть лимит offset (400) или другое — пробуем ниже,
      // но если хочешь, можешь здесь "throw" для строгого режима
    }
  }

  // v2
  try {
    return await avitoFetch(`/messenger/v2/accounts/${accountId}/chats${suffix}`);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes("404")) {
      return avitoFetch(`/messenger/v1/accounts/${accountId}/chats${suffix}`);
    }
    throw e;
  }
}

export async function avitoGetChatInfo(avitoChatId: string) {
  const chatId = encodePathSegmentStrict(avitoChatId);
  const accountId = env.AVITO_ACCOUNT_ID;
  if (!accountId) throw new Error("AVITO_ACCOUNT_ID is missing");

  const endpoints = [
    `/messenger/v2/accounts/${accountId}/chats/${chatId}`,
    `/messenger/v1/accounts/${accountId}/chats/${chatId}`,
  ];

  let lastErr: any = null;

  for (const ep of endpoints) {
    try {
      return await avitoFetch(ep);
    } catch (e: any) {
      lastErr = e;
    }
  }

  throw new Error(
    `avitoGetChatInfo failed for chat=${avitoChatId}: ${String(lastErr?.message ?? lastErr)}`
  );
}

/**
 * Сообщения: v3. fallback v2/v1.
 */
export async function avitoListMessages(avitoChatId: string, params?: { limit?: number; offset?: number }) {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  const q = qs.toString();

  const chatId = encodePathSegmentStrict(avitoChatId);

  try {
    return await avitoFetch(
      `/messenger/v3/accounts/${env.AVITO_ACCOUNT_ID}/chats/${chatId}/messages${q ? `?${q}` : ""}`
    );
  } catch {
    try {
      return await avitoFetch(
        `/messenger/v2/accounts/${env.AVITO_ACCOUNT_ID}/chats/${chatId}/messages${q ? `?${q}` : ""}`
      );
    } catch {
      return avitoFetch(
        `/messenger/v1/accounts/${env.AVITO_ACCOUNT_ID}/chats/${chatId}/messages${q ? `?${q}` : ""}`
      );
    }
  }
}

export async function avitoSendTextMessage(avitoChatId: string, text: string) {
  const chatId = encodePathSegmentStrict(avitoChatId);

  const body = { type: "text", message: { text } };

  return avitoFetch(`/messenger/v1/accounts/${env.AVITO_ACCOUNT_ID}/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * ✅ Объявление по item_id: GET /core/v1/accounts/{user_id}/items/{item_id}/
 * (эндпоинт встречается в публичных спецификациях/SDK). :contentReference[oaicite:2]{index=2}
 */
export async function avitoGetItemInfo(itemId: number): Promise<{
  itemId: number;
  title: string | null;
  price: number | null;
  url: string | null;
  raw: any;
}> {
  const accountId = env.AVITO_ACCOUNT_ID;
  if (!accountId) throw new Error("AVITO_ACCOUNT_ID is missing");

  const paths = [
    `/core/v1/accounts/${accountId}/items/${itemId}/`,
    `/core/v1/accounts/${accountId}/items/${itemId}`,
  ];

  let lastErr: any = null;

  for (const path of paths) {
    try {
      const j: any = await avitoFetch(path);

      const title =
        (typeof j?.title === "string" ? j.title : null) ??
        (typeof j?.item?.title === "string" ? j.item.title : null);

      const price =
        normalizePrice(j?.price?.value) ??
        normalizePrice(j?.price?.amount) ??
        normalizePrice(j?.price) ??
        normalizePrice(j?.item?.price?.value) ??
        normalizePrice(j?.item?.price?.amount) ??
        normalizePrice(j?.item?.price) ??
        null;

      const url =
        (typeof j?.url === "string" ? j.url : null) ??
        (typeof j?.item?.url === "string" ? j.item.url : null);

      return { itemId, title, price, url, raw: j };
    } catch (e: any) {
      lastErr = e;
    }
  }

  throw new Error(`avitoGetItemInfo failed for itemId=${itemId}: ${String(lastErr?.message ?? lastErr)}`);
}
// src/lib/avito.ts (в конец файла)
// src/lib/avito.ts (добавь в конец файла)

export type AvitoItemsListResource = {
  itemId: number;
  title: string | null;
  price: number | null;
  url: string | null;
  status: string | null;
  raw: any;
};

export async function avitoListItems(params?: {
  perPage?: number;
  page?: number;
  status?: string; // например "active" или "active,old"
  category?: number;
  updatedAtFrom?: string; // "YYYY-MM-DD"
}): Promise<{ resources: AvitoItemsListResource[]; raw: any }> {
  const qs = new URLSearchParams();
  qs.set("per_page", String(params?.perPage ?? 100));
  qs.set("page", String(params?.page ?? 1));

  if (params?.status) qs.set("status", params.status);
  if (typeof params?.category === "number") qs.set("category", String(params.category));
  if (params?.updatedAtFrom) qs.set("updatedAtFrom", params.updatedAtFrom);

  const path = `/core/v1/items?${qs.toString()}`;
  const j: any = await avitoFetch(path);

  const arr: any[] = Array.isArray(j?.resources) ? j.resources : [];
  const resources: AvitoItemsListResource[] = arr
    .map((r) => {
      const idNum = Number(r?.id);
      if (!Number.isFinite(idNum)) return null;

      return {
        itemId: idNum,
        title: typeof r?.title === "string" ? r.title : null,
        price: normalizePrice(r?.price),
        url: typeof r?.url === "string" ? r.url : null,
        status: typeof r?.status === "string" ? r.status : null,
        raw: r,
      };
    })
    .filter(Boolean) as AvitoItemsListResource[];

  return { resources, raw: j };
}

export async function avitoFetchAllItemsMap(opts?: {
  status?: string; // default "active,old"
  perPage?: number; // default 100
  maxPages?: number; // safety
}): Promise<Map<number, AvitoItemsListResource>> {
  const perPage = Math.max(1, Math.min(100, opts?.perPage ?? 100));
  const status = opts?.status ?? "active,old";
  const maxPages = opts?.maxPages ?? 50;

  const map = new Map<number, AvitoItemsListResource>();

  for (let page = 1; page <= maxPages; page++) {
    const { resources } = await avitoListItems({ perPage, page, status });
    for (const r of resources) map.set(r.itemId, r);

    // если страница неполная — дальше смысла нет
    if (resources.length < perPage) break;
  }

  return map;
}

// ===== in-memory cache (чтобы не долбить /core/v1/items на каждый вебхук) =====
let ITEMS_CACHE: { at: number; map: Map<number, AvitoItemsListResource> } | null = null;

export async function avitoGetItemFromItemsListCached(
  itemId: number,
  ttlMs = 5 * 60_000
): Promise<AvitoItemsListResource | null> {
  const now = Date.now();
  const needRefresh = !ITEMS_CACHE || now - ITEMS_CACHE.at > ttlMs;

  if (needRefresh) {
    const map = await avitoFetchAllItemsMap({ status: "active,old", perPage: 100, maxPages: 50 });
    ITEMS_CACHE = { at: now, map };
  }

  return ITEMS_CACHE?.map.get(itemId) ?? null;
}

export async function avitoMarkChatRead(avitoChatId: string, lastMessageId?: string) {
  const chatId = encodePathSegmentStrict(avitoChatId);
  const accountId = env.AVITO_ACCOUNT_ID;
  if (!accountId) throw new Error("AVITO_ACCOUNT_ID is missing");

  const bodies: Array<any> = [
    undefined,
    lastMessageId ? { message_id: lastMessageId } : undefined,
    lastMessageId ? { messageId: lastMessageId } : undefined,
    lastMessageId ? { last_message_id: lastMessageId } : undefined,
    lastMessageId ? { lastMessageId: lastMessageId } : undefined,
    lastMessageId ? { last_read_message_id: lastMessageId } : undefined,
  ].filter((x, i, arr) => i === arr.findIndex((y) => JSON.stringify(y) === JSON.stringify(x)));

  const endpoints = [
    `/messenger/v3/accounts/${accountId}/chats/${chatId}/read`,
    `/messenger/v2/accounts/${accountId}/chats/${chatId}/read`,
    `/messenger/v1/accounts/${accountId}/chats/${chatId}/read`,
  ];

  const methods: Array<"POST" | "PUT"> = ["POST", "PUT"];

  let lastErr: any = null;

  for (const ep of endpoints) {
    for (const method of methods) {
      for (const body of bodies) {
        try {
          await avitoFetch(ep, {
            method,
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body: body ? JSON.stringify(body) : undefined,
          });
          return;
        } catch (e: any) {
          lastErr = e;
          // перебираем варианты дальше
          continue;
        }
      }
    }
  }

  throw new Error(
    `Avito mark read failed for chat=${avitoChatId}: ${String(lastErr?.message ?? lastErr)}`
  );
}

// ===== Webhook subscription =====

export type AvitoWebhookSubscription = {
  id?: string;
  url?: string;
  raw: any;
};

/**
 * Subscribe to Avito webhook notifications (instant message delivery).
 * Tries v3 → v2 → v1 endpoints.
 */
export async function avitoSubscribeWebhook(webhookUrl: string): Promise<AvitoWebhookSubscription> {
  const accountId = env.AVITO_ACCOUNT_ID;
  if (!accountId) throw new Error("AVITO_ACCOUNT_ID is missing");

  const body = JSON.stringify({ url: webhookUrl });
  const headers = { "Content-Type": "application/json" };

  const endpoints = [
    `/messenger/v3/accounts/${accountId}/webhook`,
    `/messenger/v2/accounts/${accountId}/subscriptions_v2`,
    `/messenger/v2/accounts/${accountId}/subscriptions`,
    `/messenger/v1/subscriptions/${accountId}`,
  ];

  let lastErr: any = null;

  for (const ep of endpoints) {
    try {
      const resp: any = await avitoFetch(ep, { method: "POST", headers, body });
      return {
        id: resp?.id ?? resp?.subscription_id ?? resp?.subscriptionId ?? undefined,
        url: resp?.url ?? webhookUrl,
        raw: resp,
      };
    } catch (e: any) {
      lastErr = e;
    }
  }

  throw new Error(
    `Avito webhook subscribe failed: ${String(lastErr?.message ?? lastErr)}`
  );
}

/**
 * Unsubscribe from Avito webhook notifications.
 */
export async function avitoUnsubscribeWebhook(subscriptionId?: string): Promise<void> {
  const accountId = env.AVITO_ACCOUNT_ID;
  if (!accountId) throw new Error("AVITO_ACCOUNT_ID is missing");

  const endpoints = subscriptionId
    ? [
        `/messenger/v3/accounts/${accountId}/webhook`,
        `/messenger/v2/accounts/${accountId}/subscriptions/${subscriptionId}`,
        `/messenger/v1/subscriptions/${accountId}`,
      ]
    : [
        `/messenger/v3/accounts/${accountId}/webhook`,
        `/messenger/v1/subscriptions/${accountId}`,
      ];

  let lastErr: any = null;

  for (const ep of endpoints) {
    try {
      await avitoFetch(ep, { method: "DELETE" });
      return;
    } catch (e: any) {
      lastErr = e;
    }
  }

  throw new Error(
    `Avito webhook unsubscribe failed: ${String(lastErr?.message ?? lastErr)}`
  );
}

/**
 * Get current Avito webhook subscriptions.
 */
export async function avitoGetWebhookSubscriptions(): Promise<AvitoWebhookSubscription[]> {
  const accountId = env.AVITO_ACCOUNT_ID;
  if (!accountId) throw new Error("AVITO_ACCOUNT_ID is missing");

  const endpoints = [
    `/messenger/v3/accounts/${accountId}/webhook`,
    `/messenger/v2/accounts/${accountId}/subscriptions`,
    `/messenger/v1/subscriptions/${accountId}`,
  ];

  let lastErr: any = null;

  for (const ep of endpoints) {
    try {
      const resp: any = await avitoFetch(ep, { method: "GET" });

      // Normalize to array
      const items: any[] = Array.isArray(resp?.subscriptions)
        ? resp.subscriptions
        : Array.isArray(resp?.items)
          ? resp.items
          : Array.isArray(resp)
            ? resp
            : resp?.url
              ? [resp]
              : [];

      return items.map((s: any) => ({
        id: s?.id ?? s?.subscription_id ?? s?.subscriptionId ?? undefined,
        url: s?.url ?? undefined,
        raw: s,
      }));
    } catch (e: any) {
      lastErr = e;
    }
  }

  throw new Error(
    `Avito get webhook subscriptions failed: ${String(lastErr?.message ?? lastErr)}`
  );
}
