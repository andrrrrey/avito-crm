// src/app/api/user/generate-instructions/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LISTINGS = 30;

export async function POST(req: Request) {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Получаем настройки пользователя и AI
  const [dbUser, aiSettings] = await Promise.all([
    prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: { avitoAccountId: true },
    }),
    prisma.aiAssistant.findUnique({ where: { id: 1 } }),
  ]);

  if (!aiSettings) {
    return NextResponse.json({ ok: false, error: "AI не настроен администратором" }, { status: 400 });
  }

  const provider = aiSettings.provider ?? "openai";

  if (provider === "openai" && !aiSettings.apiKey) {
    return NextResponse.json({ ok: false, error: "API-ключ OpenAI не настроен" }, { status: 400 });
  }
  if (provider === "deepseek" && !aiSettings.deepseekApiKey) {
    return NextResponse.json({ ok: false, error: "API-ключ DeepSeek не настроен" }, { status: 400 });
  }
  if (!aiSettings.model) {
    return NextResponse.json({ ok: false, error: "Модель AI не выбрана" }, { status: 400 });
  }

  const accountId = dbUser?.avitoAccountId ?? null;
  if (!accountId) {
    return NextResponse.json({ ok: false, error: "Не указан Avito Account ID" }, { status: 400 });
  }

  // Берём до 30 уникальных объявлений пользователя
  const chats = await prisma.chat.findMany({
    where: { accountId },
    orderBy: { lastMessageAt: "desc" },
    take: MAX_LISTINGS * 5, // берём с запасом, чтобы после дедупликации осталось нужное количество
    select: {
      itemTitle: true,
      price: true,
      adUrl: true,
    },
  });

  // Дедупликация по itemTitle
  const seen = new Set<string>();
  const listings: { title: string; price: number | null; adUrl: string | null }[] = [];

  for (const chat of chats) {
    if (!chat.itemTitle) continue;
    const key = chat.itemTitle.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    listings.push({
      title: chat.itemTitle.trim(),
      price: chat.price,
      adUrl: chat.adUrl,
    });
    if (listings.length >= MAX_LISTINGS) break;
  }

  if (listings.length === 0) {
    return NextResponse.json({ ok: false, error: "Нет объявлений для анализа. Сначала синхронизируйте чаты." }, { status: 400 });
  }

  // Формируем список объявлений для промпта
  const listingsText = listings
    .map((l, i) => {
      const parts = [`${i + 1}. ${l.title}`];
      if (l.price) parts.push(`Цена: ${l.price} ₽`);
      return parts.join(" — ");
    })
    .join("\n");

  const systemPrompt = `Ты — эксперт по настройке ИИ-ассистентов для продавцов на Avito.
Твоя задача — на основе списка объявлений продавца составить две вещи:
1. Подробную, точную и качественную инструкцию для ИИ-ассистента, который будет отвечать на вопросы покупателей в чатах.
2. Промпт переключения на менеджера — условия, при которых ИИ должен передать разговор живому оператору.

Инструкция должна:
- Описывать, чем занимается продавец (какие товары/услуги предлагает)
- Указывать tone of voice (дружелюбный, профессиональный, лаконичный)
- Давать конкретные рекомендации по ответам на типичные вопросы о товарах
- Включать правила работы с ценовыми запросами и торгом
- Описывать как отвечать на вопросы о состоянии, доставке, самовывозе
- Быть написана от второго лица ("Ты — ...")

Промпт переключения должен:
- Указывать конкретные ситуации для переключения на менеджера
- Быть лаконичным (3-7 пунктов)

Отвечай строго в формате JSON:
{
  "instructions": "...",
  "escalatePrompt": "..."
}`;

  const userPrompt = `Вот список объявлений продавца (${listings.length} шт.):\n\n${listingsText}\n\nСоставь инструкцию для ИИ-ассистента и промпт переключения на менеджера.`;

  try {
    let instructions = "";
    let escalatePrompt = "";

    if (provider === "deepseek") {
      const client = new OpenAI({
        apiKey: aiSettings.deepseekApiKey!,
        baseURL: "https://api.deepseek.com/v1",
      });

      const completion = await client.chat.completions.create({
        model: aiSettings.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      });

      const content = completion.choices[0]?.message?.content ?? "";
      const parsed = JSON.parse(content);
      instructions = parsed.instructions ?? "";
      escalatePrompt = parsed.escalatePrompt ?? "";
    } else {
      // OpenAI
      const client = new OpenAI({ apiKey: aiSettings.apiKey! });

      const response = await client.chat.completions.create({
        model: aiSettings.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content ?? "";
      const parsed = JSON.parse(content);
      instructions = parsed.instructions ?? "";
      escalatePrompt = parsed.escalatePrompt ?? "";
    }

    if (!instructions) {
      return NextResponse.json({ ok: false, error: "ИИ не вернул результат" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, instructions, escalatePrompt, listingsCount: listings.length });
  } catch (e: unknown) {
    console.error("[generate-instructions] Error:", e);
    const message = e instanceof Error ? e.message : "Ошибка при генерации";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
