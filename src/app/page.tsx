// src/app/page.tsx
"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import useSWR from "swr";
import { useRouter, useSearchParams } from "next/navigation";

export const dynamic = "force-dynamic";

type ChatStatus = "BOT" | "MANAGER";
type SortOrder = "asc" | "desc";

type ChatItem = {
  id: string;
  status: ChatStatus;
  customerName: string | null;
  itemTitle: string | null;

  // ✅ цена берется с сервера (из БД chat.price)
  price?: number | null;

  lastMessageAt: string | null;
  lastMessageText: string | null;
  adUrl: string | null;
  chatUrl: string | null;
  unreadCount: number;
  pinned: boolean;
};

type MessageItem = {
  id: string;
  text: string;

  direction?: "IN" | "OUT";
  sentAt?: string;

  // важно для UI непрочитанных
  isRead?: boolean;

  author?: "CUSTOMER" | "BOT" | "MANAGER";
  createdAt?: string;

  raw?: any;
};

const IS_MOCK = (() => {
  const v = (process.env.NEXT_PUBLIC_MOCK_MODE ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
})();

async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const r = await fetch(input, { ...init, credentials: "include" });

  // если сессия протухла/нет — отправляем на /login
  if (r.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }

  return r;
}

const fetcher = (url: string) => apiFetch(url).then((r) => r.json());

type RealtimeEvent = {
  seq: number;
  type: string;
  ts: number;
  chatId?: string;
  avitoChatId?: string;
  messageId?: string;
  direction?: "IN" | "OUT";
  message?: {
    id: string;
    chatId: string;
    direction: "IN" | "OUT";
    text: string;
    sentAt: string; // ISO
    isRead: boolean;
  };
  chatSnapshot?: ChatItem;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function formatTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPrice(v?: number | null) {
  if (v === null || v === undefined) return "Цена неизвестна";
  return `${new Intl.NumberFormat("ru-RU").format(v)} ₽`;
}

function getMsgIso(m: MessageItem): string {
  return m.sentAt ?? m.createdAt ?? new Date().toISOString();
}

function toMs(m: MessageItem): number {
  const iso = m.sentAt ?? m.createdAt;
  const ms = iso ? Date.parse(iso) : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function startOfLocalDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isSameLocalDay(aIso: string, bIso: string) {
  const a = startOfLocalDay(new Date(aIso)).getTime();
  const b = startOfLocalDay(new Date(bIso)).getTime();
  return a === b;
}

function formatDayHeader(iso: string) {
  const d = new Date(iso);
  const today0 = startOfLocalDay(new Date()).getTime();
  const d0 = startOfLocalDay(d).getTime();
  const diffDays = Math.round((d0 - today0) / 86400000);

  if (diffDays === 0) return "Сегодня";
  if (diffDays === -1) return "Вчера";

  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-sky-600/10 px-2 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-sky-700/20">
      {children}
    </span>
  );
}

function DangerBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-rose-600/10 px-2 py-0.5 text-xs font-medium text-rose-800 ring-1 ring-rose-700/20">
      {children}
    </span>
  );
}

function Button({
  children,
  onClick,
  disabled,
  variant = "default",
  className,
  title,
}: {
  children: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  variant?: "default" | "ghost" | "danger";
  className?: string;
  title?: string;
}) {
  const base =
    "inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:opacity-50 disabled:pointer-events-none";
  const styles =
    variant === "danger"
      ? "bg-rose-600/10 text-rose-800 ring-1 ring-rose-700/20 hover:bg-rose-600/15"
      : variant === "ghost"
        ? "bg-transparent text-slate-700 hover:bg-slate-900/5 ring-1 ring-slate-900/10"
        : "bg-white/70 text-slate-800 hover:bg-white ring-1 ring-slate-900/10 shadow-sm";
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(base, styles, className)}
    >
      {children}
    </button>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="inline-flex rounded-xl bg-slate-900/5 ring-1 ring-slate-900/10 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-lg transition",
            value === o.value
              ? "bg-white/80 text-slate-900 shadow-sm ring-1 ring-slate-900/10"
              : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function DateDivider({ label }: { label: string }) {
  return (
    <div className="my-2 flex items-center gap-3">
      <div className="h-px flex-1 bg-slate-900/10" />
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="h-px flex-1 bg-slate-900/10" />
    </div>
  );
}

function UnreadDivider() {
  return (
    <div className="my-2 flex items-center gap-3">
      <div className="h-px flex-1 bg-slate-900/10" />
      <div className="text-[11px] text-rose-700">Непрочитанные</div>
      <div className="h-px flex-1 bg-slate-900/10" />
    </div>
  );
}

