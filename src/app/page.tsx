// src/app/page.tsx
"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import useSWR from "swr";
import { useRouter, useSearchParams } from "next/navigation";

export const dynamic = "force-dynamic";

type ChatStatus = "BOT" | "MANAGER" | "INACTIVE";
type SortOrder = "asc" | "desc";

type ChatItem = {
  id: string;
  status: ChatStatus;
  customerName: string | null;
  itemTitle: string | null;
  price?: number | null;
  lastMessageAt: string | null;
  lastMessageText: string | null;
  adUrl: string | null;
  chatUrl: string | null;
  unreadCount: number;
  pinned: boolean;
  followupSentAt?: string | null;
};

type MessageItem = {
  id: string;
  text: string;
  direction?: "IN" | "OUT";
  sentAt?: string;
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
    sentAt: string;
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
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
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

// ─── SVG Icons ───────────────────────────────────────────────────────────────

function IconSparkles({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" />
    </svg>
  );
}

function IconSearch({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function IconPaperclip({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function IconSend({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function IconCheckCheck({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 7 17l-5-5" />
      <path d="m22 10-7.5 7.5L13 16" />
    </svg>
  );
}

// ─── UI Primitives ────────────────────────────────────────────────────────────

function DateDivider({ label }: { label: string }) {
  return (
    <div className="flex justify-center my-2">
      <span className="text-[10px] text-zinc-400 bg-zinc-100 px-2 py-1 rounded-full uppercase tracking-wider font-bold font-geist">
        {label}
      </span>
    </div>
  );
}

function UnreadDivider() {
  return (
    <div className="flex justify-center my-2">
      <span className="text-[10px] text-rose-600 bg-rose-50 px-2 py-1 rounded-full uppercase tracking-wider font-bold font-geist border border-rose-100">
        Непрочитанные
      </span>
    </div>
  );
}

// ─── ChatCard ─────────────────────────────────────────────────────────────────

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

  const statusLabel =
    chat.status === "BOT" ? "ИИ" : chat.status === "MANAGER" ? "Менеджер" : "Неактив";
  const statusClass =
    chat.status === "BOT"
      ? "bg-blue-50 text-blue-600 border border-blue-100"
      : chat.status === "MANAGER"
        ? "bg-orange-50 text-orange-600 border border-orange-100"
        : "bg-zinc-100 text-zinc-500 border border-zinc-200";

  const handleSelect = useCallback(() => onSelect(chat.id), [onSelect, chat.id]);

  return (
    <div
      onClick={handleSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleSelect();
      }}
      className={cn(
        "p-3 bg-white rounded-2xl cursor-pointer transition outline-none",
        selected
          ? "border-2 border-green-400 shadow-sm"
          : "border border-zinc-100 hover:border-zinc-300"
      )}
    >
      <div className="flex justify-between items-start mb-1">
        <span
          className={cn(
            "text-sm font-geist truncate mr-2",
            selected ? "font-bold" : "font-medium text-zinc-700"
          )}
        >
          {name}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {chat.unreadCount > 0 && (
            <span className="min-w-[18px] h-[18px] rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
              {chat.unreadCount}
            </span>
          )}
          <span className="text-[10px] text-zinc-400">{time}</span>
        </div>
      </div>

      <div className="text-xs text-zinc-500 mb-2 truncate">
        {title} • {priceLabel}
      </div>

      {snippet && (
        <div className="text-[11px] text-zinc-400 truncate mb-2">{snippet}</div>
      )}

      <div className="flex items-center justify-between">
        <span className={cn("px-2 py-0.5 rounded-md text-[10px] font-bold", statusClass)}>
          {statusLabel}
        </span>
        {showPin && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onTogglePin?.(chat);
            }}
            className="text-[13px] leading-none opacity-50 hover:opacity-100 transition"
            title={chat.pinned ? "Открепить" : "Закрепить"}
          >
            {chat.pinned ? "📌" : "📍"}
          </button>
        )}
      </div>
    </div>
  );
});

// ─── MessageBubble ────────────────────────────────────────────────────────────

const MessageBubble = React.memo(function MessageBubble({
  m,
  chatStatus,
  customerName,
}: {
  m: MessageItem;
  chatStatus: ChatStatus;
  customerName?: string | null;
}) {
  const dir = m.direction ?? (m.author === "CUSTOMER" ? "IN" : "OUT");
  const isIn = dir === "IN";
  const isBot =
    m.author === "BOT" ||
    m.raw?.bot === true ||
    (dir === "OUT" && chatStatus === "BOT" && m.author !== "MANAGER");
  const isUnread = isIn && m.isRead === false;

  const ts = getMsgIso(m);
  const timeStr = new Date(ts).toLocaleString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isIn) {
    return (
      <div className="max-w-[70%]">
        <div
          className={cn(
            "bg-white border border-zinc-100 rounded-2xl rounded-tl-none p-3 shadow-sm",
            isUnread && "border-rose-200"
          )}
        >
          <p className={cn("text-sm text-zinc-800 font-geist", isUnread && "font-semibold")}>
            {m.text}
          </p>
        </div>
        <span className="text-[10px] text-zinc-400 mt-1 ml-1 block">
          {customerName ?? "Клиент"} • {timeStr}
        </span>
      </div>
    );
  }

  return (
    <div className="max-w-[70%] ml-auto text-right">
      <div
        className={cn(
          "rounded-2xl rounded-tr-none p-3 shadow-md inline-block text-left",
          isBot ? "bg-blue-600" : "bg-emerald-600"
        )}
      >
        <p className="text-sm font-geist text-white">{m.text}</p>
      </div>
      <div className="flex items-center justify-end gap-1.5 mt-1">
        <span
          className={cn(
            "text-[10px] font-bold uppercase",
            isBot ? "text-blue-500" : "text-emerald-600"
          )}
        >
          {isBot ? "ИИ AITOCRM" : "Менеджер"} • {timeStr}
        </span>
        <IconCheckCheck
          className={cn("h-3 w-3 shrink-0", isBot ? "text-blue-500" : "text-emerald-600")}
        />
      </div>
    </div>
  );
});

