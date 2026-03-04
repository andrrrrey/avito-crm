// src/lib/avitoParse.ts
// Набор "грязных" эвристик для распознавания медиа/заказов в ответах Avito.
// Авито API/вебхуки иногда отличаются по версиям (v1/v2/v3) и структурам payload.

import { pickFirstString } from "@/lib/utils";

export function unwrapAvitoRoot(raw: any): any {
  return (
    raw?.payload?.value ??
    raw?.payload ??
    raw?.data?.value ??
    raw?.data ??
    raw?.value ??
    raw ??
    {}
  );
}

function normalizeUrlMaybe(s: string): string {
  const t = s.trim();
  if (t.startsWith("//")) return `https:${t}`;
  return t;
}

const IMG_EXT_RE = /\.(png|jpe?g|webp|gif)(\?|#|$)/i;

function scoreSizeHint(s: string): number {
  // ищем 140x105 / 640x480 etc
  const m = s.match(/(\d{2,4})x(\d{2,4})/);
  if (!m) return 0;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return 0;
  return w * h;
}

function looksLikeImageUrl(url: string, keyHint?: string): boolean {
  const u = url.trim();
  if (!u) return false;
  if (!(u.startsWith("http://") || u.startsWith("https://") || u.startsWith("//"))) return false;

  const norm = normalizeUrlMaybe(u);

  if (IMG_EXT_RE.test(norm)) return true;

  // CDN'ы иногда без расширения. В таких случаях используем эвристику.
  const k = (keyHint ?? "").toLowerCase();
  const imgKey = /image|img|photo|picture|preview|thumb|thumbnail|icon|main/.test(k);
  const looksCdn = /avito\.|avito\.st|img\.avito|image/.test(norm.toLowerCase());

  return imgKey && looksCdn;
}

export function extractImageUrls(raw: any, max = 4): string[] {
  const root = unwrapAvitoRoot(raw);

  // Собираем кандидаты с подсказками ключа/размера для сортировки.
  const candidates: Array<{ url: string; score: number }> = [];

  const stack: Array<{ v: any; depth: number; key?: string }> = [{ v: root, depth: 0 }];
  const seen = new Set<any>();

  while (stack.length) {
    const cur = stack.pop()!;
    const { v, depth, key } = cur;
    if (v === null || v === undefined) continue;
    if (depth > 8) continue;

    if (typeof v === "string") {
      const s = normalizeUrlMaybe(v);
      if (looksLikeImageUrl(s, key)) {
        const sc = Math.max(scoreSizeHint(s), scoreSizeHint(key ?? ""));
        candidates.push({ url: s, score: sc });
      }
      continue;
    }

    if (typeof v !== "object") continue;
    if (seen.has(v)) continue;
    seen.add(v);

    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        stack.push({ v: v[i], depth: depth + 1, key });
      }
      continue;
    }

    for (const k of Object.keys(v)) {
      stack.push({ v: (v as any)[k], depth: depth + 1, key: k });
    }
  }

  // dedupe + сортировка (больше размер -> выше)
  const bestByUrl = new Map<string, number>();
  for (const c of candidates) {
    const prev = bestByUrl.get(c.url);
    if (prev === undefined || c.score > prev) bestByUrl.set(c.url, c.score);
  }

  const uniq = Array.from(bestByUrl.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url);

  return uniq.slice(0, Math.max(0, max));
}

function looksLikeOrderId(s: string): boolean {
  const t = String(s ?? "").trim();
  if (!/^\d{10,}$/.test(t)) return false;
  // реальный order id у Avito обычно длиннее item_id и часто начинается с 7... (пример 70000000400529070)
  if (t.length >= 14) return true;
  return false;
}

export function extractOrderId(raw: any): string | null {
  const root = unwrapAvitoRoot(raw);

  const ctx = root?.context?.value ?? root?.context ?? null;
  const ctxType = pickFirstString(ctx?.type, root?.context?.type, root?.contextType, root?.context_type);
  const ctxValue = ctx?.value ?? ctx;

  const direct =
    pickFirstString(
      // явные поля
      ctxValue?.order_id,
      ctxValue?.orderId,
      root?.order_id,
      root?.orderId,
      root?.order?.id,
      // иногда кладут в context.value.id
      ctxValue?.id,
      root?.context?.value?.id,
      root?.context?.id
    ) ?? null;

  if (direct && looksLikeOrderId(direct)) {
    // если context.type явно "order"/"orders" — точно берем
    if (ctxType && /order|orders|delivery|deal|transaction/i.test(ctxType)) return String(direct);

    // иначе — берем только если похоже на длинный id (чтобы не спутать с item_id)
    if (String(direct).trim().length >= 14) return String(direct);
  }

  // Фоллбек: ищем первое значение с ключами, похожими на order.
  const stack: Array<{ v: any; depth: number; key?: string }> = [{ v: root, depth: 0 }];
  const seen = new Set<any>();

  while (stack.length) {
    const { v, depth, key } = stack.pop()!;
    if (v === null || v === undefined) continue;
    if (depth > 8) continue;

    if (typeof v === "string" || typeof v === "number") {
      const s = String(v);
      const k = String(key ?? "").toLowerCase();
      if (k.includes("order") && looksLikeOrderId(s)) return s;
      continue;
    }

    if (typeof v !== "object") continue;
    if (seen.has(v)) continue;
    seen.add(v);

    if (Array.isArray(v)) {
      for (const it of v) stack.push({ v: it, depth: depth + 1, key });
      continue;
    }

    for (const k of Object.keys(v)) {
      stack.push({ v: (v as any)[k], depth: depth + 1, key: k });
    }
  }

  return null;
}

export function buildAvitoOrderUrl(orderId: string): string {
  const clean = String(orderId).trim();
  // оставляем как есть (orderId может быть очень длинным)
  return `https://www.avito.ru/orders/${encodeURIComponent(clean)}?source=orders_list`;
}
