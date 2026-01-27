import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SeedMessage = {
  id: string; // локальный id для avitoMessageId
  direction: "IN" | "OUT";
  text: string;
  minutesAgo: number;
  isRead?: boolean;
};

type SeedChat = {
  avitoChatId: string;
  status: "BOT" | "MANAGER";
  pinned?: boolean;
  customerName: string;
  itemTitle: string;
  price?: number;
  messages: SeedMessage[];
};

function dtMinutesAgo(m: number) {
  return new Date(Date.now() - m * 60_000);
}

const SEED: SeedChat[] = [
  {
    avitoChatId: "mock_chat_bot_1",
    status: "BOT",
    pinned: false,
    customerName: "Артем",
    itemTitle: "Утюг Philips GC2990",
    price: 2590,
    messages: [
      { id: "1", direction: "IN", text: "Здравствуйте! Можно забрать сегодня?", minutesAgo: 180, isRead: false },
      { id: "2", direction: "OUT", text: "Здравствуйте! Да, сегодня можно.", minutesAgo: 175, isRead: true },
      { id: "3", direction: "IN", text: "Супер, где вы находитесь?", minutesAgo: 170, isRead: false },
    ],
  },
  {
    avitoChatId: "mock_chat_bot_2",
    status: "BOT",
    pinned: false,
    customerName: "Ольга",
    itemTitle: "Утюг Tefal FV5688",
    price: 3490,
    messages: [
      { id: "1", direction: "IN", text: "Добрый день! Торг возможен?", minutesAgo: 140, isRead: false },
      { id: "2", direction: "OUT", text: "Добрый! Небольшой торг возможен.", minutesAgo: 138, isRead: true },
      { id: "3", direction: "IN", text: "Тогда заберу за 3200.", minutesAgo: 135, isRead: false },
    ],
  },
  {
    avitoChatId: "mock_chat_mgr_1",
    status: "MANAGER",
    pinned: true,
    customerName: "Иван",
    itemTitle: "Утюг Braun SI3041",
    price: 2990,
    messages: [
      { id: "1", direction: "IN", text: "Здравствуйте! А доставка есть?", minutesAgo: 220, isRead: false },
      { id: "2", direction: "OUT", text: "Здравствуйте! Да, могу отправить СДЭКом.", minutesAgo: 215, isRead: true },
      { id: "3", direction: "IN", text: "Ок, тогда оформляем.", minutesAgo: 210, isRead: false },
    ],
  },
  {
    avitoChatId: "mock_chat_mgr_2",
    status: "MANAGER",
    pinned: false,
    customerName: "Мария",
    itemTitle: "Утюг Redmond RI-C273S",
    price: 2790,
    messages: [
      { id: "1", direction: "IN", text: "Есть ли дефекты/царапины?", minutesAgo: 90, isRead: false },
      { id: "2", direction: "OUT", text: "Нет, состояние отличное, могу фото.", minutesAgo: 88, isRead: true },
      { id: "3", direction: "IN", text: "Да, пришлите фото пожалуйста.", minutesAgo: 85, isRead: false },
    ],
  },
];

export async function POST(req: Request) {
  const guard = requireToken(req);
  if (guard) return guard;

  // делаем сиды детерминированными: очищаем мок-данные
  const avitoChatIds = SEED.map((c) => c.avitoChatId);

  // удаляем сообщения этих чатов (на случай если связи уже есть)
  const chats = await prisma.chat.findMany({
    where: { avitoChatId: { in: avitoChatIds } },
    select: { id: true, avitoChatId: true },
  });

  const chatIds = chats.map((c) => c.id);
  if (chatIds.length) {
    await prisma.message.deleteMany({ where: { chatId: { in: chatIds } } });
    await prisma.chat.deleteMany({ where: { id: { in: chatIds } } });
  }

  let createdChats = 0;
  let createdMessages = 0;

  for (const c of SEED) {
    const chat = await prisma.chat.create({
      data: {
        avitoChatId: c.avitoChatId,
        accountId: 0,
        status: c.status,
        pinned: Boolean(c.pinned),
        customerName: c.customerName,
        itemTitle: c.itemTitle,
        price: c.price ?? null,
        raw: { mock: true },
      },
    });
    createdChats++;

    // создаём сообщения
    // (avitoMessageId обязателен и уникален в рамках chatId)
    const sorted = [...c.messages].sort((a, b) => b.minutesAgo - a.minutesAgo); // от старых к новым
    for (const m of sorted) {
      const sentAt = dtMinutesAgo(m.minutesAgo);
      await prisma.message.create({
        data: {
          chatId: chat.id,
          avitoMessageId: `mock_${c.avitoChatId}_${m.id}`,
          direction: m.direction,
          text: m.text,
          sentAt,
          isRead: m.direction === "OUT" ? true : Boolean(m.isRead),
          raw: { mock: true },
        },
      });
      createdMessages++;
    }

    // lastMessage* и unreadCount
    const last = c.messages.reduce((best, cur) => (cur.minutesAgo < best.minutesAgo ? cur : best), c.messages[0]);
    const lastAt = dtMinutesAgo(last.minutesAgo);

    const unread = c.messages.filter((m) => m.direction === "IN" && !Boolean(m.isRead)).length;

    await prisma.chat.update({
      where: { id: chat.id },
      data: {
        lastMessageAt: lastAt,
        lastMessageText: last.text,
        unreadCount: unread,
      },
    });
  }

  return NextResponse.json({ ok: true, createdChats, createdMessages });
}
