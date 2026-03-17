// src/app/api/cron/sync-prices/route.ts
//
// Автоматическое обновление цен объявлений из Avito.
// Обновляет цены ВСЕХ чатов (не только тех, у которых price=null).
//
// Запускать по крону: POST /api/cron/sync-prices?token=<CRM_CRON_TOKEN>
// Рекомендуемый интервал: каждые 30 минут–2 часа

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCronToken } from "@/lib/auth";
import { env } from "@/lib/env";
import { avitoFetchAllItemsMap } from "@/lib/avito";
import { publish } from "@/lib/realtime";

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
  const guard = requireCronToken(req);
  if (guard) return guard;

  const now = new Date();
  const stats = {
    itemsInAccount: 0,
    chatsChecked: 0,
    priceUpdated: 0,
    titleUpdated: 0,
    noItemId: 0,
    notFound: 0,
    errors: 0,
    startedAt: now.toISOString(),
    finishedAt: null as string | null,
  };

  // В mock-режиме Avito API не доступен — возвращаем mock-результат
  if (env.MOCK_MODE) {
    stats.finishedAt = new Date().toISOString();
    console.log("[cron/sync-prices] MOCK_MODE — skipping Avito API calls");
    return NextResponse.json({ ok: true, mock: true, stats });
  }

  // 1. Загружаем все объявления аккаунта одним пакетным запросом
  let itemsMap: Map<number, { itemId: number; title: string | null; price: number | null; url: string | null }>;
  try {
    itemsMap = await avitoFetchAllItemsMap({ status: "active,old", perPage: 100, maxPages: 50 });
    stats.itemsInAccount = itemsMap.size;
  } catch (e) {
    console.error("[cron/sync-prices] Failed to fetch items from Avito:", e);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch items from Avito", stats },
      { status: 502 }
    );
  }

  // 2. Берём ВСЕ чаты (не только без цены) — нам нужно обновлять актуальные цены
  const chats = await prisma.chat.findMany({
    select: {
      id: true,
      avitoChatId: true,
      adUrl: true,
      price: true,
      itemTitle: true,
      raw: true,
      status: true,
      customerName: true,
      lastMessageAt: true,
      lastMessageText: true,
      chatUrl: true,
      unreadCount: true,
      pinned: true,
      accountId: true,
    },
  });

  stats.chatsChecked = chats.length;

  for (const chat of chats) {
    try {
      // Извлекаем itemId из adUrl или raw данных чата
      const itemId =
        extractItemIdFromAdUrl(chat.adUrl) ??
        extractItemIdFromRaw(chat.raw);

      if (!itemId) {
        stats.noItemId++;
        continue;
      }

      const item = itemsMap.get(itemId);
      if (!item) {
        stats.notFound++;
        continue;
      }

      const newPrice = item.price ?? null;
      const newTitle = item.title ?? null;
      const newUrl = item.url ?? null;

      const priceChanged = newPrice !== null && newPrice !== chat.price;
      const titleChanged = newTitle !== null && newTitle !== chat.itemTitle;
      const urlChanged = newUrl !== null && newUrl !== chat.adUrl;

      if (!priceChanged && !titleChanged && !urlChanged) continue;

      const updateData: Record<string, any> = {};
      if (priceChanged) updateData.price = newPrice;
      if (titleChanged) updateData.itemTitle = newTitle;
      if (urlChanged) updateData.adUrl = newUrl;

      await prisma.chat.update({
        where: { id: chat.id },
        data: updateData,
      });

      if (priceChanged) stats.priceUpdated++;
      if (titleChanged) stats.titleUpdated++;

      // Публикуем SSE-событие для обновления UI в реальном времени
      publish({
        type: "chat_updated",
        chatId: chat.id,
        avitoChatId: chat.avitoChatId,
        accountId: chat.accountId,
        chatSnapshot: {
          id: chat.id,
          status: chat.status as any,
          customerName: chat.customerName,
          itemTitle: titleChanged ? newTitle : chat.itemTitle,
          price: priceChanged ? newPrice : chat.price,
          lastMessageAt: chat.lastMessageAt?.toISOString() ?? null,
          lastMessageText: chat.lastMessageText,
          adUrl: urlChanged ? newUrl : chat.adUrl,
          chatUrl: chat.chatUrl,
          unreadCount: chat.unreadCount,
          pinned: chat.pinned,
        },
      });
    } catch (e) {
      console.error(`[cron/sync-prices] Error updating chat ${chat.id}:`, e);
      stats.errors++;
    }
  }

  stats.finishedAt = new Date().toISOString();
  console.log("[cron/sync-prices] Done:", stats);

  return NextResponse.json({ ok: true, stats });
}
