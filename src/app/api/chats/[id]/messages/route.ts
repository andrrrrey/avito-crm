// src/app/api/chats/[id]/messages/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import { avitoListMessages } from "@/lib/avito";
import { pickFirstString, pickFirstNumber } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function toDateMaybe(v: any): Date | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v * 1000);
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function getHistorySyncedAt(raw: any): string | null {
  if (!raw || typeof raw !== "object") return null;
  const v =
    (raw as any).historySyncedAt ??
    (raw as any).history?.syncedAt ??
    (raw as any).history?.synced_at ??
    null;
  return typeof v === "string" && v.trim() ? v : null;
}

async function readFromDb(chatId: string) {
  // ✅ показываем последние сообщения (а не самые старые)
  const rows = await prisma.message.findMany({
    where: { chatId },
    orderBy: { sentAt: "desc" },
    take: 500,
  });

  // rows сейчас newest->oldest, разворачиваем в old->new для UI
  const ordered = rows.slice().reverse();

  return ordered.map((m) => ({
    id: m.id,
    chatId: m.chatId,
    direction: m.direction,
    text: m.text,
    sentAt: m.sentAt,
    isRead: m.isRead,
  }));
}

async function refreshFromAvito(chat: { id: string; avitoChatId: string | null; unreadCount: number; raw: any }) {
  if (env.MOCK_MODE) {
    return { ok: true as const, refreshed: false, messages: await readFromDb(chat.id) };
  }

  if (!chat.avitoChatId) {
    return { ok: false as const, status: 409, error: "chat_not_linked_to_avito" };
  }

  // Avito API (v3/v2/v1) часто возвращает объект с массивом внутри.
  const extractMessagesArray = (resp: any): any[] => {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;

    const candidates = [
      resp.items,
      resp.messages,
      resp.data,
      resp.result?.items,
      resp.result?.messages,
      resp.result?.data,
      resp.payload?.items,
      resp.payload?.messages,
      resp.value,
      resp.value?.items,
      resp.value?.messages,
    ];

    for (const c of candidates) {
      if (Array.isArray(c)) return c;
    }

    // иногда единичный объект
    if (resp?.message && typeof resp.message === "object") return [resp.message];
    if (resp?.id && (resp?.content || resp?.text)) return [resp];
    return [];
  };

  const LIMIT = 100;
  const MAX_PAGES = 20; // 20*100 = до 2000 сообщений за один refresh
  let offset = 0;
  let pages = 0;

  let avitoMessages: any[] = [];

  try {
    while (pages < MAX_PAGES) {
      const resp = await avitoListMessages(chat.avitoChatId, { limit: LIMIT, offset });
      const batch = extractMessagesArray(resp);

      if (!batch.length) break;

      avitoMessages.push(...batch);

      // если вернули меньше лимита — дальше смысла нет
      if (batch.length < LIMIT) break;

      offset += LIMIT;
      pages += 1;
    }
  } catch (e: any) {
    return { ok: false as const, status: 502, error: "avito_messages_failed", message: String(e?.message ?? e) };
  }

  const now = new Date();

  const mapped = avitoMessages
    .map((m: any) => {
      const avitoMessageId = pickFirstString(m?.id, m?.message_id, m?.value?.id, m?.message?.id);
      if (!avitoMessageId) return null;

      const authorIdRaw = pickFirstNumber(
        m?.author_id,
        m?.authorId,
        m?.from?.id,
        m?.author?.id,
        m?.value?.author_id,
        m?.value?.from?.id
      );

      const authorIdNum =
        typeof authorIdRaw === "number"
          ? authorIdRaw
          : typeof authorIdRaw === "string"
            ? Number(authorIdRaw)
            : NaN;

      const myId = Number(env.AVITO_ACCOUNT_ID);

      const direction =
        Number.isFinite(authorIdNum) && Number.isFinite(myId) && authorIdNum === myId ? "OUT" : "IN";

      const sentAt =
        toDateMaybe(m?.created) ||
        toDateMaybe(m?.created_at) ||
        toDateMaybe(m?.timestamp) ||
        now;

      const text = String(
        m?.content?.text ??
          m?.text ??
          m?.content?.message?.text ??
          m?.message?.text ??
          ""
      );

      // эвристика: если у чата unreadCount==0 — считаем входящие прочитанными
      const isRead = direction === "OUT" ? true : chat.unreadCount === 0;

      return { avitoMessageId, direction, text, sentAt, isRead, raw: m };
    })
    .filter(Boolean) as Array<{
    avitoMessageId: string;
    direction: "IN" | "OUT";
    text: string;
    sentAt: Date;
    isRead: boolean;
    raw: any;
  }>;

  const syncAtIso = new Date().toISOString();
  const prevRaw = chat.raw && typeof chat.raw === "object" ? (chat.raw as any) : {};

  await prisma.$transaction(async (tx) => {
    for (const m of mapped) {
      await tx.message.upsert({
        where: { chatId_avitoMessageId: { chatId: chat.id, avitoMessageId: m.avitoMessageId } },
        create: {
          chatId: chat.id,
          avitoMessageId: m.avitoMessageId,
          direction: m.direction,
          text: m.text,
          sentAt: m.sentAt,
          isRead: m.isRead,
          raw: m.raw,
        },
        update: {
          direction: m.direction,
          text: m.text,
          sentAt: m.sentAt,
          isRead: m.isRead,
          raw: m.raw,
        },
      });
    }

    // пересчет непрочитанных
    const unread = await tx.message.count({ where: { chatId: chat.id, direction: "IN", isRead: false } });
    await tx.chat.update({
      where: { id: chat.id },
      data: {
        unreadCount: unread,
        raw: {
          ...prevRaw,
          historySyncedAt: syncAtIso,
          historySync: {
            at: syncAtIso,
            fetched: mapped.length,
            pagesTried: MAX_PAGES,
            limit: LIMIT,
          },
        },
      },
    });
  });

  return { ok: true as const, refreshed: true, messages: await readFromDb(chat.id) };
}

export async function GET(req: Request, ctx: Ctx) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1" || url.searchParams.get("source") === "avito";

  const chat = await prisma.chat.findUnique({
    where: { id },
    select: { id: true, avitoChatId: true, unreadCount: true, raw: true },
  });
  if (!chat) return NextResponse.json({ ok: false, error: "chat_not_found" }, { status: 404 });

  const hasHistory = Boolean(getHistorySyncedAt(chat.raw));
  const canRefresh = !env.MOCK_MODE && Boolean(chat.avitoChatId);

  // По умолчанию: только БД (чтобы активный чат не долбил Avito постоянно)
  if (!refresh) {
    const messages = await readFromDb(chat.id);

    // ✅ needsRefresh теперь зависит от флага historySyncedAt,
    // а не от messages.length === 0 (у тебя в БД может быть 1 сообщение из вебхука).
    const needsRefresh = canRefresh && !hasHistory;

    return NextResponse.json({
      ok: true,
      refreshed: false,
      messages,
      ...(needsRefresh ? { needsRefresh: true } : {}),
    });
  }

  const res = await refreshFromAvito(chat);
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error, message: (res as any).message },
      { status: (res as any).status ?? 500 }
    );
  }

  return NextResponse.json({ ok: true, refreshed: res.refreshed, messages: res.messages });
}
