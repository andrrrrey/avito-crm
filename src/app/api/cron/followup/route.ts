// src/app/api/cron/followup/route.ts
//
// Дожимы бота: если бот написал клиенту, а клиент не отвечает 1 час —
// бот пишет сообщение-напоминание (только в чаты с ИИ ботом, без менеджера).
// Если после дожима нет ответа в течение суток — чат переводится в INACTIVE.
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
const FOLLOWUP_TEXT = "Актуален ли ваш заказ?";

// Таймауты
const FOLLOWUP_DELAY_MS = 60 * 60 * 1000;     // 1 час без ответа → дожим
const FOLLOWUP_MAX_AGE_MS = 2 * 60 * 60 * 1000; // дожим только если чат не старее 2 часов
const INACTIVE_DELAY_MS = 24 * 60 * 60 * 1000; // 24 часа после дожима → INACTIVE

// ─── Паттерны для обнаружения завершённого/совершённого заказа ───────────────

/** Признаки покупательского намерения в сообщениях клиента (IN) */
const PURCHASE_INTENT_PATTERNS: RegExp[] = [
  /\bберу\b/i,
  /\bвозьму\b/i,
  /\bкуплю\b/i,
  /\bпокупаю\b/i,
  /\bбронирую\b/i,
  /\bзабираю\b/i,
  /\bзаберу\b/i,
  /\bоформите\b/i,
  /\bоформляйте\b/i,
  /\bоплачу\b/i,
  /\bзакажу\b/i,
  /хочу купить/i,
  /хочу заказать/i,
  /готов купить/i,
  /буду брать/i,
  /могу забрать/i,
  /как оплатить/i,
  /куда (?:переводить|платить|перевести|скинуть)/i,
  /реквизиты/i,
  /договорились/i,
  /по рукам/i,
  /можно заказать/i,
];

/** Фразы подтверждения заказа в сообщениях бота/менеджера (OUT) */
const ORDER_CONFIRMED_PATTERNS: RegExp[] = [
  /заказ оформлен/i,
  /принял заказ/i,
  /заказ принят/i,
  /спасибо за (?:заказ|покупку)/i,
  /заказ подтвержд/i,
  /оплата получена/i,
  /оплата прошла/i,
  /деньги получены/i,
];

/**
 * Определяет, было ли сообщение отправлено менеджером (а не ботом).
 * Менеджерские сообщения помечаются в raw.crmSource = "manager" (новый формат)
 * или raw.source = "crm_send" (устаревший формат mock-режима).
 */
function isManagerMessage(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  return r.crmSource === "manager" || r.source === "crm_send";
}

/**
 * Проверяет, есть ли в истории чата признаки совершённого/завершённого заказа.
 */
function hasOrderCompletionSignals(
  messages: Array<{ direction: string; text: string }>,
): boolean {
  for (const msg of messages) {
    const text = msg.text ?? "";
    if (!text.trim()) continue;
    if (msg.direction === "IN") {
      if (PURCHASE_INTENT_PATTERNS.some((p) => p.test(text))) return true;
    } else if (msg.direction === "OUT") {
      if (ORDER_CONFIRMED_PATTERNS.some((p) => p.test(text))) return true;
    }
  }
  return false;
}