const ChatCard = React.memo(function ChatCard({
  chat,
  selected,
  onSelect,
  onTogglePin,
  showPin,
}: {
  chat: ChatItem;
  selected: boolean;
  onSelect: (id: string) => void;
  onTogglePin?: (chat: ChatItem) => void;
  showPin: boolean;
}) {
  const title = chat.itemTitle ?? "Без названия";
  const name = chat.customerName ?? "Клиент";
  const time = formatTime(chat.lastMessageAt);
  const snippet = chat.lastMessageText ?? "";
  const priceLabel = formatPrice(chat.price ?? null);

  const handleSelect = useCallback(() => onSelect(chat.id), [onSelect, chat.id]);
  const handleTogglePin = useCallback(() => onTogglePin?.(chat), [onTogglePin, chat]);

  return (
    <div
      className={cn(
        "w-full rounded-2xl transition ring-1",
        selected
          ? "bg-white/70 ring-sky-700/25 shadow-sm"
          : "bg-white/55 hover:bg-white/70 ring-slate-900/10"
      )}
    >
      <div className="flex items-start gap-2 p-3">
        <div
          role="button"
          tabIndex={0}
          onClick={handleSelect}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleSelect();
          }}
          className="min-w-0 flex-1 outline-none"
        >
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold text-slate-900">
              {title}
            </div>

            {/* ✅ цена */}
            <span className="inline-flex items-center rounded-full bg-slate-900/5 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-900/10">
              {priceLabel}
            </span>

            {chat.pinned && showPin && <Badge>PIN</Badge>}
          </div>

          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="truncate text-xs text-slate-500">{name}</div>
            <div className="shrink-0 text-xs text-slate-500">{time}</div>
          </div>

          <div className="mt-1 flex items-center justify-end gap-2">
            {chat.unreadCount > 0 ? (
              <DangerBadge>{chat.unreadCount} непроч.</DangerBadge>
            ) : (
              <span />
            )}
          </div>

          <div className="mt-2 line-clamp-2 text-xs text-slate-600">
            {snippet}
          </div>
        </div>

        {showPin && (
          <div className="shrink-0">
            <Button
              variant="ghost"
              title={chat.pinned ? "Открепить" : "Закрепить"}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleTogglePin();
              }}
            >
              {chat.pinned ? "📌" : "📍"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
});

