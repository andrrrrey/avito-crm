// src/app/api/cron/followup/route.ts
//
// Дожимы бота: если бот написал клиенту, а клиент не отвечает 1 час —
// бот пишет сообщение-напоминание (только в чаты с ИИ ботом, без менеджера).
// Если после дожима нет ответа в течение суток — чат переводится в INACTIVE.
// Также: если клиент написал что уже купил/получил/заказал — дожим не отправляется.
// Если с клиента нет активности больше 24 часов — чат переводится в INACTIVE.
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
const FOLLOWUP_DELAY_MS = 60 * 60 * 1000;       // 1 час без ответа → дожим
const FOLLOWUP_MAX_AGE_MS = 2 * 60 * 60 * 1000; // дожим только если чат не старее 2 часов
const INACTIVE_DELAY_MS = 24 * 60 * 60 * 1000;  // 24 часа после дожима → INACTIVE
const INACTIVE_NO_FOLLOWUP_MS = 24 * 60 * 60 * 1000; // 24 часа без активности → INACTIVE

// Ключевые слова: клиент уже купил / получил / не заинтересован
const PURCHASED_RE =
  /(?:уже\s+)?(?:купил[аи]?|заказал[аи]?|получил[аи]?|приобрёл|приобрел|нашёл|нашел|нашла)\b/iu;
const NOT_INTERESTED_RE =
  /не\s+(?:актуально|актуален|актуальна|нужно|нужен|нужна|интересует|интересно)|(?:не\s+буду|отменил[аи]?|отказ(?:ываюсь|ался|алась)|раздумал[аи]?|спасибо[\s,]*не\s+надо)/iu;

/** Проверяет, написал ли клиент что-то вроде "уже купил/получил/не нужно" */
function clientAlreadyPurchased(messages: Array<{ direction: string; text: string }>): boolean {
  // Проверяем последние 5 входящих сообщений
  const inMsgs = messages
    .filter((m) => m.direction === "IN")
    .slice(-5);

  return inMsgs.some(
    (m) => PURCHASED_RE.test(m.text) || NOT_INTERESTED_RE.test(m.text)
  );
}