// ─── Composer ─────────────────────────────────────────────────────────────────

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
    <div className="p-4 bg-white border-t border-zinc-100 shrink-0">
      <div className="flex items-center gap-2 bg-zinc-50 rounded-2xl p-2 border border-zinc-200">
        <button
          className="p-2 text-zinc-400 hover:text-zinc-600 transition shrink-0"
          title="Прикрепить файл"
          type="button"
        >
          <IconPaperclip className="h-5 w-5" />
        </button>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={1}
          placeholder="Написать сообщение..."
          className="flex-1 bg-transparent border-none outline-none text-sm p-2 resize-none leading-5"
          style={{ minHeight: "20px", maxHeight: "120px" }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button
          onClick={handleSend}
          disabled={sending || !draft.trim()}
          type="button"
          className="h-10 w-10 rounded-xl bg-green-400 text-zinc-950 flex items-center justify-center hover:brightness-95 transition disabled:opacity-50 shrink-0"
          title="Отправить"
        >
          <IconSend className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

// ─── PageInner ────────────────────────────────────────────────────────────────

function PageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const selectedChatId = sp.get("chat");

  // Sidebar list ref + per-tab scroll position
  const sidebarListRef = useRef<HTMLDivElement | null>(null);
  const tabScrollRef = useRef<Record<string, number>>({});

  // Active tab
  const [activeTab, setActiveTab] = useState<ChatStatus>("BOT");

  // Search
  const [searchQuery, setSearchQuery] = useState("");

  // Filters per status
  const [filters, setFilters] = useState<
    Record<
      ChatStatus,
      { sortOrder: SortOrder; unreadOnly: boolean; priceSort: "" | "asc" | "desc" }
    >
  >({
    BOT: { sortOrder: "desc", unreadOnly: false, priceSort: "" },
    MANAGER: { sortOrder: "desc", unreadOnly: false, priceSort: "" },
    INACTIVE: { sortOrder: "desc", unreadOnly: false, priceSort: "" },
  });

  // Build query strings
  const qsBOT = useMemo(() => {
    const f = filters.BOT;
    const u = new URLSearchParams();
    u.set("status", "BOT");
    if (f.priceSort) {
      u.set("sortField", "price");
      u.set("sortOrder", f.priceSort);
    } else {
      u.set("sortField", "lastMessageAt");
      u.set("sortOrder", f.sortOrder);
    }
    u.set("limit", "5000");
    if (f.unreadOnly) u.set("unreadOnly", "1");
    return u.toString();
  }, [filters.BOT]);

  const qsMAN = useMemo(() => {
    const f = filters.MANAGER;
    const u = new URLSearchParams();
    u.set("status", "MANAGER");
    if (f.priceSort) {
      u.set("sortField", "price");
      u.set("sortOrder", f.priceSort);
    } else {
      u.set("sortField", "lastMessageAt");
      u.set("sortOrder", f.sortOrder);
    }
    u.set("limit", "5000");
    if (f.unreadOnly) u.set("unreadOnly", "1");
    return u.toString();
  }, [filters.MANAGER]);

  const qsINACTIVE = useMemo(() => {
    const f = filters.INACTIVE;
    const u = new URLSearchParams();
    u.set("status", "INACTIVE");
    if (f.priceSort) {
      u.set("sortField", "price");
      u.set("sortOrder", f.priceSort);
    } else {
      u.set("sortField", "lastMessageAt");
      u.set("sortOrder", f.sortOrder);
    }
    u.set("limit", "5000");
    return u.toString();
  }, [filters.INACTIVE]);

  const [rtConnected, setRtConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshedChatsRef = useRef<Set<string>>(new Set());
  const selectedChatCacheRef = useRef<Record<string, ChatItem>>({});

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

  const { data: inactiveData, mutate: mutateINACTIVE } = useSWR<any>(
    `/api/chats?${qsINACTIVE}`,
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
  const inactiveChats: ChatItem[] = useMemo(
    () => (inactiveData?.items ?? inactiveData?.chats ?? []) as ChatItem[],
    [inactiveData]
  );

  // Keep selected chat visible while "unread" filter is active
  const botChatsUI: ChatItem[] = useMemo(() => {
    const base = botChats;
    if (!filters.BOT.unreadOnly) return base;
    if (!selectedChatId) return base;
    const cached = selectedChatCacheRef.current[selectedChatId];
    if (!cached || cached.status !== "BOT") return base;
    if (base.some((c) => c.id === cached.id)) return base;
    return [cached, ...base];
  }, [botChats, filters.BOT.unreadOnly, selectedChatId]);

  const manChatsUI: ChatItem[] = useMemo(() => {
    const base = manChats;
    if (!filters.MANAGER.unreadOnly) return base;
    if (!selectedChatId) return base;
    const cached = selectedChatCacheRef.current[selectedChatId];
    if (!cached || cached.status !== "MANAGER") return base;
    if (base.some((c) => c.id === cached.id)) return base;
    return [cached, ...base];
  }, [manChats, filters.MANAGER.unreadOnly, selectedChatId]);

  const selectedChat: ChatItem | null = useMemo(() => {
    if (!selectedChatId) return null;
    return (
      botChatsUI.find((c) => c.id === selectedChatId) ??
      manChatsUI.find((c) => c.id === selectedChatId) ??
      inactiveChats.find((c) => c.id === selectedChatId) ??
      selectedChatCacheRef.current[selectedChatId] ??
      null
    );
  }, [botChatsUI, manChatsUI, inactiveChats, selectedChatId]);

  // Keep snapshot of selected chat
  useEffect(() => {
    if (!selectedChat) return;
    selectedChatCacheRef.current[selectedChat.id] = {
      ...selectedChatCacheRef.current[selectedChat.id],
      ...selectedChat,
    };
  }, [selectedChat]);

  // Auto-switch tab when selected chat's status differs
  useEffect(() => {
    if (!selectedChat) return;
    if (selectedChat.status !== activeTab) {
      setActiveTab(selectedChat.status);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChatId]);

  // Tab switching with scroll preservation
  const handleTabChange = useCallback(
    (tab: ChatStatus) => {
      const el = sidebarListRef.current;
      if (el) {
        tabScrollRef.current[activeTab] = el.scrollTop;
      }
      setActiveTab(tab);
    },
    [activeTab]
  );

  // Restore scroll position when tab changes
  useLayoutEffect(() => {
    const el = sidebarListRef.current;
    if (!el) return;
    const saved = tabScrollRef.current[activeTab] ?? 0;
    el.scrollTop = saved;
  }, [activeTab]);

  // Active chats for current tab, filtered by search
  const rawActiveChats =
    activeTab === "BOT" ? botChatsUI : activeTab === "MANAGER" ? manChatsUI : inactiveChats;

  const activeChats = useMemo(() => {
    if (!searchQuery.trim()) return rawActiveChats;
    const q = searchQuery.toLowerCase();
    return rawActiveChats.filter(
      (c) =>
        (c.customerName ?? "").toLowerCase().includes(q) ||
        (c.itemTitle ?? "").toLowerCase().includes(q)
    );
  }, [rawActiveChats, searchQuery]);

  // Messages
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

  // Scroll management
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

  // Audio notification
  const notifAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
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

  // SSE – global (chat list updates)
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

    const applyChatSnapshot = (snapshot: ChatItem) => {
      selectedChatCacheRef.current[snapshot.id] = {
        ...selectedChatCacheRef.current[snapshot.id],
        ...snapshot,
      };

      const allMutators = { BOT: mutateBOT, MANAGER: mutateMAN, INACTIVE: mutateINACTIVE };
      const mutator = allMutators[snapshot.status];
      const otherMutators = Object.entries(allMutators)
        .filter(([k]) => k !== snapshot.status)
        .map(([, v]) => v);

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
            next = [snapshot, ...items];
          }
          return { ...cur, items: next };
        },
        { revalidate: false }
      );

      for (const otherMutator of otherMutators) {
        otherMutator(
          (cur: any) => {
            if (!cur) return cur;
            const items: ChatItem[] = (cur.items ?? []) as ChatItem[];
            const idx = items.findIndex((c) => c.id === snapshot.id);
            if (idx >= 0) {
              return { ...cur, items: items.filter((c) => c.id !== snapshot.id) };
            }
            return cur;
          },
          { revalidate: false }
        );
      }
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

      if (data.chatSnapshot) {
        applyChatSnapshot(data.chatSnapshot);
      } else {
        pending.lists = true;
        scheduleFlush();
      }
    };

    const onNewIncoming = (ev: MessageEvent) => {
      let data: RealtimeEvent | null = null;
      try {
        data = JSON.parse(ev.data) as RealtimeEvent;
      } catch {
        return;
      }
      if (!data || data.type !== "new_incoming") return;

      notifAudioRef.current?.play?.()?.catch?.(() => {});

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
      } catch {}
    };
  }, [mutateBOT, mutateMAN, mutateINACTIVE]);

  // SSE – chat-scoped (message_created)
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
      } catch {}
      try {
        es.close();
      } catch {}
    };
  }, [selectedChatId, mutateMsgs]);

  // Refresh history once if server suggests
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

    selectedChatCacheRef.current[chatId] = {
      ...selectedChatCacheRef.current[chatId],
      unreadCount: 0,
    };

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

  // Webhook subscription
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

  const selectChat = useCallback(
    async (id: string) => {
      const u = new URL(window.location.href);
      u.searchParams.set("chat", id);
      router.replace(u.pathname + "?" + u.searchParams.toString());
    },
    [router]
  );

  const togglePin = useCallback(
    async (chat: ChatItem) => {
      await apiFetch(`/api/chats/${chat.id}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !chat.pinned }),
      });
      await Promise.all([mutateBOT(), mutateMAN()]);
    },
    [mutateBOT, mutateMAN]
  );

  const finishDialog = useCallback(
    async (chat: ChatItem) => {
      await apiFetch(`/api/chats/${chat.id}/finish`, { method: "POST" });
      await Promise.all([mutateBOT(), mutateMAN()]);
    },
    [mutateBOT, mutateMAN]
  );

  const reactivateChat = useCallback(
    async (chat: ChatItem) => {
      await apiFetch(`/api/chats/${chat.id}/reactivate`, { method: "POST" });
      await Promise.all([mutateBOT(), mutateMAN(), mutateINACTIVE()]);
    },
    [mutateBOT, mutateMAN, mutateINACTIVE]
  );

  const sendMessage = useCallback(
    async (text: string) => {
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
    },
    [selectedChatId, mutateMsgs, mutateBOT, mutateMAN]
  );

  // Total unread counts per tab (for badge display)
  const botUnread = useMemo(() => botChatsUI.reduce((s, c) => s + (c.unreadCount ?? 0), 0), [botChatsUI]);
  const manUnread = useMemo(() => manChatsUI.reduce((s, c) => s + (c.unreadCount ?? 0), 0), [manChatsUI]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="h-screen p-5 bg-cover bg-center"
      style={{
        backgroundImage:
          "url('https://hoirqrkdgbmvpwutwuwj.supabase.co/storage/v1/object/public/assets/assets/8e249747-11d9-4c29-9017-590f07779c2e_3840w.jpg')",
        backgroundColor: "#e4e4e7",
      }}
    >
      <div className="h-full overflow-hidden shadow-2xl max-w-7xl bg-white rounded-[30px] mx-auto flex flex-col">

        {/* ── Header ── */}
        <header className="border-b border-zinc-100 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 flex bg-green-400 rounded-full items-center justify-center shrink-0">
              <IconSparkles className="h-4 w-4 text-zinc-900" />
            </div>
            <span className="text-lg tracking-tight font-medium font-geist">AITOCRM</span>

            {/* RT status dot */}
            <span
              className={cn(
                "text-[10px] px-2 py-0.5 rounded-full font-medium font-geist",
                rtConnected
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-zinc-100 text-zinc-500"
              )}
            >
              {rtConnected ? "● RT" : "○ RT"}
            </span>

            {IS_MOCK && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium font-geist">
                MOCK
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* AI status */}
            {webhookDiag && (
              <span
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full font-medium font-geist",
                  webhookDiag.aiConfigured
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-rose-100 text-rose-700"
                )}
              >
                {webhookDiag.aiConfigured ? "AI ON" : "AI OFF"}
              </span>
            )}

            {/* Webhook toggle */}
            {!IS_MOCK && (
              <button
                onClick={toggleWebhookSubscription}
                disabled={webhookLoading}
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full font-medium transition font-geist",
                  webhookSubscribed
                    ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                    : "bg-amber-100 text-amber-700 hover:bg-amber-200",
                  webhookLoading && "opacity-50 pointer-events-none"
                )}
                title={
                  webhookSubscribed
                    ? "Вебхук активен. Нажмите чтобы отключить."
                    : "Вебхук не подключён. Нажмите чтобы подключить."
                }
              >
                {webhookSubscribed ? "Webhook ON" : "Webhook OFF"}
              </button>
            )}

            {/* Diagnostics toggle */}
            {webhookDiag && !webhookDiag.healthy && (
              <button
                onClick={() => setShowDiag((v) => !v)}
                className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-medium hover:bg-rose-200 transition font-geist"
              >
                {webhookDiag.issues?.length ?? 0} проблем
              </button>
            )}

            <a
              href="/dashboard"
              className="px-3 py-1.5 text-xs font-medium rounded-full bg-zinc-100 hover:bg-zinc-200 transition font-geist"
            >
              Кабинет
            </a>
            <a
              href="/ai-assistant"
              className="px-3 py-1.5 text-xs font-medium rounded-full bg-zinc-950 text-white hover:bg-zinc-800 transition font-geist"
            >
              AI Ассистент
            </a>
          </div>
        </header>

        {/* ── Diagnostics / error banners ── */}
        {(showDiag && (webhookDiag?.issues?.length ?? 0) > 0) || webhookError ? (
          <div className="px-6 pb-3 shrink-0 space-y-2">
            {showDiag && (webhookDiag?.issues?.length ?? 0) > 0 && (
              <div className="rounded-2xl bg-rose-50 border border-rose-200 p-3 space-y-1">
                <div className="text-xs font-semibold text-rose-900">Диагностика конфигурации:</div>
                {webhookDiag.issues.map((issue: string, i: number) => (
                  <div key={i} className="text-xs text-rose-800">
                    • {issue}
                  </div>
                ))}
              </div>
            )}
            {webhookError && (
              <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3 flex items-center justify-between">
                <div className="text-xs text-amber-900">{webhookError}</div>
                <button
                  onClick={() => setWebhookError(null)}
                  className="text-xs text-amber-700 hover:text-amber-900 ml-2"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        ) : null}

        {/* ── Body ── */}
        <div className="flex-1 flex overflow-hidden p-2 gap-2 min-h-0">

          {/* ── Left sidebar: chat list ── */}
          <aside className="w-80 shrink-0 flex flex-col gap-3 bg-zinc-50 rounded-[24px] border border-zinc-200/50 p-4">

            {/* Tab switcher */}
            <div className="flex items-center gap-1 p-1 bg-zinc-100 rounded-2xl shrink-0">
              {(["BOT", "MANAGER", "INACTIVE"] as ChatStatus[]).map((tab) => {
                const label =
                  tab === "BOT"
                    ? "ИИ отвечает"
                    : tab === "MANAGER"
                      ? "Менеджер"
                      : "Неактивные";
                const unread = tab === "BOT" ? botUnread : tab === "MANAGER" ? manUnread : 0;
                return (
                  <button
                    key={tab}
                    onClick={() => handleTabChange(tab)}
                    className={cn(
                      "flex-1 py-2 text-xs rounded-xl transition font-geist relative",
                      activeTab === tab
                        ? "bg-white shadow-sm font-semibold"
                        : "font-medium text-zinc-500 hover:text-zinc-700"
                    )}
                  >
                    {label}
                    {unread > 0 && (
                      <span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-rose-500 text-white text-[9px] font-bold px-1">
                        {unread}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Search */}
            <div className="relative shrink-0">
              <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск сделки..."
                className="w-full pl-9 pr-4 py-2 bg-white border border-zinc-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-zinc-200 font-geist"
              />
            </div>

            {/* Sort controls */}
            <div className="flex items-center gap-1 flex-wrap shrink-0">
              <button
                onClick={() =>
                  setFilters((p) => ({
                    ...p,
                    [activeTab]: {
                      ...p[activeTab],
                      sortOrder: p[activeTab].sortOrder === "desc" ? "asc" : "desc",
                      priceSort: "",
                    },
                  }))
                }
                className="text-[10px] px-2 py-1 rounded-lg bg-zinc-100 text-zinc-600 hover:bg-zinc-200 transition font-geist"
              >
                {filters[activeTab].sortOrder === "desc" ? "↓ Новые" : "↑ Старые"}
              </button>
              <button
                onClick={() =>
                  setFilters((p) => ({
                    ...p,
                    [activeTab]: {
                      ...p[activeTab],
                      priceSort: p[activeTab].priceSort === "desc" ? "" : "desc",
                    },
                  }))
                }
                className={cn(
                  "text-[10px] px-2 py-1 rounded-lg transition font-geist",
                  filters[activeTab].priceSort === "desc"
                    ? "bg-zinc-800 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                )}
              >
                ₽↓ Дороже
              </button>
              <button
                onClick={() =>
                  setFilters((p) => ({
                    ...p,
                    [activeTab]: {
                      ...p[activeTab],
                      priceSort: p[activeTab].priceSort === "asc" ? "" : "asc",
                    },
                  }))
                }
                className={cn(
                  "text-[10px] px-2 py-1 rounded-lg transition font-geist",
                  filters[activeTab].priceSort === "asc"
                    ? "bg-zinc-800 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                )}
              >
                ₽↑ Дешевле
              </button>
              {activeTab !== "INACTIVE" && (
                <button
                  onClick={() =>
                    setFilters((p) => ({
                      ...p,
                      [activeTab]: {
                        ...p[activeTab],
                        unreadOnly: !p[activeTab].unreadOnly,
                      },
                    }))
                  }
                  className={cn(
                    "text-[10px] px-2 py-1 rounded-lg transition font-geist",
                    filters[activeTab].unreadOnly
                      ? "bg-rose-500 text-white"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  )}
                >
                  Непрочит.
                </button>
              )}
            </div>

            {/* Chat cards list */}
            <div
              ref={sidebarListRef}
              className="flex-1 overflow-y-auto space-y-2 min-h-0 pr-0.5"
            >
              {activeChats.length === 0 ? (
                <div className="text-sm text-zinc-400 text-center py-10 font-geist">
                  {searchQuery ? "Ничего не найдено" : "Пусто"}
                </div>
              ) : (
                activeChats.map((chat) => (
                  <div key={chat.id} className="relative group">
                    <ChatCard
                      chat={chat}
                      selected={chat.id === selectedChatId}
                      onSelect={selectChat}
                      onTogglePin={activeTab === "MANAGER" ? togglePin : undefined}
                      showPin={activeTab === "MANAGER"}
                    />
                    {activeTab === "INACTIVE" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          reactivateChat(chat);
                        }}
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition text-[10px] px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 font-geist"
                      >
                        Реактивировать
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </aside>

          {/* ── Right: Chat window ── */}
          <main className="flex-1 flex flex-col bg-zinc-50 rounded-[24px] border border-zinc-200/50 overflow-hidden min-h-0 min-w-0">
            {!selectedChat ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center px-8">
                  <div className="h-16 w-16 bg-zinc-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <IconSparkles className="h-7 w-7 text-zinc-400" />
                  </div>
                  <div className="text-base font-bold text-zinc-900 font-geist">
                    Выберите чат
                  </div>
                  <div className="mt-2 text-sm text-zinc-500 font-geist">
                    Нажмите на чат слева, чтобы открыть переписку
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col h-full min-h-0">

                {/* Chat header */}
                <div className="px-6 py-4 bg-white border-b border-zinc-100 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-3 min-w-0 mr-4">
                    <div className="h-10 w-10 rounded-full bg-zinc-100 flex items-center justify-center font-bold text-zinc-500 text-sm shrink-0">
                      {(selectedChat.customerName ?? "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-sm font-bold font-geist truncate">
                        {selectedChat.customerName ?? "Клиент"}
                      </h2>
                      <p className="text-[11px] text-zinc-500 truncate">
                        {selectedChat.itemTitle ?? "Без названия"}{" "}
                        • {formatPrice(selectedChat.price)}
                        {selectedChat.adUrl && (
                          <>
                            {" • "}
                            <a
                              href={selectedChat.adUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sky-600 hover:text-sky-700"
                            >
                              объявление
                            </a>
                          </>
                        )}
                        {selectedChat.chatUrl && (
                          <>
                            {" • "}
                            <a
                              href={selectedChat.chatUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sky-600 hover:text-sky-700"
                            >
                              чат Avito
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    {selectedChat.unreadCount > 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-bold font-geist">
                        {selectedChat.unreadCount} непроч.
                      </span>
                    )}

                    {selectedChat.status === "MANAGER" && (
                      <button
                        onClick={() => finishDialog(selectedChat)}
                        className="px-3 py-1.5 text-[11px] font-medium rounded-lg border border-zinc-200 hover:bg-zinc-50 font-geist transition"
                      >
                        Завершить диалог
                      </button>
                    )}

                    {selectedChat.status === "INACTIVE" && (
                      <button
                        onClick={() => reactivateChat(selectedChat)}
                        className="px-3 py-1.5 text-[11px] font-medium rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 font-geist transition"
                      >
                        Реактивировать
                      </button>
                    )}

                    <button
                      onClick={() => {
                        const u = new URL(window.location.href);
                        u.searchParams.delete("chat");
                        router.replace(u.pathname + (u.search || ""));
                      }}
                      className="px-3 py-1.5 text-[11px] font-medium rounded-lg bg-zinc-100 text-zinc-600 hover:bg-zinc-200 font-geist transition"
                    >
                      Закрыть
                    </button>
                  </div>
                </div>

                {/* Messages */}
                <div
                  ref={messagesRef}
                  onScroll={handleScroll}
                  className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0"
                >
                  {refreshing && (
                    <div className="flex justify-center mb-2">
                      <span className="text-[10px] text-zinc-400 bg-zinc-100 px-3 py-1 rounded-full font-geist">
                        Загружаю историю из Avito…
                      </span>
                    </div>
                  )}

                  {msgItems.length === 0 && !refreshing && (
                    <div className="flex justify-center pt-8">
                      <span className="text-sm text-zinc-400 font-geist">
                        Сообщений пока нет
                      </span>
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
                        <MessageBubble
                          m={m}
                          chatStatus={selectedChat.status}
                          customerName={selectedChat.customerName}
                        />
                      </React.Fragment>
                    );
                  })}

                  {showJump && (
                    <div className="sticky bottom-3 flex justify-end">
                      <button
                        onClick={() => {
                          scrollToBottom("smooth");
                          setShowJump(false);
                        }}
                        className="px-3 py-1.5 text-xs font-medium rounded-xl bg-zinc-900 text-white shadow-sm hover:bg-zinc-800 transition font-geist"
                      >
                        Вниз ↓
                      </button>
                    </div>
                  )}
                </div>

                {/* Composer */}
                <Composer onSend={sendMessage} sending={sending} />
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

// ─── Page export ──────────────────────────────────────────────────────────────

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center text-zinc-500 font-geist">
          Загрузка…
        </div>
      }
    >
      <PageInner />
    </Suspense>
  );
}
