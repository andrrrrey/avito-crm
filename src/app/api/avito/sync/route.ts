// src/app/api/avito/sync/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthOrCron } from "@/lib/auth";
import { env } from "@/lib/env";
import { avitoListChats, avitoGetItemInfo } from "@/lib/avito";
import { pickFirstString, pickFirstNumber } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Avito url часто заканчивается ..._7671727110 */
function extractItemIdFromAdUrl(adUrl: string | null): number | null {
  if (!adUrl) return null;
  const m = adUrl.match(/_(\d+)(?:\?|$)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function normalizePriceRub(v: any): number | null {
  if (v === null || v === undefined) return null;

  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);

  if (typeof v === "string") {
    const digits = v.replace(/[^\d]/g, "");
    if (!digits) return null;
    const n = Number(digits);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  if (typeof v === "object") {
    // Avito иногда отдаёт price объектом
    return normalizePriceRub(
      (v as any).value ??
        (v as any).amount ??
        (v as any).price ??
        (v as any).sum ??
        (v as any).cost
    );
  }

  return null;
}

function getByPath(obj: any, path: string): any {
  if (!obj) return undefined;
  const parts = path.split(".");
  let cur: any = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Достаём цену из itemInfo по разным возможным путям.
 * НЕ зависит от сигнатуры pickFirstNumber/pickFirstString.
 */
function extractPriceRubFromItemInfo(itemInfo: any): number | null {
  const paths = [
    "price",
    "price.value",
    "price.amount",
    "item.price",
    "item.price.value",
    "item.price.amount",
    "data.price",
    "data.price.value",
    "data.price.amount",
    "result.price",
    "result.price.value",
    "result.price.amount",
    "value.price",
    "value.price.value",
    "value.price.amount",
  ];

  // 1) сначала прямые
  const direct = normalizePriceRub((itemInfo as any)?.price);
  if (direct !== null) return direct;

  // 2) потом по путям
  for (const p of paths) {
    const v = getByPath(itemInfo, p);
    const n = normalizePriceRub(v);
    if (n !== null) return n;
  }

  return null;
}

function extractTitleFromItemInfo(itemInfo: any): string | null {
  const candidates = [
    (itemInfo as any)?.title,
    (itemInfo as any)?.name,
    getByPath(itemInfo, "item.title"),
    getByPath(itemInfo, "item.name"),
    getByPath(itemInfo, "data.title"),
    getByPath(itemInfo, "data.name"),
    getByPath(itemInfo, "result.title"),
    getByPath(itemInfo, "result.name"),
    getByPath(itemInfo, "value.title"),
    getByPath(itemInfo, "value.name"),
  ];

  for (const v of candidates) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function extractUrlFromItemInfo(itemInfo: any): string | null {
  const candidates = [
    (itemInfo as any)?.url,
    (itemInfo as any)?.adUrl,
    (itemInfo as any)?.ad_url,
    getByPath(itemInfo, "item.url"),
    getByPath(itemInfo, "item.ad_url"),
    getByPath(itemInfo, "data.url"),
    getByPath(itemInfo, "result.url"),
    getByPath(itemInfo, "value.url"),
    getByPath(itemInfo, "seo_url"),
    getByPath(itemInfo, "share_url"),
    getByPath(itemInfo, "link"),
  ];

  for (const v of candidates) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function toDateMaybe(v: any): Date | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v * 1000);
  if (typeof v === "string") {
    const s = v.trim();
    if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000);
    if (/^\d{13}$/.test(s)) return new Date(Number(s));
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizePrice(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  if (typeof v === "object")
    return normalizePrice((v as any).value ?? (v as any).amount ?? (v as any).price ?? (v as any).sum ?? (v as any).cost);
  return null;
}

function normalizeUnread(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.trunc(v));

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
    const m = s.match(/\d+/);
    if (m) {
      const nn = Number(m[0]);
      return Number.isFinite(nn) ? Math.max(0, Math.trunc(nn)) : null;
    }
    return null;
  }

  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object") return normalizeUnread((v as any).count ?? (v as any).value ?? (v as any).total ?? (v as any).messages ?? (v as any).unread);
  return null;
}

function extractChatsArray(x: any): any[] {
  if (!x) return [];
  if (Array.isArray(x)) return x;

  if (Array.isArray(x.chats)) return x.chats;
  if (Array.isArray(x.items)) return x.items;
  if (Array.isArray(x.data)) return x.data;

  if (Array.isArray(x.result?.items)) return x.result.items;
  if (Array.isArray(x.result?.chats)) return x.result.chats;

  return [];
}

function extractNextOffset(x: any): number | null {
  const v =
    x?.next_offset ??
    x?.nextOffset ??
    x?.pagination?.next_offset ??
    x?.pagination?.nextOffset ??
    x?.meta?.next_offset ??
    x?.meta?.nextOffset ??
    x?.result?.next_offset ??
    x?.result?.nextOffset ??
    null;

  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function pickText(msg: any): string | null {
  if (!msg) return null;
  if (typeof msg.text === "string") return msg.text;
  if (typeof msg?.message?.text === "string") return msg.message.text;
  if (typeof msg?.content?.text === "string") return msg.content.text;
  if (typeof msg?.value?.content?.text === "string") return msg.value.content.text;
  if (typeof msg?.payload?.value?.content?.text === "string") return msg.payload.value.content.text;
  if (typeof msg?.payload?.message?.text === "string") return msg.payload.message.text;
  return null;
}

function extractCustomerName(chat: any, myAccountId: number) {
  const users: any[] = Array.isArray(chat?.users) ? chat.users : [];
  const other = users.find((u) => Number(u?.id) !== Number(myAccountId));
  return other?.name ?? other?.public_name ?? other?.login ?? null;
}

/**
 * Вытаскиваем title/price/url и itemId (для догрузки цены через items API)
 */
function extractItem(chat: any): {
  title: string | null;
  price: number | null;
  adUrl: string | null;
  itemId: number | null;
} {
  const ctx = chat?.context;
  const v = ctx?.value ?? ctx ?? null;

  // возможные “носители” объявления
  const item = v?.item ?? v?.ad ?? chat?.item ?? chat?.ad ?? v ?? chat ?? null;

  const title = item?.title ?? item?.name ?? item?.item_title ?? v?.title ?? chat?.title ?? null;

  const price =
    normalizePrice(item?.price?.value) ??
    normalizePrice(item?.price?.amount) ??
    normalizePrice(item?.price) ??
    normalizePrice(v?.price?.value) ??
    normalizePrice(v?.price?.amount) ??
    normalizePrice(v?.price) ??
    normalizePrice(chat?.price?.value) ??
    normalizePrice(chat?.price?.amount) ??
    normalizePrice(chat?.price) ??
    null;

  const adUrl = item?.url ?? item?.ad_url ?? v?.url ?? chat?.url ?? null;

  // item_id часто лежит даже когда price отсутствует в messenger
  const itemIdRaw = pickFirstNumber(
    v?.item_id,
    v?.itemId,
    v?.item?.id,
    v?.ad?.id,
    item?.id,
    chat?.item_id,
    chat?.itemId,
    chat?.ad_id,
    chat?.adId
  );

  const itemIdNum = typeof itemIdRaw === "number" ? itemIdRaw : typeof itemIdRaw === "string" ? Number(itemIdRaw) : NaN;
  const itemId = Number.isFinite(itemIdNum) ? itemIdNum : null;

  return { title: title ?? null, price, adUrl: adUrl ?? null, itemId };
}

/**
 * Глубокий поиск unread/new_messages (на случай плавающих структур)
 */
function deepUnreadScan(root: any): number | null {
  const keyRe = /(unread|new[_]?messages)/i;

  const visited = new WeakSet<object>();
  const stack: Array<{ v: any; d: number }> = [{ v: root, d: 0 }];

  const candidates: number[] = [];
  let steps = 0;
  const MAX_STEPS = 4000;
  const MAX_DEPTH = 7;

  while (stack.length && steps < MAX_STEPS) {
    const { v, d } = stack.pop()!;
    steps++;

    if (v === null || v === undefined) continue;
    if (d > MAX_DEPTH) continue;

    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) stack.push({ v: v[i], d: d + 1 });
      continue;
    }

    if (typeof v !== "object") continue;

    if (visited.has(v)) continue;
    visited.add(v);

    for (const [k, val] of Object.entries(v)) {
      if (keyRe.test(k)) {
        const n = normalizeUnread(val);
        if (n !== null) candidates.push(n);
      }
      if (val && typeof val === "object") stack.push({ v: val, d: d + 1 });
    }
  }

  if (!candidates.length) return null;
  const max = Math.max(...candidates);
  return Number.isFinite(max) ? max : null;
}

function extractUnreadFromChat(c: any): number | null {
  const directCandidates = [
    c?.unread_count,
    c?.unreadCount,
    c?.unread,
    c?.unread_messages,
    c?.unreadMessages,
    c?.unread_messages_count,
    c?.unreadMessagesCount,
    c?.new_messages,
    c?.newMessages,
    c?.new_messages_count,
    c?.newMessagesCount,
    c?.stats?.unread,
    c?.stats?.unread_count,
    c?.stats?.unreadMessages,
    c?.stats?.new_messages,
    c?.unread?.count,
    c?.unread?.messages,
    c?.unread?.total,
  ];

  for (const v of directCandidates) {
    const n = normalizeUnread(v);
    if (n !== null) return n;
  }

  return deepUnreadScan(c);
}

export async function POST(req: Request) {
  const guard = await requireAuthOrCron(req);
  if (guard) return guard;

  const url = new URL(req.url);
  const fillPrices = url.searchParams.get("fillPrices") === "1";
  const MAX_OFFSET = Number(url.searchParams.get("maxOffset") ?? "50000");

  const limit = 100;
  let offset = 0;

  let totalChatsFetched = 0;
  let chatsUpserted = 0;
  let itemLookups = 0;

  const errors: Array<{ avitoChatId?: string; error: string }> = [];
  let stopReason: null | { type: string; offset: number; message: string } = null;

  let pages = 0;
  const MAX_PAGES = 200;

  // ✅ кэш по itemId на один прогон sync
  const itemCache = new Map<number, { title: string | null; price: number | null; url: string | null }>();
  const MAX_ITEM_LOOKUPS = 120; // чтобы не улететь по лимитам

  while (pages < MAX_PAGES) {
    if (offset > MAX_OFFSET) break;

    let resp: any;

    try {
      resp = await avitoListChats({ limit, offset });
    } catch (e: any) {
      const msg = String(e?.message ?? e);

      // ✅ Avito 400 на больших offset — считаем, что дальше страниц нет
      if (msg.includes("Avito API error 400") && msg.includes("/messenger/")) {
        stopReason = { type: "AVITO_OFFSET_LIMIT", offset, message: msg };
        break;
      }

      throw e; // остальные ошибки пусть валят запрос (401/403/500 и т.п.)
    }

    const chatsRaw = extractChatsArray(resp);
    totalChatsFetched += chatsRaw.length;

    for (const c of chatsRaw) {
      try {
        const avitoChatId = pickFirstString(c?.id, c?.chat_id, c?.chatId, c?.uid);
        if (!avitoChatId) continue;

        const myId = Number(env.AVITO_ACCOUNT_ID);

        const customerName =
          extractCustomerName(c, myId) ??
          pickFirstString(c?.user?.name, c?.customer?.name, c?.users?.[0]?.name, c?.participants?.[0]?.name) ??
          null;

        const extracted = extractItem(c);

        let itemTitle = extracted.title;
        let price = extracted.price;
        let adUrl = extracted.adUrl;

        // ✅ важно: если itemId в payload нет — пробуем вытащить из ссылки
        const itemId = extracted.itemId ?? extractItemIdFromAdUrl(adUrl);

        const chatUrl = pickFirstString(c?.chat_url, c?.url) ?? null;

        const lastMsg = c?.last_message ?? c?.lastMessage ?? null;
        const lastText = pickText(lastMsg) ?? pickFirstString(c?.last_message_text, c?.lastMessageText) ?? null;

        const lastAt =
          toDateMaybe(lastMsg?.created) ??
          toDateMaybe(lastMsg?.created_at) ??
          toDateMaybe(c?.last_message_at) ??
          toDateMaybe(c?.updated) ??
          null;

        const unreadFromChat = extractUnreadFromChat(c);

        const existing = await prisma.chat.findUnique({
          where: { avitoChatId },
          select: { id: true, pinned: true, status: true, unreadCount: true, price: true, adUrl: true, itemTitle: true },
        });

        // ✅ ВАЖНО: не затираем price/title/url null-ом из messenger
        const updateData: any = {
          accountId: Number(env.AVITO_ACCOUNT_ID ?? 0),
          status: existing?.status ?? env.AVITO_DEFAULT_STATUS,
          pinned: existing?.pinned ?? false,
          customerName,
          chatUrl,
          lastMessageAt: lastAt,
          lastMessageText: lastText,
          raw: c ?? {},
          ...(unreadFromChat !== null ? { unreadCount: unreadFromChat } : {}),
          ...(itemTitle ? { itemTitle } : {}),
          ...(adUrl ? { adUrl } : {}),
          ...(price !== null ? { price } : {}),
        };

        const chat = await prisma.chat.upsert({
          where: { avitoChatId },
          create: {
            avitoChatId,
            accountId: Number(env.AVITO_ACCOUNT_ID ?? 0),
            status: env.AVITO_DEFAULT_STATUS,
            pinned: existing?.pinned ?? false,
            customerName,
            itemTitle,
            price,
            adUrl,
            chatUrl,
            lastMessageAt: lastAt,
            lastMessageText: lastText,
            unreadCount: unreadFromChat ?? 0,
            raw: c ?? {},
          },
          update: updateData,
        });

        chatsUpserted++;

        // ✅ Догружаем цену/заголовок/url через Items API, если в messenger их нет
        const needPrice = (fillPrices ? (existing?.price == null) : (price == null && (existing?.price == null)));
        const needTitle = (!itemTitle && !existing?.itemTitle);
        const needUrl = (!adUrl && !existing?.adUrl);

        if (!env.MOCK_MODE && itemId && (needPrice || needTitle || needUrl) && itemLookups < MAX_ITEM_LOOKUPS) {
          try {
            let info = itemCache.get(itemId);

            if (!info) {
              const r: any = await avitoGetItemInfo(itemId);

              // поддерживаем и "нормализованный" ответ, и сырой
              const normTitle = (typeof r?.title === "string" && r.title.trim()) ? r.title.trim() : extractTitleFromItemInfo(r);
              const normUrl = (typeof r?.url === "string" && r.url.trim()) ? r.url.trim() : extractUrlFromItemInfo(r);
              const normPrice = normalizePriceRub(r?.price) ?? extractPriceRubFromItemInfo(r);

              info = { title: normTitle ?? null, price: normPrice ?? null, url: normUrl ?? null };
              itemCache.set(itemId, info);
              itemLookups++;
            }

            const patch: any = {};
            if (needPrice && info.price != null) patch.price = info.price;
            if (needTitle && info.title) patch.itemTitle = info.title;
            if (needUrl && info.url) patch.adUrl = info.url;

            if (Object.keys(patch).length) {
              await prisma.chat.update({ where: { id: chat.id }, data: patch });
            }
          } catch (e: any) {
            // не валим sync
            if (errors.length < 20) {
              errors.push({
                avitoChatId,
                error: `itemLookup(itemId=${itemId}): ${String(e?.message ?? e)}`,
              });
            }
          }
        }
      } catch (e: any) {
        if (errors.length < 20) {
          errors.push({ avitoChatId: String(c?.id ?? ""), error: String(e?.message ?? e) });
        }
      }
    }

    const next = extractNextOffset(resp);
    if (next !== null) offset = next;
    else {
      if (chatsRaw.length < limit) break;
      offset += limit;
    }

    pages++;
    if (!chatsRaw.length) break;
    if (offset > 200_000) break;
  }

  return NextResponse.json({
    ok: true,
    stats: { totalChatsFetched, chatsUpserted, itemLookups },
    ...(stopReason ? { stopReason } : {}),
    ...(errors.length ? { errors } : {}),
  });
}
