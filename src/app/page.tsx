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

type LabelColor = "YELLOW" | "RED" | "BLUE" | "GREEN";
type LabelFilter = "" | "NONE" | LabelColor;

type ChatItem = {
  id: string;
  avitoChatId?: string | null;
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
  manualUnread?: boolean;
  pinned: boolean;
  followupSentAt?: string | null;

  // Метка (цвет)
  labelColor?: LabelColor | null;
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

const PHOTO_PLACEHOLDER = "📷 Фото";

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
  if (v === null || v === undefined) return "Цены нет :(";
  return `${new Intl.NumberFormat("ru-RU").format(v)} ₽`;
}

const LABEL_ORDER: LabelColor[] = ["RED", "YELLOW", "BLUE", "GREEN"];

const LABEL_META: Record<LabelColor, { name: string; emoji: string; dot: string; ring: string }> = {
  RED: { name: "Красный", emoji: "🟥", dot: "bg-rose-500", ring: "ring-rose-700/30" },
  YELLOW: { name: "Жёлтый", emoji: "🟨", dot: "bg-amber-400", ring: "ring-amber-600/30" },
  BLUE: { name: "Синий", emoji: "🟦", dot: "bg-sky-500", ring: "ring-sky-700/30" },
  GREEN: { name: "Зелёный", emoji: "🟩", dot: "bg-emerald-500", ring: "ring-emerald-700/30" },
};

function labelName(v: LabelColor | null | undefined) {
  if (!v) return "Без метки";
  return LABEL_META[v].name;
}

function labelEmoji(v: LabelColor | null | undefined) {
  if (!v) return "⬜";
  return LABEL_META[v].emoji;
}

function labelRank(v: LabelColor | null | undefined): number {
  if (!v) return 99;
  const idx = LABEL_ORDER.indexOf(v);
  return idx >= 0 ? idx : 99;
}

function applyLabelView(
  chats: ChatItem[],
  labelFilter: LabelFilter,
  labelSort: boolean,
  sortOrder: SortOrder
): ChatItem[] {
  let out = chats;

  if (labelFilter) {
    if (labelFilter === "NONE") out = out.filter((c) => !c.labelColor);
    else out = out.filter((c) => c.labelColor === labelFilter);
  }

  if (labelSort) {
    const dir = sortOrder === "desc" ? -1 : 1;
    out = [...out].sort((a, b) => {
      const ap = a.pinned ? 0 : 1;
      const bp = b.pinned ? 0 : 1;
      if (ap !== bp) return ap - bp;

      const at = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
      const bt = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
      if (at !== bt) return (at - bt) * dir;

      // last resort (stable-ish)
      return a.id.localeCompare(b.id);
    });
  }

  return out;
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
    <span className="inline-flex items-center rounded-full bg-rose-600/20 px-2 py-0.5 text-xs font-semibold text-rose-950 ring-1 ring-rose-700/30">
      {children}
    </span>
  );
}

function SmallDangerBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-rose-600/25 px-1.5 py-0.5 text-[11px] font-semibold text-rose-950 ring-1 ring-rose-700/35">
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
    "inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-sky-500/25 disabled:opacity-50 disabled:pointer-events-none";
  const styles =
    variant === "danger"
      ? "bg-rose-600/10 text-rose-800 ring-1 ring-rose-700/20 hover:bg-rose-600/15"
      : variant === "ghost"
        ? "bg-transparent text-zinc-700 hover:bg-zinc-900/5 ring-1 ring-zinc-900/10"
        : "bg-zinc-200/70 text-zinc-800 hover:bg-zinc-200/85 ring-1 ring-zinc-900/10 shadow-sm";
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

