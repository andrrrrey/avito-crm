// src/app/api/chats/[id]/links/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import { avitoGetChatInfo } from "@/lib/avito";
import { buildAvitoOrderUrl, extractOrderId, unwrapAvitoRoot } from "@/lib/avitoParse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function orderIdFromChatId(avitoChatId: string | null): string | null {
  if (!avitoChatId) return null;
  const s = String(avitoChatId).trim();
  // эвристика под заказы (пример 70000000400529070)
  if (/^7\d{13,}$/.test(s)) return s;
  return null;
}

export async function GET(req: Request, ctx: Ctx) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const { id } = await ctx.params;

  const chat = await prisma.chat.findUnique({
    where: { id },
    select: { id: true, avitoChatId: true, adUrl: true, chatUrl: true, raw: true },
  });

  if (!chat) return NextResponse.json({ ok: false, error: "chat_not_found" }, { status: 404 });

  const prevRaw = (chat.raw && typeof chat.raw === "object") ? (chat.raw as any) : {};
  let orderId: string | null = extractOrderId(prevRaw) ?? orderIdFromChatId(chat.avitoChatId);
  let chatUrl: string | null = chat.chatUrl ?? null;
  let adUrl: string | null = chat.adUrl ?? null;

  // если orderId/chatUrl не нашли, пробуем добрать из Avito (один раз) и закешировать в raw
  if (!env.MOCK_MODE && chat.avitoChatId && (!orderId || !chatUrl)) {
    try {
      const info: any = await avitoGetChatInfo(chat.avitoChatId);
      const root = unwrapAvitoRoot(info);

      const extractedOrderId = extractOrderId(info);
      if (!orderId && extractedOrderId) orderId = extractedOrderId;

      const infoChatUrl = (root?.chat_url ?? root?.chatUrl ?? null) as string | null;
      const ctx = root?.context?.value ?? root?.context ?? null;
      const ctxValue = ctx?.value ?? ctx;
      const ctxUrl = (ctxValue?.url ?? root?.url ?? null) as string | null;

      // chat_url чаще всего на корне
      if (!chatUrl && infoChatUrl) chatUrl = infoChatUrl;
      // url объявления часто в контексте
      if (!adUrl && ctxUrl) adUrl = ctxUrl;

      const patch: any = {};
      if (!chat.chatUrl && chatUrl) patch.chatUrl = chatUrl;
      if (!chat.adUrl && adUrl) patch.adUrl = adUrl;

      if (orderId && !prevRaw.orderId) {
        patch.raw = {
          ...prevRaw,
          orderId,
          orderIdSource: "avitoGetChatInfo",
          orderIdAt: new Date().toISOString(),
        };
      }

      if (Object.keys(patch).length) {
        await prisma.chat.update({ where: { id: chat.id }, data: patch });
      }
    } catch {
      // не валим UI
    }
  }

  const orderUrl = orderId ? buildAvitoOrderUrl(orderId) : null;

  return NextResponse.json({
    ok: true,
    avitoChatId: chat.avitoChatId,
    chatUrl,
    adUrl,
    orderId,
    orderUrl,
  });
}
