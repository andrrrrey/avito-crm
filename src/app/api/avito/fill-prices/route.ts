// src/app/api/avito/fill-prices/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthOrCron, getSessionUser } from "@/lib/auth";
import { avitoFetchAllItemsMap, getAvitoCredentials } from "@/lib/avito";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractItemIdFromAdUrl(adUrl: string | null): number | null {
  if (!adUrl) return null;
  const m = adUrl.match(/_(\d+)(?:\?|$)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function extractItemIdFromRaw(raw: any): number | null {
  if (!raw || typeof raw !== "object") return null;

  const ctx = raw?.context;
  const v = ctx?.value ?? ctx ?? null;

  const candidates = [
    v?.item_id,
    v?.itemId,
    v?.item?.id,
    v?.ad?.id,
    raw?.item_id,
    raw?.itemId,
    raw?.ad_id,
    raw?.adId,
  ];

  for (const c of candidates) {
    if (c === null || c === undefined) continue;
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return null;
}

export async function POST(req: Request) {
  const guard = await requireAuthOrCron(req);
  if (guard) return guard;

  // Определяем credentials и accountId текущего пользователя
  const sessionUser = await getSessionUser(req);
  const creds = await getAvitoCredentials(sessionUser?.id);
  const myAccountId = creds.accountId;

  // 1. Загружаем объявления только своего аккаунта
  const itemsMap = await avitoFetchAllItemsMap({ status: "active,old", perPage: 100, maxPages: 50 }, creds);

  // 2. Берём только чаты своего аккаунта у которых цена не заполнена
  const chats = await prisma.chat.findMany({
    where: { price: null, accountId: myAccountId },
    select: { id: true, adUrl: true, raw: true },
  });

  let updated = 0;
  let notFound = 0;

  for (const chat of chats) {
    // извлекаем itemId из adUrl или raw данных чата
    const itemId =
      extractItemIdFromAdUrl(chat.adUrl) ??
      extractItemIdFromRaw(chat.raw);

    if (!itemId) {
      notFound++;
      continue;
    }

    const item = itemsMap.get(itemId);
    if (!item || item.price == null) {
      notFound++;
      continue;
    }

    await prisma.chat.update({
      where: { id: chat.id },
      data: {
        price: item.price,
        ...(item.title ? { itemTitle: item.title } : {}),
        ...(item.url ? { adUrl: item.url } : {}),
      },
    });

    updated++;
  }

  return NextResponse.json({
    ok: true,
    stats: {
      itemsInAccount: itemsMap.size,
      chatsWithoutPrice: chats.length,
      updated,
      notFound,
    },
  });
}