const MessageBubble = React.memo(function MessageBubble({
  m,
  chatStatus,
}: {
  m: MessageItem;
  chatStatus: ChatStatus;
}) {
  const dir = m.direction ?? (m.author === "CUSTOMER" ? "IN" : "OUT");
  const isIn = dir === "IN";
  const isBot = m.author === "BOT" || m.raw?.bot === true;

  const label = isIn
    ? "Клиент"
    : isBot
      ? "Бот"
      : chatStatus === "BOT"
        ? "Бот"
        : "Менеджер";

  const ts = getMsgIso(m);
  const isUnread = isIn && m.isRead === false;

  return (
    <div className={cn("flex", isIn ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-3 py-2 ring-1 shadow-sm",
          isIn
            ? "bg-white/75 text-slate-900 ring-slate-900/10"
            : isBot
              ? "bg-sky-600/10 text-sky-900 ring-sky-700/20"
              : "bg-emerald-600/10 text-emerald-900 ring-emerald-700/20",
          isUnread ? "ring-rose-600/30" : ""
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="text-[11px] font-semibold text-slate-700">
              {label}
            </div>
            {isUnread && (
              <span className="inline-flex items-center rounded-full bg-rose-600/10 px-2 py-0.5 text-[10px] font-medium text-rose-800 ring-1 ring-rose-700/20">
                непроч.
              </span>
            )}
          </div>

          <div className="text-[11px] text-slate-500">
            {new Date(ts).toLocaleString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>

        <div
          className={cn(
            "mt-1 whitespace-pre-wrap text-sm leading-relaxed",
            isUnread ? "font-semibold" : ""
          )}
        >
          {m.text}
        </div>
      </div>
    </div>
  );
});

function ColumnHeader({
  title,
  subtitle,
  sortOrder,
  unreadOnly,
  setSortOrder,
  setUnreadOnly,
}: {
  title: string;
  subtitle: string;
  sortOrder: SortOrder;
  unreadOnly: boolean;
  setSortOrder: (v: SortOrder) => void;
  setUnreadOnly: (v: boolean) => void;
}) {
  return (
    <div className="z-10 bg-white/55 backdrop-blur border-b border-slate-900/10">
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-bold text-slate-900">{title}</div>
            <div className="text-xs text-slate-500">{subtitle}</div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Segmented
            value={sortOrder}
            onChange={(v) => setSortOrder(v as SortOrder)}
            options={[
              { value: "desc", label: "Сначала новые" },
              { value: "asc", label: "Сначала старые" },
            ]}
          />
          <Segmented
            value={unreadOnly ? "unread" : "all"}
            onChange={(v) => setUnreadOnly(v === "unread")}
            options={[
              { value: "all", label: "Все" },
              { value: "unread", label: "Непроч." },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

function Composer({
  onSend,
  sending,
}: {
  onSend: (text: string) => void;
  sending: boolean;
}) {
  const [draft, setDraft] = useState("");

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || sending) return;
    onSend(text);
    setDraft("");
  }, [draft, sending, onSend]);

  return (
    <div className="shrink-0 border-t border-slate-900/10 bg-white/55 backdrop-blur px-5 py-4">
      <div className="flex gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Написать сообщение..."
          className="flex-1 resize-none rounded-2xl bg-white/80 ring-1 ring-slate-900/10 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <Button onClick={handleSend} disabled={sending || !draft.trim()}>
          Отправить
        </Button>
      </div>
      <div className="mt-2 text-[11px] text-slate-500">
        В MOCK режиме отправка в Avito не идёт — сообщения сохраняются в БД, чтобы
        тестировать UI/логику.
      </div>
    </div>
  );
}

function PageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const selectedChatId = sp.get("chat");

  const [filters, setFilters] = useState<
    Record<ChatStatus, { sortOrder: SortOrder; unreadOnly: boolean }>
  >({
    BOT: { sortOrder: "desc", unreadOnly: false },
    MANAGER: { sortOrder: "desc", unreadOnly: false },
  });

  const qsBOT = useMemo(() => {
    const f = filters.BOT;
    const u = new URLSearchParams();
    u.set("status", "BOT");
    u.set("sortField", "lastMessageAt");
    u.set("sortOrder", f.sortOrder);
    u.set("limit", "5000");
    if (f.unreadOnly) u.set("unreadOnly", "1");
    return u.toString();
  }, [filters.BOT]);

  const qsMAN = useMemo(() => {
    const f = filters.MANAGER;
    const u = new URLSearchParams();
    u.set("status", "MANAGER");
    u.set("sortField", "lastMessageAt");
    u.set("sortOrder", f.sortOrder);
    u.set("limit", "5000");
    if (f.unreadOnly) u.set("unreadOnly", "1");
    return u.toString();
  }, [filters.MANAGER]);

  const [rtConnected, setRtConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refreshedChatsRef = useRef<Set<string>>(new Set());

  // ✅ Даже при подключённом SSE оставляем фоновый polling как подстраховку,
  //    чтобы пропущенные события не вызывали бесконечную задержку
  const listRefresh = rtConnected ? 30_000 : 1500;
  const msgRefresh = rtConnected ? 15_000 : 1500;

  const { data: botData, mutate: mutateBOT } = useSWR<any>(
    `/api/chats?${qsBOT}`,
    fetcher,
    { refreshInterval: listRefresh, revalidateOnFocus: true }
  );

  const { data: manData, mutate: mutateMAN } = useSWR<any>(
    `/api/chats?${qsMAN}`,
    fetcher,
    { refreshInterval: listRefresh, revalidateOnFocus: true }
  );

  const botChats: ChatItem[] = useMemo(
    () => (botData?.items ?? botData?.chats ?? []) as ChatItem[],
    [botData]
  );
  const manChats: ChatItem[] = useMemo(
    () => (manData?.items ?? manData?.chats ?? []) as ChatItem[],
    [manData]
  );

  const selectedChat: ChatItem | null = useMemo(
    () =>
      botChats.find((c) => c.id === selectedChatId) ??
      manChats.find((c) => c.id === selectedChatId) ??
      null,
    [botChats, manChats, selectedChatId]
  );

  const { data: msgData, mutate: mutateMsgs } = useSWR<any>(
    selectedChatId ? `/api/chats/${selectedChatId}/messages` : null,
    fetcher,
    { refreshInterval: msgRefresh, revalidateOnFocus: true }
  );

  const rawMsgItems: MessageItem[] = (msgData?.items ?? msgData?.messages ?? []) as MessageItem[];

  const msgItems: MessageItem[] = useMemo(() => {
    const arr = Array.isArray(rawMsgItems) ? [...rawMsgItems] : [];
    arr.sort((a, b) => toMs(a) - toMs(b));
    return arr;
  }, [rawMsgItems]);

  const firstUnreadIdx = useMemo(() => {
    return msgItems.findIndex((m) => m.direction === "IN" && m.isRead === false);
  }, [msgItems]);

  // ===== Scroll management =====
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const lastMsgKeyRef = useRef<string>("");

  function scrollToBottom(behavior: ScrollBehavior = "auto") {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }

  function handleScroll() {
    const el = messagesRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = gap < 80;
    isAtBottomRef.current = atBottom;
    if (atBottom) setShowJump(false);
  }

  useEffect(() => {
    if (!selectedChatId) return;
    setShowJump(false);
    isAtBottomRef.current = true;
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [selectedChatId]);

  useEffect(() => {
    const last = msgItems[msgItems.length - 1];
    const lastKey = last ? `${last.id}:${getMsgIso(last)}` : "";
    const prevKey = lastMsgKeyRef.current;
    lastMsgKeyRef.current = lastKey;

    if (!last || !selectedChatId) return;
    if (!prevKey) return;

    if (prevKey !== lastKey) {
      const isOut = (last.direction ?? "IN") === "OUT";
      if (isAtBottomRef.current || isOut) {
        requestAnimationFrame(() => scrollToBottom("smooth"));
        setShowJump(false);
      } else {
        setShowJump(true);
      }
    }
  }, [selectedChatId, msgItems]);

  // ===== Audio notification for incoming messages =====
  const notifAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Создаём аудио-элемент из инлайн data-URI (короткий "ding")
    // Используем Web Audio API fallback если data-URI не поддерживается
    try {
      const ctx = new AudioContext();
      notifAudioRef.current = {
        play: () => {
          try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 880;
            osc.type = "sine";
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.3);
          } catch {}
          return Promise.resolve();
        },
      } as any;
    } catch {}
  }, []);

  // ===== SSE (global) =====
  useEffect(() => {
    const es = new EventSource("/api/events");

    const pending = { lists: false, timer: 0 as any };
    const scheduleFlush = () => {
      if (pending.timer) return;
      pending.timer = window.setTimeout(async () => {
        pending.timer = 0;
        if (!pending.lists) return;
        pending.lists = false;
        await Promise.all([mutateBOT(), mutateMAN()]).catch(() => null);
      }, 120);
    };

    /** Мгновенное обновление SWR-кэша списка чатов из chatSnapshot */
    const applyChatSnapshot = (snapshot: ChatItem) => {
      const mutator = snapshot.status === "BOT" ? mutateBOT : mutateMAN;
      const otherMutator = snapshot.status === "BOT" ? mutateMAN : mutateBOT;

      mutator(
        (cur: any) => {
          if (!cur) return cur;
          const items: ChatItem[] = (cur.items ?? []) as ChatItem[];
          const idx = items.findIndex((c) => c.id === snapshot.id);
          let next: ChatItem[];
          if (idx >= 0) {
            next = [...items];
            next[idx] = { ...next[idx], ...snapshot };
          } else {
            // Новый чат — добавляем в начало
            next = [snapshot, ...items];
          }
          return { ...cur, items: next };
        },
        { revalidate: false },
      );

      // Убираем из противоположного списка (если статус сменился)
      otherMutator(
        (cur: any) => {
          if (!cur) return cur;
          const items: ChatItem[] = (cur.items ?? []) as ChatItem[];
          const idx = items.findIndex((c) => c.id === snapshot.id);
          if (idx >= 0) {
            const next = items.filter((c) => c.id !== snapshot.id);
            return { ...cur, items: next };
          }
          return cur;
        },
        { revalidate: false },
      );
    };

    const onAny = (ev: MessageEvent) => {
      let data: RealtimeEvent | null = null;
      try {
        data = JSON.parse(ev.data) as RealtimeEvent;
      } catch {
        data = null;
      }
      if (!data) return;
      if (data.type === "ping" || data.type === "hello") return;

      // Если есть chatSnapshot — мгновенно обновляем кэш без SWR refetch
      if (data.chatSnapshot) {
        applyChatSnapshot(data.chatSnapshot);
      } else {
        // fallback — полный рефетч
        pending.lists = true;
        scheduleFlush();
      }
    };

    // Обработчик new_incoming — звуковое уведомление
    const onNewIncoming = (ev: MessageEvent) => {
      let data: RealtimeEvent | null = null;
      try {
        data = JSON.parse(ev.data) as RealtimeEvent;
      } catch {
        return;
      }
      if (!data || data.type !== "new_incoming") return;

      // Звуковой сигнал
      notifAudioRef.current?.play?.()?.catch?.(() => {});

      // Если есть chatSnapshot — обновляем список
      if (data.chatSnapshot) {
        applyChatSnapshot(data.chatSnapshot);
      }
    };

    es.onopen = () => setRtConnected(true);
    es.onerror = () => setRtConnected(false);

    const types = ["chat_updated", "chat_read", "chat_pinned", "chat_finished"] as const;
    for (const t of types) es.addEventListener(t, onAny as any);
    es.addEventListener("new_incoming", onNewIncoming as any);

    return () => {
      try {
        es.close();
      } catch { }
    };
  }, [mutateBOT, mutateMAN]);

  // ===== SSE (chat scoped): message_created -> update SWR cache =====
  useEffect(() => {
    if (!selectedChatId) return;

    const u = new URL("/api/events", window.location.origin);
    u.searchParams.set("chatId", selectedChatId);
    const es = new EventSource(u.toString());

    const onMessageCreated = (e: MessageEvent<string>) => {
      let data: RealtimeEvent | null = null;
      try {
        data = JSON.parse(e.data) as RealtimeEvent;
      } catch {
        return;
      }
      if (data.type !== "message_created") return;
      const m = data.message;
      if (!m || m.chatId !== selectedChatId) return;

      const msg: MessageItem = {
        id: m.id,
        direction: m.direction,
        text: m.text,
        sentAt: m.sentAt,
        isRead: m.isRead,
      };

      mutateMsgs(
        (cur: any) => {
          const current = cur ?? { ok: true, refreshed: false, messages: [] };
          const arr: MessageItem[] = Array.isArray(current.messages)
            ? current.messages
            : Array.isArray(current.items)
              ? current.items
              : [];

          if (arr.some((x) => x.id === msg.id)) return current;

          const next = [...arr, msg].sort((a, b) => toMs(a) - toMs(b));
          if (Array.isArray(current.items)) return { ...current, items: next };
          return { ...current, messages: next };
        },
        { revalidate: false }
      );
    };

    es.addEventListener("message_created", onMessageCreated as any);

    return () => {
      try {
        es.removeEventListener("message_created", onMessageCreated as any);
      } catch { }
      try {
        es.close();
      } catch { }
    };
  }, [selectedChatId, mutateMsgs]);

  // ===== Refresh history (Avito) once if server suggests =====
  useEffect(() => {
    if (!selectedChatId) return;
    if (!msgData?.needsRefresh) return;
    if (refreshedChatsRef.current.has(selectedChatId)) return;

    refreshedChatsRef.current.add(selectedChatId);

    (async () => {
      setRefreshing(true);
      try {
        await apiFetch(`/api/chats/${selectedChatId}/messages?refresh=1`).catch(() => null);
      } finally {
        setRefreshing(false);
      }
      await mutateMsgs().catch(() => null);
    })();
  }, [selectedChatId, msgData?.needsRefresh, mutateMsgs]);

  async function markMessagesReadLocally() {
    await mutateMsgs(
      (cur: any) => {
        if (!cur) return cur;
        const list: MessageItem[] = (cur.items ?? cur.messages ?? []) as MessageItem[];
        const next = list.map((m) => {
          if (m.direction === "IN" && m.isRead === false) return { ...m, isRead: true };
          return m;
        });
        if (Array.isArray(cur.items)) return { ...cur, items: next };
        return { ...cur, messages: next };
      },
      { revalidate: false }
    );
  }

  const lastReadAtRef = useRef<Record<string, number>>({});

  async function markRead(chatId: string) {
    const now = Date.now();
    const last = lastReadAtRef.current[chatId] ?? 0;
    if (now - last < 800) return;
    lastReadAtRef.current[chatId] = now;

    await apiFetch(`/api/chats/${chatId}/read`, { method: "POST" }).catch(() => null);

    await Promise.all([mutateBOT(), mutateMAN()]);
    await markMessagesReadLocally().catch(() => null);
  }

  useEffect(() => {
    if (!selectedChatId || !rtConnected) return;
    if (!selectedChat) return;
    if ((selectedChat.unreadCount ?? 0) <= 0) return;

    const t = setTimeout(() => {
      markRead(selectedChatId);
    }, 200);

    return () => clearTimeout(t);
  }, [selectedChatId, rtConnected, selectedChat?.unreadCount]);

  useEffect(() => {
    if (!selectedChatId || !rtConnected) return;
    const hasUnread = msgItems.some((m) => m.direction === "IN" && m.isRead === false);
    if (!hasUnread) return;
    markRead(selectedChatId);
  }, [selectedChatId, rtConnected, msgItems]);

  const [sending, setSending] = useState(false);

  // ===== Webhook subscription status =====
  const { data: webhookData, mutate: mutateWebhook } = useSWR<any>(
    "/api/avito/subscribe",
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 0 }
  );
  const webhookSubscribed = webhookData?.subscribed ?? false;
  const webhookDiag = webhookData?.diagnostics;
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [showDiag, setShowDiag] = useState(false);

  async function toggleWebhookSubscription() {
    setWebhookLoading(true);
    setWebhookError(null);
    try {
      if (webhookSubscribed) {
        await apiFetch("/api/avito/subscribe", { method: "DELETE" });
      } else {
        const resp = await apiFetch("/api/avito/subscribe", { method: "POST" });
        const json = await resp.json().catch(() => null);
        if (json && !json.ok) {
          setWebhookError(json.error || "Не удалось подключить вебхук");
        }
      }
      await mutateWebhook();
    } catch (e: any) {
      setWebhookError(String(e?.message ?? "Ошибка при переключении вебхука"));
    } finally {
      setWebhookLoading(false);
    }
  }

  const selectChat = useCallback(async (id: string) => {
    const u = new URL(window.location.href);
    u.searchParams.set("chat", id);
    router.replace(u.pathname + "?" + u.searchParams.toString());
  }, [router]);

  const togglePin = useCallback(async (chat: ChatItem) => {
    await apiFetch(`/api/chats/${chat.id}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !chat.pinned }),
    });
    await Promise.all([mutateBOT(), mutateMAN()]);
  }, [mutateBOT, mutateMAN]);

  const finishDialog = useCallback(async (chat: ChatItem) => {
    await apiFetch(`/api/chats/${chat.id}/finish`, { method: "POST" });
    await Promise.all([mutateBOT(), mutateMAN()]);
  }, [mutateBOT, mutateMAN]);

  const sendMessage = useCallback(async (text: string) => {
    if (!selectedChatId) return;
    if (!text) return;

    setSending(true);
    try {
      const resp = await apiFetch(`/api/chats/${selectedChatId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, markRead: true }),
      });

      const json = await resp.json().catch(() => null);

      if (json?.message) {
        const m = json.message as MessageItem;
        await mutateMsgs(
          (cur: any) => {
            const current = cur ?? { ok: true, refreshed: false, messages: [] };
            const arr: MessageItem[] = Array.isArray(current.messages)
              ? current.messages
              : Array.isArray(current.items)
                ? current.items
                : [];

            if (arr.some((x) => x.id === m.id)) return current;

            const next = [...arr, m].sort((a, b) => toMs(a) - toMs(b));
            if (Array.isArray(current.items)) return { ...current, items: next };
            return { ...current, messages: next };
          },
          { revalidate: false }
        );

        requestAnimationFrame(() => scrollToBottom("smooth"));
      }

      await Promise.all([mutateBOT(), mutateMAN()]);
    } finally {
      setSending(false);
    }
  }, [selectedChatId, mutateMsgs, mutateBOT, mutateMAN]);

  return (
    <div className="min-h-screen flex flex-col lg:h-[100dvh] lg:overflow-hidden">
      {/* Top bar */}
      <div className="shrink-0 border-b border-slate-900/10 bg-white/55 backdrop-blur">
        <div className="mx-auto max-w-[1600px] px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-base font-bold text-slate-900">Avito CRM</div>
            <div className="text-xs text-slate-500">
              Мгновенные сообщения + AI-ответы
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge>{rtConnected ? "RT" : "RT off"}</Badge>
            {IS_MOCK ? <Badge>MOCK</Badge> : null}

            {/* AI status */}
            {webhookDiag && (
              <span className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1",
                webhookDiag.aiConfigured
                  ? "bg-emerald-600/10 text-emerald-800 ring-emerald-700/20"
                  : "bg-rose-600/10 text-rose-800 ring-rose-700/20"
              )}>
                {webhookDiag.aiConfigured ? "AI ON" : "AI OFF"}
              </span>
            )}

            {/* Webhook status */}
            {!IS_MOCK && (
              <button
                onClick={toggleWebhookSubscription}
                disabled={webhookLoading}
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 transition",
                  webhookSubscribed
                    ? "bg-emerald-600/10 text-emerald-800 ring-emerald-700/20"
                    : "bg-amber-600/10 text-amber-800 ring-amber-700/20",
                  webhookLoading ? "opacity-50 pointer-events-none" : "hover:opacity-80 cursor-pointer"
                )}
                title={
                  webhookSubscribed
                    ? "Вебхук Avito активен. Нажмите чтобы отключить."
                    : "Вебхук Avito не подключён. Нажмите чтобы подключить мгновенную доставку сообщений."
                }
              >
                {webhookSubscribed ? "Webhook ON" : "Webhook OFF"}
              </button>
            )}

            {/* Diagnostics toggle */}
            {webhookDiag && !webhookDiag.healthy && (
              <button
                onClick={() => setShowDiag((v) => !v)}
                className="inline-flex items-center rounded-full bg-rose-600/10 px-2 py-0.5 text-xs font-medium text-rose-800 ring-1 ring-rose-700/20 hover:opacity-80 cursor-pointer transition"
                title="Есть проблемы с конфигурацией"
              >
                {webhookDiag.issues?.length ?? 0} проблем
              </button>
            )}

            <a
              href="/ai-assistant"
              className="inline-flex items-center rounded-xl bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-900/10 shadow-sm hover:bg-white transition"
            >
              AI Ассистент
            </a>
          </div>
        </div>

        {/* Diagnostics panel */}
        {showDiag && webhookDiag?.issues?.length > 0 && (
          <div className="mx-auto max-w-[1600px] px-4 pb-3">
            <div className="rounded-2xl bg-rose-50 ring-1 ring-rose-200 p-3 space-y-1">
              <div className="text-xs font-semibold text-rose-900">Диагностика конфигурации:</div>
              {webhookDiag.issues.map((issue: string, i: number) => (
                <div key={i} className="text-xs text-rose-800">• {issue}</div>
              ))}
            </div>
          </div>
        )}

        {/* Webhook error */}
        {webhookError && (
          <div className="mx-auto max-w-[1600px] px-4 pb-3">
            <div className="rounded-2xl bg-amber-50 ring-1 ring-amber-200 p-3 flex items-center justify-between">
              <div className="text-xs text-amber-900">{webhookError}</div>
              <button onClick={() => setWebhookError(null)} className="text-xs text-amber-700 hover:text-amber-900 ml-2">x</button>
            </div>
          </div>
        )}
      </div>

      {/* Main area */}
      <div className="mx-auto max-w-[1600px] w-full px-4 py-4 flex-1 lg:min-h-0">
        <div className="grid gap-4 lg:grid-cols-[360px_360px_1fr] lg:h-full lg:min-h-0">
          {/* BOT column */}
          <section className="rounded-3xl bg-white/50 ring-1 ring-slate-900/10 overflow-hidden lg:flex lg:flex-col lg:min-h-0">
            <ColumnHeader
              title="Обработка ботом"
              subtitle="чаты, где отвечает бот"
              sortOrder={filters.BOT.sortOrder}
              unreadOnly={filters.BOT.unreadOnly}
              setSortOrder={(v) =>
                setFilters((p) => ({ ...p, BOT: { ...p.BOT, sortOrder: v } }))
              }
              setUnreadOnly={(v) =>
                setFilters((p) => ({ ...p, BOT: { ...p.BOT, unreadOnly: v } }))
              }
            />

            <div className="p-3 space-y-2 lg:flex-1 lg:min-h-0 overflow-auto">
              {botChats.length === 0 ? (
                <div className="rounded-2xl bg-white/60 ring-1 ring-slate-900/10 p-4 text-sm text-slate-600">
                  Тут пока пусто
                </div>
              ) : (
                botChats.map((c) => (
                  <ChatCard
                    key={c.id}
                    chat={c}
                    selected={c.id === selectedChatId}
                    onSelect={selectChat}
                    showPin={false}
                  />
                ))
              )}
            </div>
          </section>

          {/* MANAGER column */}
          <section className="rounded-3xl bg-white/50 ring-1 ring-slate-900/10 overflow-hidden lg:flex lg:flex-col lg:min-h-0">
            <ColumnHeader
              title="Переведен на менеджера"
              subtitle="чаты для оператора + закрепы"
              sortOrder={filters.MANAGER.sortOrder}
              unreadOnly={filters.MANAGER.unreadOnly}
              setSortOrder={(v) =>
                setFilters((p) => ({
                  ...p,
                  MANAGER: { ...p.MANAGER, sortOrder: v },
                }))
              }
              setUnreadOnly={(v) =>
                setFilters((p) => ({
                  ...p,
                  MANAGER: { ...p.MANAGER, unreadOnly: v },
                }))
              }
            />

            <div className="p-3 space-y-2 lg:flex-1 lg:min-h-0 overflow-auto">
              {manChats.length === 0 ? (
                <div className="rounded-2xl bg-white/60 ring-1 ring-slate-900/10 p-4 text-sm text-slate-600">
                  Тут пока пусто
                </div>
              ) : (
                manChats.map((c) => (
                  <ChatCard
                    key={c.id}
                    chat={c}
                    selected={c.id === selectedChatId}
                    onSelect={selectChat}
                    onTogglePin={togglePin}
                    showPin={true}
                  />
                ))
              )}
            </div>
          </section>

          {/* Chat panel */}
          <section className="rounded-3xl bg-white/50 ring-1 ring-slate-900/10 overflow-hidden lg:flex lg:flex-col lg:min-h-0 min-h-[520px]">
            {!selectedChat ? (
              <div className="p-6 flex-1 lg:min-h-0 flex items-center justify-center">
                <div className="max-w-md rounded-3xl bg-white/60 ring-1 ring-slate-900/10 p-6 shadow-sm">
                  <div className="text-lg font-bold text-slate-900">Выбери чат</div>
                  <div className="mt-2 text-sm text-slate-600">
                    Слева две колонки. Нажми на чат — справа откроется переписка.
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col flex-1 lg:min-h-0">
                {/* Chat header */}
                <div className="shrink-0 border-b border-slate-900/10 bg-white/55 backdrop-blur px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-base font-bold text-slate-900">
                          {selectedChat.itemTitle ?? "Без названия"}
                        </div>
                        <Badge>{selectedChat.status}</Badge>
                        {selectedChat.unreadCount > 0 && (
                          <DangerBadge>{selectedChat.unreadCount} непроч.</DangerBadge>
                        )}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                        <div>
                          Клиент:{" "}
                          <span className="text-slate-800">
                            {selectedChat.customerName ?? "—"}
                          </span>
                        </div>

                        {/* ✅ цена */}
                        <div>
                          Цена:{" "}
                          <span className="text-slate-800">
                            {formatPrice(selectedChat.price ?? null)}
                          </span>
                        </div>

                        {selectedChat.adUrl && (
                          <a
                            className="text-sky-700 hover:text-sky-800"
                            href={selectedChat.adUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            объявление
                          </a>
                        )}
                        {selectedChat.chatUrl && (
                          <a
                            className="text-sky-700 hover:text-sky-800"
                            href={selectedChat.chatUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            чат
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {selectedChat.status === "MANAGER" && (
                        <Button variant="danger" onClick={() => finishDialog(selectedChat)}>
                          Завершить диалог → BOT
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Messages */}
                <div
                  ref={messagesRef}
                  onScroll={handleScroll}
                  className="relative flex-1 min-h-0 overflow-auto px-5 py-4 space-y-3 bg-gradient-to-b from-white/30 to-white/10"
                >
                  {refreshing && (
                    <div className="sticky top-0 z-10 -mx-5 px-5 pb-2">
                      <div className="rounded-2xl bg-white/70 ring-1 ring-slate-900/10 px-3 py-2 text-xs text-slate-700 flex items-center justify-between shadow-sm">
                        <span>Подгружаю историю из Avito…</span>
                        <span className="text-slate-500">refresh=1</span>
                      </div>
                    </div>
                  )}

                  {msgItems.map((m, idx) => {
                    const ts = getMsgIso(m);
                    const prev = idx > 0 ? getMsgIso(msgItems[idx - 1]) : "";
                    const showDate = idx === 0 || !isSameLocalDay(ts, prev);
                    const dateLabel = formatDayHeader(ts);

                    return (
                      <React.Fragment key={m.id}>
                        {showDate && <DateDivider label={dateLabel} />}
                        {firstUnreadIdx >= 0 && idx === firstUnreadIdx && <UnreadDivider />}
                        <MessageBubble m={m} chatStatus={selectedChat.status} />
                      </React.Fragment>
                    );
                  })}

                  {showJump && (
                    <div className="sticky bottom-3 flex justify-end">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          scrollToBottom("smooth");
                          setShowJump(false);
                        }}
                        className="shadow-sm"
                        title="Прокрутить вниз"
                      >
                        Вниз ↓
                      </Button>
                    </div>
                  )}
                </div>

                {/* Composer */}
                <Composer onSend={sendMessage} sending={sending} />
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-slate-500">
          Loading…
        </div>
      }
    >
      <PageInner />
    </Suspense>
  );
}