/** Публикует SSE-снэпшот после обновления чата */
async function publishChatSnapshot(chatId: string, avitoChatId: string) {
  const snap = await prisma.chat.findUnique({
    where: { id: chatId },
    select: {
      id: true, status: true, customerName: true, itemTitle: true, price: true,
      lastMessageAt: true, lastMessageText: true, adUrl: true, chatUrl: true,
      unreadCount: true, pinned: true, accountId: true,
    },
  });

  publish({
    type: "chat_updated",
    chatId,
    avitoChatId,
    accountId: snap?.accountId,
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
}

export async function POST(req: Request) {
  const guard = requireCronToken(req);
  if (guard) return guard;

  const now = new Date();
  const followupThreshold = new Date(now.getTime() - FOLLOWUP_DELAY_MS);
  const followupMaxAgeThreshold = new Date(now.getTime() - FOLLOWUP_MAX_AGE_MS);
  const inactiveThreshold = new Date(now.getTime() - INACTIVE_DELAY_MS);
  const inactiveNoFollowupThreshold = new Date(now.getTime() - INACTIVE_NO_FOLLOWUP_MS);

  const stats = {
    followupsSent: 0,
    markedInactive: 0,
    skippedPurchased: 0,
    skippedDuplicate: 0,
    skippedFollowupDisabled: 0,
    errors: 0,
  };

  // Получаем accountId пользователей, у которых дожим отключён.
  // Если пользователь использует env-переменные (avitoAccountId === null в БД),
  // подставляем env.AVITO_ACCOUNT_ID как его эффективный accountId.
  const usersWithFollowupDisabled = await prisma.user.findMany({
    where: { followupEnabled: false },
    select: { avitoAccountId: true },
  });
  const disabledAccountIds = usersWithFollowupDisabled
    .map((u) => u.avitoAccountId ?? env.AVITO_ACCOUNT_ID ?? null)
    .filter((id): id is number => id !== null && id !== 0);

  // Если есть пользователи с отключённым дожимом, но мы не смогли определить
  // ни один их accountId (avitoAccountId=null и AVITO_ACCOUNT_ID не задан),
  // то мы не знаем, каким чатам принадлежит этот аккаунт — пропускаем шаг 1.
  const hasUnresolvableDisabledUsers =
    usersWithFollowupDisabled.length > 0 && disabledAccountIds.length === 0;

  // ─── Шаг 1: Дожим ───────────────────────────────────────────────────────────
  // Ищем BOT-чаты, где:
  // - followupSentAt IS NULL (дожим ещё не отправлялся)
  // - lastMessageAt от 1 до 2 часов назад (чат "свежий", но клиент не ответил)
  // - accountId не принадлежит пользователям с отключённым дожимом
  if (hasUnresolvableDisabledUsers) {
    console.log("[cron/followup] Шаг 1 пропущен: дожим отключён, но AVITO_ACCOUNT_ID не задан — невозможно определить чаты аккаунта.");
  }
  const chatsForFollowup = hasUnresolvableDisabledUsers ? [] : await prisma.chat.findMany({
    where: {
      status: "BOT",
      followupSentAt: null,
      lastMessageAt: { lt: followupThreshold, gt: followupMaxAgeThreshold },
      ...(disabledAccountIds.length > 0 ? { accountId: { notIn: disabledAccountIds } } : {}),
    },
    select: {
      id: true,
      avitoChatId: true,
      accountId: true,
      lastMessageAt: true,
      raw: true,
      messages: {
        orderBy: { sentAt: "desc" },
        take: 10,
        select: { direction: true, sentAt: true, text: true },
      },
    },
  });

  for (const chat of chatsForFollowup) {
    // Дожим только если последнее сообщение — от бота (OUT):
    // бот уже ответил клиенту, но клиент не написал в ответ.
    const lastMsg = chat.messages[0];
    if (!lastMsg || lastMsg.direction !== "OUT") continue;

    // Проверка 1: не отправляем дожим если текст дожима уже есть в истории
    const alreadySentFollowup = chat.messages.some(
      (m: { direction: string; text: string }) => m.direction === "OUT" && m.text.trim() === FOLLOWUP_TEXT.trim()
    );
    if (alreadySentFollowup) {
      stats.skippedDuplicate++;
      // Если фраза уже была, ставим followupSentAt чтобы не проверять снова
      await prisma.chat.update({
        where: { id: chat.id },
        data: { followupSentAt: lastMsg.sentAt },
      }).catch(() => null);
      continue;
    }

    // Проверка 2: не отправляем дожим если клиент уже написал "купил/получил/не нужно"
    if (clientAlreadyPurchased(chat.messages)) {
      stats.skippedPurchased++;
      // Переводим в INACTIVE, раз клиент уже не заинтересован
      const rawObj = (chat.raw && typeof chat.raw === "object") ? (chat.raw as any) : {};
      await prisma.chat.update({
        where: { id: chat.id },
        data: {
          status: "INACTIVE",
          raw: {
            ...rawObj,
            inactive: {
              markedAt: new Date().toISOString(),
              reason: "client_purchased_or_not_interested",
            },
          },
        },
      }).catch(() => null);
      await publishChatSnapshot(chat.id, chat.avitoChatId).catch(() => null);
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

        await publishChatSnapshot(chat.id, chat.avitoChatId);

        publish({
          type: "message_created",
          chatId: chat.id,
          avitoChatId: chat.avitoChatId,
          accountId: chat.accountId,
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

        await publishChatSnapshot(chat.id, chat.avitoChatId);

        stats.followupsSent++;
      }
    } catch (e) {
      console.error(`[followup] Error sending followup to chat ${chat.id}:`, e);
      stats.errors++;
    }
  }

  // ─── Шаг 2: Перевод в INACTIVE после дожима ─────────────────────────────────
  // Ищем BOT-чаты, где:
  // - followupSentAt IS NOT NULL (дожим уже отправлен)
  // - followupSentAt более 24 часов назад
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

      await publishChatSnapshot(chat.id, chat.avitoChatId);

      stats.markedInactive++;
    } catch (e) {
      console.error(`[followup] Error marking chat ${chat.id} as inactive:`, e);
      stats.errors++;
    }
  }

  // ─── Шаг 3: Перевод в INACTIVE при 24ч без активности клиента ───────────────
  // Ищем BOT-чаты, где дожим ещё не был отправлен,
  // но с момента последнего сообщения от клиента прошло >24 часов.
  // Это ловит "старые" чаты (> 2 часов), которые вышли за окно дожима.
  const chatsInactiveNoFollowup = await prisma.chat.findMany({
    where: {
      status: "BOT",
      followupSentAt: null,
      // Чат создан (или последнее сообщение было) более 24 часов назад
      lastMessageAt: { lt: inactiveNoFollowupThreshold },
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

  for (const chat of chatsInactiveNoFollowup) {
    // Клиент не писал вообще, или последнее сообщение от клиента > 24ч назад
    const lastInMsg = chat.messages[0];
    if (lastInMsg && lastInMsg.sentAt > inactiveNoFollowupThreshold) continue;

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

      await publishChatSnapshot(chat.id, chat.avitoChatId);

      stats.markedInactive++;
    } catch (e) {
      console.error(`[followup] Error marking chat ${chat.id} as inactive (24h):`, e);
      stats.errors++;
    }
  }

  console.log("[cron/followup] Done:", stats);

  return NextResponse.json({ ok: true, stats });
}
