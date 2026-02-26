// src/app/api/cron/followup/route.ts
//
// Дожимы бота: если клиент не отвечает 1 час — бот спрашивает "актуален ли заказ".
// Если после дожима нет ответа ещё 1 час — чат переводится в INACTIVE.
//
// Запускать по крону: POST /api/cron/followup?token=<CRM_CRON_TOKEN>
// (каждые 5–10 минут)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCronToken } from "@/lib/auth";
import { env } from "@/lib/env";
import { avitoSendTextMessage } from "@/lib/avito";
import { publish } from "@/lib/realtime";
import { pickFirstString } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Текст дожима
const FOLLOWUP_TEXT = "Здравствуйте! Актуален ли ваш заказ? Ждём вашего ответа.";

// Таймауты
const FOLLOWUP_DELAY_MS = 60 * 60 * 1000; // 1 час без ответа → дожим
const INACTIVE_DELAY_MS = 60 * 60 * 1000; // 1 час после дожима → INACTIVE

export async function POST(req: Request) {
  const guard = requireCronToken(req);
  if (guard) return guard;

  const now = new Date();
  const followupThreshold = new Date(now.getTime() - FOLLOWUP_DELAY_MS);
  const inactiveThreshold = new Date(now.getTime() - INACTIVE_DELAY_MS);

  const stats = {
    followupsSent: 0,
    markedInactive: 0,
    errors: 0,
  };

  // ─── Шаг 1: Дожим ───────────────────────────────────────────────────────────
  // Ищем BOT-чаты, где:
  // - followupSentAt IS NULL (дожим ещё не отправлялся)
  // - lastMessageAt < 1 часа назад
  const chatsForFollowup = await prisma.chat.findMany({
    where: {
      status: "BOT",
      followupSentAt: null,
      lastMessageAt: { lt: followupThreshold },
    },
    select: {
      id: true,
      avitoChatId: true,
      lastMessageAt: true,
      raw: true,
      messages: {
        orderBy: { sentAt: "desc" },
        take: 1,
        select: { direction: true, sentAt: true },
      },
    },
  });

  for (const chat of chatsForFollowup) {
    // Дожим только если последнее сообщение — от клиента (IN)
    const lastMsg = chat.messages[0];
    if (!lastMsg || lastMsg.direction !== "IN") continue;

    try {
      const sentAt = new Date();
      const rawObj = (chat.raw && typeof chat.raw === "object") ? (chat.raw as any) : {};

      if (env.MOCK_MODE) {
        // В mock-режиме — просто пишем в БД
        const fakeId = `followup_${Date.now()}_${chat.id}`;
        await prisma.message.createMany({
          data: [{
            chatId: chat.id,
            avitoMessageId: fakeId,
            direction: "OUT",
            text: FOLLOWUP_TEXT,
            sentAt,
            isRead: true,
            raw: { mock: true, from: "bot_followup" },
          }],
          skipDuplicates: true,
        });

        await prisma.chat.update({
          where: { id: chat.id },
          data: {
            followupSentAt: sentAt,
            lastMessageAt: sentAt,
            lastMessageText: FOLLOWUP_TEXT,
            raw: {
              ...rawObj,
              followup: {
                sentAt: sentAt.toISOString(),
                text: FOLLOWUP_TEXT,
                mock: true,
              },
            },
          },
        });

        // Снэпшот для SSE
        const snap = await prisma.chat.findUnique({
          where: { id: chat.id },
          select: {
            id: true, status: true, customerName: true, itemTitle: true, price: true,
            lastMessageAt: true, lastMessageText: true, adUrl: true, chatUrl: true,
            unreadCount: true, pinned: true,
          },
        });

        publish({
          type: "chat_updated",
          chatId: chat.id,
          avitoChatId: chat.avitoChatId,
          chatSnapshot: snap ? {
            id: snap.id,
            status: snap.status as any,
            customerName: snap.customerName,
            itemTitle: snap.itemTitle,
            price: snap.price,
            lastMessageAt: snap.lastMessageAt?.toISOString() ?? null,
            lastMessageText: snap.lastMessageText,
            adUrl: snap.adUrl,
            chatUrl: snap.chatUrl,
            unreadCount: snap.unreadCount,
            pinned: snap.pinned,
          } : undefined,
        });

        publish({
          type: "message_created",
          chatId: chat.id,
          avitoChatId: chat.avitoChatId,
          direction: "OUT",
          message: {
            id: fakeId,
            chatId: chat.id,
            direction: "OUT",
            text: FOLLOWUP_TEXT,
            sentAt: sentAt.toISOString(),
            isRead: true,
          },
        });

        stats.followupsSent++;
      } else {
        // Реальный режим — отправляем через Avito API
        const resp: any = await avitoSendTextMessage(chat.avitoChatId, FOLLOWUP_TEXT);
        const outId = pickFirstString(
          resp?.id,
          resp?.message_id,
          resp?.value?.id,
          resp?.result?.id,
        ) ?? `followup_${Date.now()}`;

        await prisma.message.createMany({
          data: [{
            chatId: chat.id,
            avitoMessageId: outId,
            direction: "OUT",
            text: FOLLOWUP_TEXT,
            sentAt,
            isRead: true,
            raw: { from: "bot_followup", avitoSendResp: resp ?? {} },
          }],
          skipDuplicates: true,
        });

        await prisma.chat.update({
          where: { id: chat.id },
          data: {
            followupSentAt: sentAt,
            lastMessageAt: sentAt,
            lastMessageText: FOLLOWUP_TEXT,
            raw: {
              ...rawObj,
              followup: {
                sentAt: sentAt.toISOString(),
                text: FOLLOWUP_TEXT,
                avitoMessageId: outId,
              },
            },
          },
        });

        const snap = await prisma.chat.findUnique({
          where: { id: chat.id },
          select: {
            id: true, status: true, customerName: true, itemTitle: true, price: true,
            lastMessageAt: true, lastMessageText: true, adUrl: true, chatUrl: true,
            unreadCount: true, pinned: true,
          },
        });

        publish({
          type: "chat_updated",
          chatId: chat.id,
          avitoChatId: chat.avitoChatId,
          chatSnapshot: snap ? {
            id: snap.id,
            status: snap.status as any,
            customerName: snap.customerName,
            itemTitle: snap.itemTitle,
            price: snap.price,
            lastMessageAt: snap.lastMessageAt?.toISOString() ?? null,
            lastMessageText: snap.lastMessageText,
            adUrl: snap.adUrl,
            chatUrl: snap.chatUrl,
            unreadCount: snap.unreadCount,
            pinned: snap.pinned,
          } : undefined,
        });

        stats.followupsSent++;
      }
    } catch (e) {
      console.error(`[followup] Error sending followup to chat ${chat.id}:`, e);
      stats.errors++;
    }
  }

  // ─── Шаг 2: Перевод в INACTIVE ──────────────────────────────────────────────
  // Ищем BOT-чаты, где:
  // - followupSentAt IS NOT NULL (дожим уже отправлен)
  // - followupSentAt < 1 часа назад (прошло достаточно времени)
  // - нет новых IN-сообщений после followupSentAt (клиент не ответил)
  const chatsForInactive = await prisma.chat.findMany({
    where: {
      status: "BOT",
      followupSentAt: { not: null, lt: inactiveThreshold },
    },
    select: {
      id: true,
      avitoChatId: true,
      followupSentAt: true,
      raw: true,
      messages: {
        where: { direction: "IN" },
        orderBy: { sentAt: "desc" },
        take: 1,
        select: { sentAt: true },
      },
    },
  });

  for (const chat of chatsForInactive) {
    // Если после дожима есть входящее сообщение — клиент ответил, не трогаем
    const lastInMsg = chat.messages[0];
    if (lastInMsg && chat.followupSentAt && lastInMsg.sentAt > chat.followupSentAt) continue;

    try {
      const rawObj = (chat.raw && typeof chat.raw === "object") ? (chat.raw as any) : {};

      await prisma.chat.update({
        where: { id: chat.id },
        data: {
          status: "INACTIVE",
          raw: {
            ...rawObj,
            inactive: {
              markedAt: new Date().toISOString(),
              reason: "no_response_after_followup",
            },
          },
        },
      });

      const snap = await prisma.chat.findUnique({
        where: { id: chat.id },
        select: {
          id: true, status: true, customerName: true, itemTitle: true, price: true,
          lastMessageAt: true, lastMessageText: true, adUrl: true, chatUrl: true,
          unreadCount: true, pinned: true,
        },
      });

      publish({
        type: "chat_updated",
        chatId: chat.id,
        avitoChatId: chat.avitoChatId,
        chatSnapshot: snap ? {
          id: snap.id,
          status: snap.status as any,
          customerName: snap.customerName,
          itemTitle: snap.itemTitle,
          price: snap.price,
          lastMessageAt: snap.lastMessageAt?.toISOString() ?? null,
          lastMessageText: snap.lastMessageText,
          adUrl: snap.adUrl,
          chatUrl: snap.chatUrl,
          unreadCount: snap.unreadCount,
          pinned: snap.pinned,
        } : undefined,
      });

      stats.markedInactive++;
    } catch (e) {
      console.error(`[followup] Error marking chat ${chat.id} as inactive:`, e);
      stats.errors++;
    }
  }

  console.log("[cron/followup] Done:", stats);

  return NextResponse.json({ ok: true, stats });
}