export async function POST(req: Request) {
  const guard = requireCronToken(req);
  if (guard) return guard;

  // Проверяем настройки ИИ-ассистента.
  // Дожимы (Шаг 1) отправляются только если:
  //   1. Запись настроек существует
  //   2. Ассистент включён (enabled = true) — бот активен
  //   3. Дожимы включены (followupEnabled = true)
  //
  // Шаги 2 и 3 (перевод чатов в INACTIVE) выполняются всегда, независимо
  // от этих настроек — управление жизненным циклом чата не зависит от дожимов.
  const aiSettings = await prisma.aiAssistant.findUnique({ where: { id: 1 } });
  const canSendFollowup = !!(aiSettings?.enabled && aiSettings?.followupEnabled);

  if (!canSendFollowup) {
    console.log("[followup] Step 1 skipped: followup disabled or bot disabled", {
      settingsFound: !!aiSettings,
      enabled: aiSettings?.enabled,
      followupEnabled: aiSettings?.followupEnabled,
    });
  }

  const now = new Date();
  const followupThreshold = new Date(now.getTime() - FOLLOWUP_DELAY_MS);
  const followupMaxAgeThreshold = new Date(now.getTime() - FOLLOWUP_MAX_AGE_MS);
  const inactiveThreshold = new Date(now.getTime() - INACTIVE_DELAY_MS);

  const stats = {
    followupsSent: 0,
    markedInactive: 0,
    errors: 0,
  };

  // ─── Шаг 1: Дожим ───────────────────────────────────────────────────────────
  // Ищем BOT-чаты, где:
  // - followupSentAt IS NULL (дожим ещё не отправлялся)
  // - lastMessageAt от 1 до 2 часов назад (чат "свежий", но клиент не ответил)
  //
  // Шаг 1 выполняется ТОЛЬКО если canSendFollowup = true.
  // Шаги 2 и 3 выполняются всегда (управление жизненным циклом чата).
  if (canSendFollowup) {
  const chatsForFollowup = await prisma.chat.findMany({
    where: {
      status: "BOT",
      followupSentAt: null,
      lastMessageAt: { lt: followupThreshold, gt: followupMaxAgeThreshold },
    },
    select: {
      id: true,
      avitoChatId: true,
      lastMessageAt: true,
      raw: true,
      messages: {
        orderBy: { sentAt: "asc" },
        take: 50,
        select: { direction: true, sentAt: true, text: true, raw: true },
      },
    },
  });

  for (const chat of chatsForFollowup) {
    // Дожим только если последнее сообщение — от бота (OUT):
    // бот уже ответил клиенту, но клиент не написал в ответ.
    const lastMsg = chat.messages[chat.messages.length - 1];
    if (!lastMsg || lastMsg.direction !== "OUT") continue;

    // Проверка 1: пропускаем чат, если менеджер когда-либо писал в нём.
    // Это значит, что диалог уже вёл живой сотрудник — дожим неуместен.
    const hasManagerMsg = chat.messages.some(
      (msg) => msg.direction === "OUT" && isManagerMessage(msg.raw),
    );
    if (hasManagerMsg) {
      console.log(`[followup] Skip chat ${chat.id}: manager message detected`);
      continue;
    }

    // Проверка 2: пропускаем чат, если в диалоге есть признаки совершённого заказа
    // (клиент сказал "беру", "куплю", запросил реквизиты и т.д.).
    if (hasOrderCompletionSignals(chat.messages)) {
      console.log(`[followup] Skip chat ${chat.id}: order completion detected`);
      continue;
    }

    // Проверка 3: пропускаем если фраза-дожим уже была в истории чата.
    // Это защищает от повторной отправки после реактивации чата (followupSentAt сбрасывается).
    const hasFollowupInHistory = chat.messages.some(
      (msg) => msg.direction === "OUT" && msg.text?.trim() === FOLLOWUP_TEXT,
    );
    if (hasFollowupInHistory) {
      console.log(`[followup] Skip chat ${chat.id}: followup phrase already in message history`);
      continue;
    }

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
            unreadCount: true, pinned: true, manualUnread: true, labelColor: true,
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
            manualUnread: (snap as any).manualUnread ?? false,
            labelColor: (snap as any).labelColor ?? null,
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
            unreadCount: true, pinned: true, manualUnread: true, labelColor: true,
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
            manualUnread: (snap as any).manualUnread ?? false,
            labelColor: (snap as any).labelColor ?? null,
          } : undefined,
        });

        stats.followupsSent++;
      }
    } catch (e) {
      console.error(`[followup] Error sending followup to chat ${chat.id}:`, e);
      stats.errors++;
    }
  }
  } // end if (canSendFollowup)

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
            manualUnread: (snap as any).manualUnread ?? false,
            labelColor: (snap as any).labelColor ?? null,
        } : undefined,
      });

      stats.markedInactive++;
    } catch (e) {
      console.error(`[followup] Error marking chat ${chat.id} as inactive:`, e);
      stats.errors++;
    }
  }

  // ─── Шаг 3: INACTIVE напрямую (нет ответа клиента 24ч, дожим не отправлялся) ─
  // Ищем BOT-чаты, где:
  // - followupSentAt IS NULL (не пойман шагом 2)
  // - есть хотя бы одно IN-сообщение (клиент когда-то писал)
  // - последнее IN-сообщение старше 24 часов
  //
  // Типичный кейс: бот ответил, клиент не отреагировал; дожим не был послан
  // (например, из-за окна FOLLOWUP_MAX_AGE_MS или по другой причине).
  const chatsForDirectInactive = await prisma.chat.findMany({
    where: {
      status: "BOT",
      followupSentAt: null,
    },
    select: {
      id: true,
      avitoChatId: true,
      raw: true,
      messages: {
        where: { direction: "IN" },
        orderBy: { sentAt: "desc" },
        take: 1,
        select: { sentAt: true },
      },
    },
  });

  for (const chat of chatsForDirectInactive) {
    const lastInMsg = chat.messages[0];

    // Нет ни одного входящего сообщения — клиент никогда не писал, пропускаем
    if (!lastInMsg) continue;

    // Клиент писал менее 24 часов назад — ещё ждём
    if (lastInMsg.sentAt > inactiveThreshold) continue;

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
              reason: "no_client_activity_24h",
            },
          },
        },
      });

      const snap = await prisma.chat.findUnique({
        where: { id: chat.id },
        select: {
          id: true, status: true, customerName: true, itemTitle: true, price: true,
          lastMessageAt: true, lastMessageText: true, adUrl: true, chatUrl: true,
          unreadCount: true, pinned: true, manualUnread: true, labelColor: true,
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
          manualUnread: (snap as any).manualUnread ?? false,
          labelColor: (snap as any).labelColor ?? null,
        } : undefined,
      });

      stats.markedInactive++;
    } catch (e) {
      console.error(`[followup] Error marking chat ${chat.id} as inactive (direct):`, e);
      stats.errors++;
    }
  }

  console.log("[cron/followup] Done:", stats);

  return NextResponse.json({ ok: true, stats });
}
