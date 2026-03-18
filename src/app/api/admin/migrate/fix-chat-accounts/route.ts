// src/app/api/admin/migrate/fix-chat-accounts/route.ts
// Одноразовая миграция: переназначает accountId у чатов по данным Avito API.
// Перебирает всех пользователей с Avito-credentials, получает их чаты из Avito
// и обновляет accountId в локальной БД.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { avitoListChats, getAvitoCredentials } from "@/lib/avito";
import { pickFirstString } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    x?.next_offset ?? x?.nextOffset ??
    x?.pagination?.next_offset ?? x?.meta?.next_offset ??
    x?.result?.next_offset ?? null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  // Все пользователи с заполненными Avito-ключами
  const users = await prisma.user.findMany({
    where: {
      avitoClientId: { not: null },
      avitoClientSecret: { not: null },
      avitoAccountId: { not: null },
    },
    select: { id: true, username: true, avitoAccountId: true },
  });

  const results: Array<{
    userId: string;
    username: string | null;
    avitoAccountId: number;
    fetched: number;
    updated: number;
    error?: string;
  }> = [];

  for (const u of users) {
    let fetched = 0;
    let updated = 0;
    try {
      const creds = await getAvitoCredentials(u.id);
      const limit = 100;
      let offset = 0;
      let pages = 0;
      const MAX_PAGES = 200;

      while (pages < MAX_PAGES) {
        let resp: any;
        try {
          resp = await avitoListChats({ limit, offset }, creds);
        } catch (e: any) {
          const msg = String(e?.message ?? e);
          if (msg.includes("Avito API error 400")) break;
          throw e;
        }

        const chats = extractChatsArray(resp);
        fetched += chats.length;

        for (const c of chats) {
          const avitoChatId = pickFirstString(c?.id, c?.chat_id, c?.chatId, c?.uid);
          if (!avitoChatId) continue;

          const existing = await prisma.chat.findUnique({
            where: { avitoChatId },
            select: { id: true, accountId: true },
          });

          if (!existing) continue;
          if (existing.accountId === u.avitoAccountId) continue;

          await prisma.chat.update({
            where: { id: existing.id },
            data: { accountId: u.avitoAccountId! },
          });
          updated++;
        }

        const next = extractNextOffset(resp);
        if (next !== null) offset = next;
        else {
          if (chats.length < limit) break;
          offset += limit;
        }
        pages++;
        if (!chats.length) break;
      }

      results.push({ userId: u.id, username: u.username, avitoAccountId: u.avitoAccountId!, fetched, updated });
    } catch (e: any) {
      results.push({
        userId: u.id,
        username: u.username,
        avitoAccountId: u.avitoAccountId!,
        fetched,
        updated,
        error: String(e?.message ?? e),
      });
    }
  }

  const totalUpdated = results.reduce((s, r) => s + r.updated, 0);
  return NextResponse.json({ ok: true, totalUpdated, results });
}