function LinkButton({
  href,
  children,
  className,
  title,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  const base =
    "inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-sky-500/25";
  const styles = "bg-zinc-200/70 text-zinc-800 hover:bg-zinc-200/85 ring-1 ring-zinc-900/10 shadow-sm";
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      className={cn(base, styles, className)}
    >
      {children}
    </a>
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
    <div className="inline-flex rounded-xl bg-zinc-900/5 ring-1 ring-zinc-900/10 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-lg transition",
            value === o.value
              ? "bg-zinc-200/80 text-zinc-900 shadow-sm ring-1 ring-zinc-900/10"
              : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}


function MobileTabs({
  value,
  onChange,
  items,
}: {
  value: ChatStatus;
  onChange: (v: ChatStatus) => void;
  items: Array<{ value: ChatStatus; label: string; count: number; unread: number }>;
}) {
  return (
    <div className="lg:hidden rounded-2xl bg-zinc-200/70 ring-1 ring-zinc-900/10 p-1 flex gap-1">
      {items.map((it) => {
        const active = value === it.value;
        return (
          <button
            key={it.value}
            onClick={() => onChange(it.value)}
            className={cn(
              "flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold transition",
              active
                ? "bg-zinc-100/80 text-zinc-900 shadow-sm ring-1 ring-zinc-900/10"
                : "text-zinc-700 hover:bg-zinc-100/60"
            )}
            title={it.label}
          >
            <span className="truncate">{it.label}</span>
            <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ring-1 bg-zinc-900/5 text-zinc-800 ring-zinc-900/10">
              {it.count}
            </span>
            {it.unread > 0 && (
              <span
                className="inline-flex h-2 w-2 rounded-full bg-rose-600 ring-1 ring-rose-700/30"
                aria-label="Есть непрочитанные"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function DateDivider({ label }: { label: string }) {
  return (
    <div className="my-2 flex items-center gap-3">
      <div className="h-px flex-1 bg-zinc-900/10" />
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="h-px flex-1 bg-zinc-900/10" />
    </div>
  );
}

function UnreadDivider() {
  return (
    <div className="my-2 flex items-center gap-3">
      <div className="h-px flex-1 bg-zinc-900/10" />
      <div className="text-[11px] text-rose-700">Непрочитанные</div>
      <div className="h-px flex-1 bg-zinc-900/10" />
    </div>
  );
}

const ChatCard = React.memo(function ChatCard({
  chat,
  selected,
  onSelect,
  onTogglePin,
  onEscalate,
  onSetLabel,
  showPin,
}: {
  chat: ChatItem;
  selected: boolean;
  onSelect: (id: string) => void;
  onTogglePin?: (chat: ChatItem) => void;
  onEscalate?: (chat: ChatItem) => void;
  onSetLabel?: (chat: ChatItem, labelColor: LabelColor | null) => void;
  showPin: boolean;
}) {
  const title = chat.itemTitle ?? "Без названия";
  const name = chat.customerName ?? "Клиент";
  const time = formatTime(chat.lastMessageAt);
  const snippet = chat.lastMessageText ?? "";
  const priceLabel = formatPrice(chat.price ?? null);

  const isUnread = (chat.unreadCount ?? 0) > 0 || Boolean(chat.manualUnread);

  const handleSelect = useCallback(() => onSelect(chat.id), [onSelect, chat.id]);
  const handleTogglePin = useCallback(() => onTogglePin?.(chat), [onTogglePin, chat]);
  const handleEscalate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onEscalate?.(chat);
  }, [onEscalate, chat]);

  const handleCycleLabel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!onSetLabel) return;
    const order: Array<LabelColor | null> = [null, "RED", "YELLOW", "BLUE", "GREEN"];
    const cur = (chat.labelColor ?? null) as LabelColor | null;
    const idx = Math.max(0, order.indexOf(cur));
    const next = order[(idx + 1) % order.length];
    onSetLabel(chat, next);
  }, [onSetLabel, chat]);

  return (
    <div
      className={cn(
        "w-full rounded-2xl transition ring-1 relative",
        selected
          ? "bg-zinc-200/80 ring-sky-700/25 shadow-sm"
          : isUnread
            ? "bg-rose-50/80 hover:bg-rose-50/90 ring-rose-700/25 shadow-sm"
            : "bg-zinc-200/60 hover:bg-zinc-200/80 ring-zinc-900/10"
      )}
    >

      <div className="flex items-start gap-2 p-2">
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
            <div className="truncate text-[13px] font-semibold text-zinc-900">
              {title}
            </div>

            {/* ✅ цена */}
            <span className="inline-flex items-center rounded-full bg-zinc-900/5 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 ring-1 ring-zinc-900/10">
              {priceLabel}
            </span>

            <button
              onClick={handleCycleLabel}
              className="inline-flex items-center justify-center rounded-full bg-transparent p-1 ring-1 ring-zinc-900/10 hover:bg-zinc-900/5 transition"
              title={`Метка: ${labelName(chat.labelColor ?? null)} (клик — сменить)`}
            >
              <span
                className={cn(
                  "inline-flex h-2.5 w-2.5 rounded-full ring-1",
                  chat.labelColor ? LABEL_META[chat.labelColor].dot : "bg-zinc-400/40",
                  chat.labelColor ? LABEL_META[chat.labelColor].ring : "ring-zinc-900/10"
                )}
              />
            </button>

            {chat.status === "BOT" && onEscalate && (

              <button
                onClick={handleEscalate}
                className="inline-flex items-center rounded-full bg-sky-600/10 px-1.5 py-0.5 text-[11px] font-semibold text-sky-800 ring-1 ring-sky-700/20 hover:opacity-80 transition"
                title="Перевести чат на менеджера и отключить бота"
              >
                <span className="hidden sm:inline">⮕</span>
                <span className="sm:hidden">→ Менеджеру</span>
              </button>
            )}

            {chat.pinned && showPin && <Badge>PIN</Badge>}
          </div>

          <div className="mt-0.5 flex items-center justify-between gap-2">
            <div className="truncate text-[11px] text-zinc-600">{name}</div>

            <div className="shrink-0 flex items-center gap-2">
              <div className="text-[11px] text-zinc-600">{time}</div>
              {(chat.unreadCount > 0 || Boolean(chat.manualUnread)) && (
                <SmallDangerBadge>
                  {chat.unreadCount > 0 ? `${chat.unreadCount} непроч.` : "непроч."}
                </SmallDangerBadge>
              )}
            </div>
          </div>

          <div className="mt-1 line-clamp-1 text-[11px] text-zinc-700">
            {snippet}
          </div>
        </div>

        {showPin && (
          <div className="shrink-0">
            <Button
              variant="ghost"
              className="px-2 py-1 text-xs"
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

  const images: string[] = useMemo(() => {
    // Normalize URLs so the same image isn't rendered twice (e.g. relative "/api/uploads/..."
    // and absolute "https://host/api/uploads/..." for the same file).
    const normKey = (s: string) => {
      try {
        const u = new URL(s, "http://local");
        return `${u.pathname}${u.search}`;
      } catch {
        return s;
      }
    };

    const out: string[] = [];
    const seen = new Map<string, string>();
    const isAbs = (s: string) => /^https?:\/\//i.test(s);

    const push = (v: any) => {
      if (typeof v !== "string") return;
      const s0 = v.trim();
      if (!s0) return;
      const key = normKey(s0);

      const prev = seen.get(key);
      if (!prev) {
        seen.set(key, s0);
        out.push(s0);
        return;
      }

      // Prefer absolute URL over relative if both point to the same path.
      if (!isAbs(prev) && isAbs(s0)) {
        seen.set(key, s0);
        const idx = out.indexOf(prev);
        if (idx >= 0) out[idx] = s0;
      }
    };

    const raw = (m as any)?.raw ?? {};

    // Outgoing from CRM (/send): raw.attachment can contain both publicUrl and url for the same file.
    // Render only one canonical image.
    const att = raw?.attachment;
    if (att && (att.publicUrl || att.url)) {
      push(att.publicUrl || att.url);
    } else {
      // Incoming (webhook/refresh): crm attachments
      const crmImgs = raw?.crm?.attachments?.images;
      if (Array.isArray(crmImgs)) crmImgs.forEach(push);
    }

    // defensive: sometimes attachments are nested differently
    const atts = raw?.attachments;
    if (Array.isArray(atts)) {
      for (const it of atts) {
        if (typeof it === "string") push(it);
        else if (it && typeof it === "object") push((it as any).url);
      }
    }

    return out;
  }, [m]);

  const textTrim = String(m.text ?? "").trim();
  const showText = Boolean(textTrim) && textTrim !== PHOTO_PLACEHOLDER;

  return (
    <div className={cn("flex", isIn ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-3 py-2 ring-1 shadow-sm",
          isIn
            ? "bg-zinc-200/75 text-zinc-900 ring-zinc-900/10"
            : isBot
              ? "bg-sky-600/10 text-sky-900 ring-sky-700/20"
              : "bg-emerald-600/10 text-emerald-900 ring-emerald-700/20",
          isUnread ? "ring-rose-600/30" : ""
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="text-[11px] font-semibold text-zinc-700">
              {label}
            </div>
            {isUnread && (
              <span className="inline-flex items-center rounded-full bg-rose-600/10 px-2 py-0.5 text-[10px] font-medium text-rose-800 ring-1 ring-rose-700/20">
                непроч.
              </span>
            )}
          </div>

          <div className="text-[11px] text-zinc-500">
            {new Date(ts).toLocaleString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>

        {images.length > 0 && (
          <div className="mt-2">
            <a
              href={images[0]}
              target="_blank"
              rel="noreferrer"
              title="Открыть изображение"
              className="block"
            >
              <img
                src={images[0]}
                alt="attachment"
                className="max-h-[360px] w-full max-w-full rounded-xl object-cover ring-1 ring-zinc-900/10"
              />
            </a>
            {isIn && images.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {images.slice(1, 5).map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer" className="block">
                    <img
                      src={u}
                      alt="attachment"
                      className="h-16 w-16 rounded-lg object-cover ring-1 ring-zinc-900/10"
                    />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {showText && (
          <div
            className={cn(
              "mt-2 whitespace-pre-wrap text-sm leading-relaxed",
              isUnread ? "font-semibold" : ""
            )}
          >
            {m.text}
          </div>
        )}
      </div>
    </div>
  );
});


function ColumnHeader({
  title,
  subtitle,
  countLabel,
  sortOrder,
  unreadOnly,
  priceSort,
  labelFilter,
  showUnreadFilter,
  setSortOrder,
  setUnreadOnly,
  setPriceSort,
  setLabelFilter,
}: {
  title: string;
  subtitle: string;
  countLabel: string;
  sortOrder: SortOrder;
  unreadOnly: boolean;
  priceSort: "" | "asc" | "desc";
  labelFilter: LabelFilter;
  showUnreadFilter?: boolean;
  setSortOrder: (v: SortOrder) => void;
  setUnreadOnly: (v: boolean) => void;
  setPriceSort: (v: "" | "asc" | "desc") => void;
  setLabelFilter: (v: LabelFilter) => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);

  return (
    <div className="z-10 bg-zinc-200/70 backdrop-blur border-b border-zinc-900/10">
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-bold text-zinc-900">{title}</div>
              <span className="inline-flex items-center rounded-full bg-zinc-900/5 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 ring-1 ring-zinc-900/10">
                {countLabel}
              </span>
            </div>
            <div className="text-xs text-zinc-500">{subtitle}</div>
          </div>

          <button
            className="lg:hidden inline-flex items-center rounded-xl bg-zinc-100/80 px-2 py-1 text-[11px] font-semibold text-zinc-700 ring-1 ring-zinc-900/10 hover:bg-zinc-100/90 transition"
            onClick={() => setFiltersOpen((v) => !v)}
            title="Показать/скрыть фильтры"
          >
            {filtersOpen ? "Скрыть" : "Фильтры"}
          </button>
        </div>

        <div className={cn("mt-2", filtersOpen ? "block" : "hidden", "lg:block")}>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={sortOrder}
              onChange={(v) => setSortOrder(v as SortOrder)}
              options={[
                { value: "desc", label: "Сначала новые" },
                { value: "asc", label: "Сначала старые" },
              ]}
            />
            {showUnreadFilter !== false && (
              <Segmented
                value={unreadOnly ? "unread" : "all"}
                onChange={(v) => setUnreadOnly(v === "unread")}
                options={[
                  { value: "all", label: "Все" },
                  { value: "unread", label: "Непроч." },
                ]}
              />
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-500 shrink-0">Метка:</span>
              <select
                value={labelFilter}
                onChange={(e) => setLabelFilter(e.target.value as LabelFilter)}
                className="rounded-xl bg-zinc-100/80 ring-1 ring-zinc-900/10 px-2 py-1 text-xs text-zinc-800 focus:outline-none focus:ring-2 focus:ring-sky-500/25"
              >
                <option value="">Все</option>
                <option value="NONE">⬜ Без метки</option>
                <option value="RED">🟥 Красный</option>
                <option value="YELLOW">🟨 Жёлтый</option>
                <option value="BLUE">🟦 Синий</option>
                <option value="GREEN">🟩 Зелёный</option>
              </select>
            </div>
          </div>

          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-[11px] text-zinc-500 shrink-0">Цена ₽:</span>
            <div className="inline-flex flex-wrap rounded-xl bg-zinc-900/5 ring-1 ring-zinc-900/10 p-1 gap-0.5">
              <button
                onClick={() => {
                  setPriceSort(priceSort === "desc" ? "" : "desc");
                }}
                className={cn(
                  "px-2 py-1 text-xs font-medium rounded-lg transition",
                  priceSort === "desc"
                    ? "bg-zinc-200/80 text-zinc-900 shadow-sm ring-1 ring-zinc-900/10"
                    : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50"
                )}
              >
                Сначала дороже
              </button>
              <button
                onClick={() => {
                  setPriceSort(priceSort === "asc" ? "" : "asc");
                }}
                className={cn(
                  "px-2 py-1 text-xs font-medium rounded-lg transition",
                  priceSort === "asc"
                    ? "bg-zinc-200/80 text-zinc-900 shadow-sm ring-1 ring-zinc-900/10"
                    : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50"
                )}
              >
                Сначала дешевле
              </button>
              {priceSort && (
                <button
                  onClick={() => {
                    setPriceSort("");
                  }}
                  className="px-2 py-1 text-xs font-medium rounded-lg transition text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/50"
                >
                  Сбросить
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Composer({
  onSend,
  sending,
}: {
  onSend: (payload: { text: string }) => void;
  sending: boolean;
}) {
  const [draft, setDraft] = useState("");

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (sending) return;
    if (!text) return;
    onSend({ text });
    setDraft("");
  }, [draft, sending, onSend]);

  return (
    <div className="shrink-0 border-t border-zinc-900/10 bg-zinc-200/70 backdrop-blur px-3 py-3 sm:px-5 sm:py-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <div className="flex gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Написать сообщение..."
          className="flex-1 resize-none rounded-2xl bg-zinc-100/90 ring-1 ring-zinc-900/10 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-sky-500/25"
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
    </div>
  );
}

function PageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const selectedChatId = sp.get("chat");

  // refs for chat list scroll position (to avoid jumping to top on SWR updates)
  const botListRef = useRef<HTMLDivElement | null>(null);
  const manListRef = useRef<HTMLDivElement | null>(null);
  const botListScrollTopRef = useRef(0);
  const manListScrollTopRef = useRef(0);

  const [filters, setFilters] = useState<
    Record<ChatStatus, { sortOrder: SortOrder; unreadOnly: boolean; priceSort: "" | "asc" | "desc"; labelFilter: LabelFilter }>
  >({
    BOT: { sortOrder: "desc", unreadOnly: false, priceSort: "", labelFilter: "" },
    MANAGER: { sortOrder: "desc", unreadOnly: false, priceSort: "", labelFilter: "" },
    INACTIVE: { sortOrder: "desc", unreadOnly: false, priceSort: "", labelFilter: "" },
  });

  const [mobileTab, setMobileTab] = useState<ChatStatus>("MANAGER");


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

  // Cache selected chat snapshot so the chat doesn't close when it drops out of a filtered list (e.g. "Непроч.")
  const selectedChatCacheRef = useRef<Record<string, ChatItem>>({});

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

  // If "Непроч." filter is enabled and we opened a chat, keep showing it in the list
  // even if it becomes read (otherwise UI closes the chat and list item disappears).
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

  const botChatsDisplay: ChatItem[] = useMemo(
    () =>
      applyLabelView(
        botChatsUI,
        filters.BOT.labelFilter,
        !filters.BOT.priceSort,
        filters.BOT.sortOrder
      ),
    [botChatsUI, filters.BOT.labelFilter, !filters.BOT.priceSort, filters.BOT.sortOrder]
  );

  const manChatsDisplay: ChatItem[] = useMemo(
    () =>
      applyLabelView(
        manChatsUI,
        filters.MANAGER.labelFilter,
        !filters.MANAGER.priceSort,
        filters.MANAGER.sortOrder
      ),
    [manChatsUI, filters.MANAGER.labelFilter, !filters.MANAGER.priceSort, filters.MANAGER.sortOrder]
  );

  const inactiveChatsDisplay: ChatItem[] = useMemo(
    () =>
      applyLabelView(
        inactiveChats,
        filters.INACTIVE.labelFilter,
        !filters.INACTIVE.priceSort,
        filters.INACTIVE.sortOrder
      ),
    [inactiveChats, filters.INACTIVE.labelFilter, !filters.INACTIVE.priceSort, filters.INACTIVE.sortOrder]
  );

const botUnreadCount = useMemo(
  () => botChatsDisplay.reduce((s, c) => s + ((c.unreadCount ?? 0) > 0 || c.manualUnread ? 1 : 0), 0),
  [botChatsDisplay]
);
const manUnreadCount = useMemo(
  () => manChatsDisplay.reduce((s, c) => s + ((c.unreadCount ?? 0) > 0 || c.manualUnread ? 1 : 0), 0),
  [manChatsDisplay]
);
const inactiveUnreadCount = useMemo(
  () => inactiveChatsDisplay.reduce((s, c) => s + ((c.unreadCount ?? 0) > 0 || c.manualUnread ? 1 : 0), 0),
  [inactiveChatsDisplay]
);

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

const selectedChatExternalUrl = useMemo(() => {
  if (!selectedChat) return null;
  if (selectedChat.chatUrl) return selectedChat.chatUrl;
  if (selectedChat.avitoChatId) {
    // Avito web messenger deep link (seen publicly as /profile/messenger/channel/<id>)
    return `https://www.avito.ru/profile/messenger/channel/${selectedChat.avitoChatId}`;
  }
  return null;
}, [selectedChat]);

  const clearSelectedChat = useCallback(() => {
    const u = new URL(window.location.href);
    u.searchParams.delete("chat");
    const qs = u.searchParams.toString();
    router.replace(u.pathname + (qs ? `?${qs}` : ""));
  }, [router]);


  // Keep latest snapshot of selected chat to survive filtering/unmounting.
  useEffect(() => {
    if (!selectedChat) return;
    selectedChatCacheRef.current[selectedChat.id] = {
      ...selectedChatCacheRef.current[selectedChat.id],
      ...selectedChat,
    };
  }, [selectedChat]);

  // Restore chat list scrollTop after list updates (prevents scrollbar jumping to top).
  const botListKey = useMemo(() => botChatsUI.map((c) => c.id).join("|"), [botChatsUI]);
  const manListKey = useMemo(() => manChatsUI.map((c) => c.id).join("|"), [manChatsUI]);

  useLayoutEffect(() => {
    const el = botListRef.current;
    if (!el) return;
    const t = botListScrollTopRef.current;
    if (Math.abs(el.scrollTop - t) > 2) el.scrollTop = t;
  }, [botListKey]);

  useLayoutEffect(() => {
    const el = manListRef.current;
    if (!el) return;
    const t = manListScrollTopRef.current;
    if (Math.abs(el.scrollTop - t) > 2) el.scrollTop = t;
  }, [manListKey]);

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
        await Promise.all([mutateBOT(), mutateMAN(), mutateINACTIVE()]).catch(() => null);
      }, 120);
    };

    /** Мгновенное обновление SWR-кэша списка чатов из chatSnapshot */
    const applyChatSnapshot = (snapshot: ChatItem) => {
      // Keep a local copy so selected chat can stay open even if filtered out.
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
            // Новый чат — добавляем в начало
            next = [snapshot, ...items];
          }
          return { ...cur, items: next };
        },
        { revalidate: false },
      );

      // Убираем из других списков (если статус сменился)
      for (const otherMutator of otherMutators) {
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
  }, [mutateBOT, mutateMAN, mutateINACTIVE]);

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
		const lastManualUnreadClearAtRef = useRef<Record<string, number>>({});
		// When user explicitly marks a chat as "manual unread", we must avoid any
		// automatic markRead() effects firing for the currently opened chat.
		// Otherwise the server-side /read handler may clear manualUnread immediately.
		const suppressReadUntilRef = useRef<Record<string, number>>({});
		// Tracks the case when the user clicks "Сделать непрочитанным" while the chat
		// is currently open. Without this, the "auto-clear manualUnread on open" effect
		// can race and immediately clear the flag (timing-dependent).
		const manualUnreadSetWhileOpenRef = useRef<Record<string, boolean>>({});
	// Tracks whether the chat was already manual-unread at the moment it was opened.
	// This prevents instantly clearing the manualUnread flag when the user sets it
	// while the chat is currently open.
	const openedChatMetaRef = useRef<{ id: string | null; manualUnreadOnOpen: boolean | null }>({
		id: null,
		manualUnreadOnOpen: null,
	});

	// If chat is opened via URL/back button (not through selectChat), reset capture meta.
	useEffect(() => {
		if (!selectedChatId) {
			openedChatMetaRef.current = { id: null, manualUnreadOnOpen: null };
				manualUnreadSetWhileOpenRef.current = {};
			return;
		}
		if (openedChatMetaRef.current.id !== selectedChatId) {
			openedChatMetaRef.current = { id: selectedChatId, manualUnreadOnOpen: null };
				manualUnreadSetWhileOpenRef.current[selectedChatId] = false;
		}
	}, [selectedChatId]);

  async function markRead(chatId: string) {
    const now = Date.now();
			const suppressUntil = suppressReadUntilRef.current[chatId] ?? 0;
			if (now < suppressUntil) return;
    const last = lastReadAtRef.current[chatId] ?? 0;
    if (now - last < 800) return;
    lastReadAtRef.current[chatId] = now;

    await apiFetch(`/api/chats/${chatId}/read`, { method: "POST" }).catch(() => null);

    // Prevent "unread" filter from closing the currently opened chat
    // and avoid re-triggering markRead on cached snapshot.
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


const clearManualUnread = useCallback(
  async (chat: ChatItem) => {
    await apiFetch(`/api/chats/${chat.id}/unread`, { method: "DELETE" });
    await Promise.all([mutateMAN(), mutateINACTIVE()]);
  },
  [mutateMAN, mutateINACTIVE]
);

	// Если чат был помечен вручную как непрочитанный *до открытия*, то при открытии
	// автоматически снимаем эту отметку (и тем самым чат становится "прочитанным").
	// Важно: если пользователь нажал "Сделать непрочитанным" прямо в открытом чате,
	// то manualUnread меняется уже после открытия — и мы НЕ должны тут же снимать отметку.
	useEffect(() => {
		if (!selectedChatId) return;
		if (!selectedChat) return;

		// Determine manualUnread state at the moment of opening (first snapshot).
		if (openedChatMetaRef.current.id !== selectedChatId) {
			openedChatMetaRef.current = { id: selectedChatId, manualUnreadOnOpen: null };
		}
		if (openedChatMetaRef.current.manualUnreadOnOpen === null) {
			openedChatMetaRef.current.manualUnreadOnOpen = Boolean(selectedChat.manualUnread);
		}
		if (!openedChatMetaRef.current.manualUnreadOnOpen) return;
		if (!selectedChat.manualUnread) return;
			if (manualUnreadSetWhileOpenRef.current[selectedChatId]) return;

		const now = Date.now();
		const last = lastManualUnreadClearAtRef.current[selectedChatId] ?? 0;
		if (now - last < 800) return;
		lastManualUnreadClearAtRef.current[selectedChatId] = now;

		(async () => {
			try {
				await clearManualUnread(selectedChat);
				// instant UI feedback for selected chat
				selectedChatCacheRef.current[selectedChatId] = {
					...selectedChatCacheRef.current[selectedChatId],
					manualUnread: false,
				};
				openedChatMetaRef.current.manualUnreadOnOpen = false;
				// При открытии чата также помечаем как прочитанный на стороне сервера
				// (на случай если есть непрочитанные сообщения без unreadCount).
				await markRead(selectedChatId).catch(() => null);
			} catch {
				// ignore
			}
		})();
	}, [selectedChatId, selectedChat?.manualUnread, clearManualUnread]);

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


const selectChat = useCallback(
  async (id: string) => {
			// If chat was previously protected from auto-read (after "Сделать непрочитанным"),
			// opening it again should allow normal read flow.
			delete suppressReadUntilRef.current[id];
			manualUnreadSetWhileOpenRef.current[id] = false;
    const found =
      botChatsUI.find((c) => c.id === id) ??
      manChatsUI.find((c) => c.id === id) ??
      inactiveChats.find((c) => c.id === id) ??
      null;

    if (found) {
			setMobileTab(found.status);
			// Capture the manualUnread state at the moment the chat is opened.
			openedChatMetaRef.current = {
				id,
				manualUnreadOnOpen: Boolean(found.manualUnread),
			};
		} else {
			openedChatMetaRef.current = { id, manualUnreadOnOpen: null };
		}

    const u = new URL(window.location.href);
    u.searchParams.set("chat", id);
    router.replace(u.pathname + "?" + u.searchParams.toString());
  },
  [router, botChatsUI, manChatsUI, inactiveChats]
);

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

  const reactivateChat = useCallback(async (chat: ChatItem) => {
    await apiFetch(`/api/chats/${chat.id}/reactivate`, { method: "POST" });
    await Promise.all([mutateBOT(), mutateMAN(), mutateINACTIVE()]);
  }, [mutateBOT, mutateMAN, mutateINACTIVE]);

const escalateChat = useCallback(
  async (chat: ChatItem) => {
    await apiFetch(`/api/chats/${chat.id}/escalate`, { method: "POST" });
    await Promise.all([mutateBOT(), mutateMAN(), mutateINACTIVE()]);
  },
  [mutateBOT, mutateMAN, mutateINACTIVE]
);

const markManualUnread = useCallback(
  async (chat: ChatItem) => {
			// Prevent any pending auto-markRead effects from racing and clearing manualUnread.
			suppressReadUntilRef.current[chat.id] = Date.now() + 5000;
    await apiFetch(`/api/chats/${chat.id}/unread`, { method: "POST" });
    await Promise.all([mutateMAN(), mutateINACTIVE()]);
  },
  [mutateMAN, mutateINACTIVE]
);



const patchChatInLists = useCallback(
  (id: string, patch: Partial<ChatItem>) => {
    const patcher = (cur: any) => {
      if (!cur) return cur;
      const key = Array.isArray(cur.items)
        ? "items"
        : Array.isArray(cur.chats)
          ? "chats"
          : null;
      if (!key) return cur;
      const arr = cur[key] as any[];
      const next = arr.map((c) => (c?.id === id ? { ...c, ...patch } : c));
      return { ...cur, [key]: next };
    };

    mutateBOT(patcher, { revalidate: false });
    mutateMAN(patcher, { revalidate: false });
    mutateINACTIVE(patcher, { revalidate: false });

    // keep selected chat stable even if it drops out of list
    if (selectedChatCacheRef.current[id]) {
      selectedChatCacheRef.current[id] = { ...selectedChatCacheRef.current[id], ...patch };
    }
  },
  [mutateBOT, mutateMAN, mutateINACTIVE]
);

const setChatLabel = useCallback(
  async (chat: ChatItem, labelColor: LabelColor | null) => {
    // optimistic
    patchChatInLists(chat.id, { labelColor });

    try {
      await apiFetch(`/api/chats/${chat.id}/label`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labelColor }),
      });
    } finally {
      // sync with server
      await Promise.all([mutateBOT(), mutateMAN(), mutateINACTIVE()]);
    }
  },
  [patchChatInLists, mutateBOT, mutateMAN, mutateINACTIVE]
);

const sendMessage = useCallback(
  async (payload: { text: string }) => {
    if (!selectedChatId) return;
    if (!payload.text) return;

    setSending(true);
    try {
      const resp: Response = await apiFetch(`/api/chats/${selectedChatId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: payload.text, markRead: true }),
      });

      const json = await resp.json().catch(() => null);

      const received: MessageItem[] = Array.isArray(json?.messages)
        ? (json.messages as MessageItem[])
        : json?.message
          ? [json.message as MessageItem]
          : [];

      if (received.length) {
        await mutateMsgs(
          (cur: any) => {
            const current = cur ?? { ok: true, refreshed: false, messages: [] };
            const arr: MessageItem[] = Array.isArray(current.messages)
              ? current.messages
              : Array.isArray(current.items)
                ? current.items
                : [];

            let next = arr.slice();
            for (const mm of received) {
              if (!mm?.id) continue;
              if (next.some((x) => x.id === mm.id)) continue;
              next.push(mm);
            }

            next = next.sort((a, b) => toMs(a) - toMs(b));
            if (Array.isArray(current.items)) return { ...current, items: next };
            return { ...current, messages: next };
          },
          { revalidate: false }
        );

        requestAnimationFrame(() => scrollToBottom("smooth"));
      }

      await Promise.all([mutateBOT(), mutateMAN(), mutateINACTIVE()]);
    } finally {
      setSending(false);
    }
  },
  [selectedChatId, mutateMsgs, mutateBOT, mutateMAN, mutateINACTIVE]
);


  return (
    <div className="min-h-screen h-[100dvh] overflow-hidden flex flex-col">
      {/* Top bar */}
      <div className="shrink-0 border-b border-zinc-900/10 bg-zinc-200/70 backdrop-blur">
        <div className="mx-auto max-w-[1600px] px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-base font-bold text-zinc-900">Avito CRM</div>
            <div className="text-xs text-zinc-500">
              Мгновенные сообщения + AI-ответы
            </div>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto max-w-[70vw] lg:max-w-none">
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
              href="/analytics"
              className="inline-flex items-center rounded-xl bg-zinc-200/70 px-3 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-900/10 shadow-sm hover:bg-zinc-200/85 transition"
            >
              Аналитика
            </a>

            <a
              href="/ai-assistant"
              className="inline-flex items-center rounded-xl bg-zinc-200/70 px-3 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-900/10 shadow-sm hover:bg-zinc-200/85 transition"
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


      <div className="mx-auto max-w-[1800px] w-full px-4 py-4 flex-1 min-h-0 flex flex-col">

{/* Mobile tabs */}
{!selectedChatId && (
  <div className="lg:hidden shrink-0 mb-3">
    <MobileTabs
      value={mobileTab}
      onChange={(v) => setMobileTab(v)}
      items={[
        { value: "MANAGER", label: "Менеджер", count: manChatsDisplay.length, unread: manUnreadCount },
        { value: "BOT", label: "Бот", count: botChatsDisplay.length, unread: botUnreadCount },
        { value: "INACTIVE", label: "Неактив", count: inactiveChatsDisplay.length, unread: inactiveUnreadCount },
      ]}
    />
  </div>
)}
        <div className="flex flex-col gap-4 flex-1 min-h-0 lg:grid lg:grid-cols-[320px_320px_320px_1fr] lg:h-full lg:min-h-0">
          {/* INACTIVE column */}
          <section
            className={cn(
              "rounded-3xl bg-amber-50/70 ring-1 ring-amber-900/15 overflow-hidden flex flex-col min-h-0 flex-1",
              selectedChatId ? "hidden lg:flex" : mobileTab !== "INACTIVE" ? "hidden lg:flex" : ""
            )}
          >
            <ColumnHeader
              title="Неактивные сделки"
              subtitle="нет ответа после дожима бота"
              countLabel={filters.INACTIVE.labelFilter ? `Показано: ${inactiveChatsDisplay.length} / Всего: ${inactiveChats.length}` : `Всего: ${inactiveChatsDisplay.length}`}
              sortOrder={filters.INACTIVE.sortOrder}
              unreadOnly={filters.INACTIVE.unreadOnly}
              priceSort={filters.INACTIVE.priceSort}
              labelFilter={filters.INACTIVE.labelFilter}
              showUnreadFilter={false}
              setSortOrder={(v) =>
                setFilters((p) => ({
                  ...p,
                  INACTIVE: { ...p.INACTIVE, sortOrder: v },
                }))
              }
              setUnreadOnly={(v) =>
                setFilters((p) => ({
                  ...p,
                  INACTIVE: { ...p.INACTIVE, unreadOnly: v },
                }))
              }
              setPriceSort={(v) =>
                setFilters((p) => ({ ...p, INACTIVE: { ...p.INACTIVE, priceSort: v } }))
              }
              setLabelFilter={(v) =>
                setFilters((p) => ({ ...p, INACTIVE: { ...p.INACTIVE, labelFilter: v } }))
              }
            />

            <div className="p-2 space-y-1.5 flex-1 min-h-0 overflow-auto">
              {inactiveChatsDisplay.length === 0 ? (
                <div className="rounded-2xl bg-amber-50/70 ring-1 ring-amber-900/10 p-4 text-sm text-zinc-600">
                  Неактивных сделок нет
                </div>
              ) : (
                inactiveChatsDisplay.map((c) => (
                  <div key={c.id} className="relative group">
                    <ChatCard
                      chat={c}
                      selected={c.id === selectedChatId}
                      onSelect={selectChat}
                      onSetLabel={setChatLabel}
                      showPin={false}
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        reactivateChat(c);
                      }}
                      className="absolute top-2 right-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition inline-flex items-center rounded-lg bg-emerald-600/10 px-2 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-700/20 hover:bg-emerald-600/20"
                      title="Вернуть в работу (BOT)"
                    >
                      <span className="hidden sm:inline">Реактивировать</span>
                      <span className="sm:hidden">→ BOT</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* BOT column */}
          <section
            className={cn(
              "rounded-3xl bg-zinc-200/70 ring-1 ring-zinc-900/10 overflow-hidden flex flex-col min-h-0 flex-1",
              selectedChatId ? "hidden lg:flex" : mobileTab !== "BOT" ? "hidden lg:flex" : ""
            )}
          >
            <ColumnHeader
              title="Обработка ботом"
              subtitle="чаты, где отвечает бот"
              countLabel={filters.BOT.labelFilter ? `Показано: ${botChatsDisplay.length} / Всего: ${botChatsUI.length}` : (filters.BOT.unreadOnly ? `Непроч.: ${botChatsDisplay.length}` : `Всего: ${botChatsDisplay.length}`)}
              sortOrder={filters.BOT.sortOrder}
              unreadOnly={filters.BOT.unreadOnly}
              priceSort={filters.BOT.priceSort}
              labelFilter={filters.BOT.labelFilter}
              setSortOrder={(v) =>
                setFilters((p) => ({ ...p, BOT: { ...p.BOT, sortOrder: v } }))
              }
              setUnreadOnly={(v) =>
                setFilters((p) => ({ ...p, BOT: { ...p.BOT, unreadOnly: v } }))
              }
              setPriceSort={(v) =>
                setFilters((p) => ({ ...p, BOT: { ...p.BOT, priceSort: v } }))
              }
              setLabelFilter={(v) =>
                setFilters((p) => ({ ...p, BOT: { ...p.BOT, labelFilter: v } }))
              }
            />

            <div
              ref={botListRef}
              onScroll={(e) => {
                botListScrollTopRef.current = e.currentTarget.scrollTop;
              }}
              className="p-2 space-y-1.5 flex-1 min-h-0 overflow-auto"
            >
              {botChatsDisplay.length === 0 ? (
                <div className="rounded-2xl bg-zinc-200/70 ring-1 ring-zinc-900/10 p-4 text-sm text-zinc-600">
                  Тут пока пусто
                </div>
              ) : (
                botChatsDisplay.map((c) => (
                  <ChatCard
                    onEscalate={escalateChat}
                    onSetLabel={setChatLabel}
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
          <section
            className={cn(
              "rounded-3xl bg-zinc-200/70 ring-1 ring-zinc-900/10 overflow-hidden flex flex-col min-h-0 flex-1",
              selectedChatId ? "hidden lg:flex" : mobileTab !== "MANAGER" ? "hidden lg:flex" : ""
            )}
          >
            <ColumnHeader
              title="Переведен на менеджера"
              subtitle="чаты для оператора + закрепы"
              countLabel={filters.MANAGER.labelFilter ? `Показано: ${manChatsDisplay.length} / Всего: ${manChatsUI.length}` : (filters.MANAGER.unreadOnly ? `Непроч.: ${manChatsDisplay.length}` : `Всего: ${manChatsDisplay.length}`)}
              sortOrder={filters.MANAGER.sortOrder}
              unreadOnly={filters.MANAGER.unreadOnly}
              priceSort={filters.MANAGER.priceSort}
              labelFilter={filters.MANAGER.labelFilter}
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
              setPriceSort={(v) =>
                setFilters((p) => ({ ...p, MANAGER: { ...p.MANAGER, priceSort: v } }))
              }
              setLabelFilter={(v) =>
                setFilters((p) => ({ ...p, MANAGER: { ...p.MANAGER, labelFilter: v } }))
              }
            />

            <div
              ref={manListRef}
              onScroll={(e) => {
                manListScrollTopRef.current = e.currentTarget.scrollTop;
              }}
              className="p-2 space-y-1.5 flex-1 min-h-0 overflow-auto"
            >
              {manChatsDisplay.length === 0 ? (
                <div className="rounded-2xl bg-zinc-200/70 ring-1 ring-zinc-900/10 p-4 text-sm text-zinc-600">
                  Тут пока пусто
                </div>
              ) : (
                manChatsDisplay.map((c) => (
                  <ChatCard
                    key={c.id}
                    chat={c}
                    selected={c.id === selectedChatId}
                    onSelect={selectChat}
                    onSetLabel={setChatLabel}
                    onTogglePin={togglePin}
                    showPin={true}
                  />
                ))
              )}
            </div>
          </section>

          {/* Chat panel */}
          <section
            className={cn(
              "rounded-3xl bg-zinc-200/70 ring-1 ring-zinc-900/10 overflow-hidden flex flex-col min-h-0 flex-1",
              selectedChatId ? "" : "hidden lg:flex"
            )}
          >
            
{!selectedChat ? (
  <div className="p-6 flex-1 min-h-0 flex items-center justify-center">
    <div className="max-w-md rounded-3xl bg-zinc-100/85 ring-1 ring-zinc-900/10 p-6 shadow-sm">
      {selectedChatId ? (
        <>
          <div className="text-lg font-bold text-zinc-900">Открываю чат…</div>
          <div className="mt-2 text-sm text-zinc-600">
            Подгружаю данные по переписке и карточке сделки.
          </div>
        </>
      ) : (
        <>
          <div className="text-lg font-bold text-zinc-900">Выбери чат</div>
          <div className="mt-2 text-sm text-zinc-600">
            Слева две колонки. Нажми на чат — справа откроется переписка.
          </div>
        </>
      )}
    </div>
  </div>
) : (
              <div className="flex flex-col flex-1 min-h-0">
                {/* Chat header */}
                <div className="shrink-0 border-b border-zinc-900/10 bg-zinc-200/70 backdrop-blur px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          className="lg:hidden px-2 py-1 text-xs"
                          onClick={clearSelectedChat}
                          title="Назад к списку чатов"
                        >
                          ← Чаты
                        </Button>
                        <div className="truncate text-base font-bold text-zinc-900">
                          {selectedChat.itemTitle ?? "Без названия"}
                        </div>
                        <Badge>{selectedChat.status}</Badge>
                        {selectedChat.labelColor && (
                          <span
                            title={`Метка: ${labelName(selectedChat.labelColor)}`}
                            className={cn(
                              "inline-flex h-3 w-3 rounded-full ring-1",
                              LABEL_META[selectedChat.labelColor].dot,
                              LABEL_META[selectedChat.labelColor].ring
                            )}
                          />
                        )}
                        {selectedChat.unreadCount > 0 && (
                          <DangerBadge>{selectedChat.unreadCount} непроч.</DangerBadge>
                        )}
                        {selectedChat.manualUnread && selectedChat.unreadCount === 0 && (
                          <DangerBadge>непроч.</DangerBadge>
                        )}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                        <div>
                          Клиент:{" "}
                          <span className="text-zinc-800">
                            {selectedChat.customerName ?? "—"}
                          </span>
                        </div>

                        {/* ✅ цена */}
                        <div>
                          Цена:{" "}
                          <span className="text-zinc-800">
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
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {selectedChatExternalUrl && (
                        <LinkButton href={selectedChatExternalUrl} title="Открыть чат в Avito">
                          Чат Авито
                        </LinkButton>
                      )}

						{selectedChat.status === "MANAGER" && !selectedChat.manualUnread && (
							<Button
								variant="ghost"
								onClick={async () => {
									try {
											manualUnreadSetWhileOpenRef.current[selectedChat.id] = true;
										await markManualUnread(selectedChat);

										// instant UI feedback for selected chat
										selectedChatCacheRef.current[selectedChat.id] = {
											...selectedChatCacheRef.current[selectedChat.id],
											manualUnread: true,
										};

										// UX: after "Сделать непрочитанным" закрываем чат
										clearSelectedChat();
									} catch {
										// ignore
									}
								}}
								title="Поставить ручную отметку непрочитанного"
							>
								Сделать непрочитанным
							</Button>
						)}

                      {selectedChat.status === "MANAGER" && (
                        <Button
                        variant="danger"
                        onClick={async () => {
                          try {
                            await finishDialog(selectedChat);
                            // UX: после завершения диалога закрываем чат
                            clearSelectedChat();
                          } catch {
                            // ignore
                          }
                        }}
                      >
                          Завершить диалог → BOT
                        </Button>
                      )}
                      {selectedChat.status === "INACTIVE" && (
                        <Button onClick={() => reactivateChat(selectedChat)}>
                          Реактивировать → BOT
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Messages */}
                <div
                  ref={messagesRef}
                  onScroll={handleScroll}
                  className="relative flex-1 min-h-0 overflow-auto px-5 py-4 space-y-3 bg-gradient-to-b from-zinc-200/60 to-zinc-200/35"
                >
                  {refreshing && (
                    <div className="sticky top-0 z-10 -mx-5 px-5 pb-2">
                      <div className="rounded-2xl bg-zinc-100/85 ring-1 ring-zinc-900/10 px-3 py-2 text-xs text-zinc-700 flex items-center justify-between shadow-sm">
                        <span>Подгружаю историю из Avito…</span>
                        <span className="text-zinc-500">refresh=1</span>
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
        <div className="min-h-screen flex items-center justify-center text-zinc-500">
          Loading…
        </div>
      }
    >
      <PageInner />
    </Suspense>
  );
}
