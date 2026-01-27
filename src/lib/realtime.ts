// src/lib/realtime.ts
// Минимальная "шина" событий внутри процесса Node.js.
// Работает отлично для dev / single-instance. Для масштабирования дальше можно
// заменить на Postgres LISTEN/NOTIFY или Redis pub/sub.

import { EventEmitter } from "events";

export type CRMRealtimeEvent = {
  seq: number;
  type:
    | "hello"
    | "ping"
    | "chat_updated"
    | "message_created"
    | "chat_finished"
    | "chat_pinned"
    | "chat_read";
  ts: number;
  chatId?: string;
  avitoChatId?: string;
  messageId?: string;
  direction?: "IN" | "OUT";

  // Минимальный payload сообщения для мгновенного обновления UI без revalidate.
  // sentAt — ISO строка (чтобы не тянуть Date по SSE).
  message?: {
    id: string;
    chatId: string;
    direction: "IN" | "OUT";
    text: string;
    sentAt: string;
    isRead: boolean;
  };
};

type GlobalWithRealtime = typeof globalThis & {
  __crmEmitter?: EventEmitter;
  __crmSeq?: number;
};

const g = globalThis as GlobalWithRealtime;

if (!g.__crmEmitter) {
  g.__crmEmitter = new EventEmitter();
  // чтобы не получать MaxListenersExceededWarning при большом числе вкладок
  g.__crmEmitter.setMaxListeners(1000);
}

if (!g.__crmSeq) g.__crmSeq = 1;

function nextSeq() {
  g.__crmSeq = (g.__crmSeq ?? 1) + 1;
  return g.__crmSeq;
}

// Создает событие с seq/ts, но НЕ публикует его в шину.
// Нужно для локальных служебных событий внутри SSE соединения (hello/ping)
// чтобы не засорять остальных подписчиков.
export function makeEvent(event: Omit<CRMRealtimeEvent, "seq" | "ts">): CRMRealtimeEvent {
  return { ...event, seq: nextSeq(), ts: Date.now() };
}

export function publish(event: Omit<CRMRealtimeEvent, "seq" | "ts">) {
  const full: CRMRealtimeEvent = { ...event, seq: nextSeq(), ts: Date.now() };
  g.__crmEmitter!.emit("event", full);
  if (full.chatId) g.__crmEmitter!.emit(`chat:${full.chatId}`, full);
  return full;
}

export function subscribe(handler: (e: CRMRealtimeEvent) => void) {
  g.__crmEmitter!.on("event", handler);
  return () => g.__crmEmitter!.off("event", handler);
}

export function subscribeChat(chatId: string, handler: (e: CRMRealtimeEvent) => void) {
  const key = `chat:${chatId}`;
  g.__crmEmitter!.on(key, handler);
  return () => g.__crmEmitter!.off(key, handler);
}
