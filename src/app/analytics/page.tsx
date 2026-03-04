// src/app/analytics/page.tsx
"use client";

import React, { useCallback, useMemo, useState } from "react";
import useSWR from "swr";

export const dynamic = "force-dynamic";

async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const r = await fetch(input, { ...init, credentials: "include" });

  if (r.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }

  return r;
}

const fetcher = (url: string) => apiFetch(url).then((r) => r.json());

function yyyyMmDd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function localDayStart(dateStr: string) {
  // IMPORTANT: "YYYY-MM-DD" alone is treated as UTC by JS. We force local with T00:00:00
  return new Date(`${dateStr}T00:00:00`);
}

function localDayEndExclusive(dateStr: string) {
  const start = localDayStart(dateStr);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

type ApiStats = {
  ok: boolean;
  today: {
    start: string;
    endExclusive: string;
    chats: number;
    chatsBot: number;
    chatsManager: number;
    chatsInactive: number;
    messages: number;
    messagesIn: number;
    messagesOut: number;
  };
  period: {
    start: string;
    endExclusive: string;
    chats: number;
    chatsBot: number;
    chatsManager: number;
    chatsInactive: number;
    messages: number;
    messagesIn: number;
    messagesOut: number;
  };
};

function StatCard({
  title,
  stats,
}: {
  title: string;
  stats: ApiStats["today"] | ApiStats["period"];
}) {
  return (
    <div className="rounded-3xl bg-zinc-200/70 ring-1 ring-zinc-900/10 p-4">
      <div className="text-sm font-semibold text-zinc-900">{title}</div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white/60 ring-1 ring-zinc-900/10 p-3">
          <div className="text-xs text-zinc-500">Чатов с сообщениями</div>
          <div className="text-2xl font-bold text-zinc-900">{stats.chats}</div>
          <div className="mt-1 text-xs text-zinc-500">
            BOT: {stats.chatsBot} • MANAGER: {stats.chatsManager} • INACTIVE: {stats.chatsInactive}
          </div>
        </div>
        <div className="rounded-2xl bg-white/60 ring-1 ring-zinc-900/10 p-3">
          <div className="text-xs text-zinc-500">Сообщений</div>
          <div className="text-2xl font-bold text-zinc-900">{stats.messages}</div>
          <div className="mt-1 text-xs text-zinc-500">
            Входящих: {stats.messagesIn} • Исходящих: {stats.messagesOut}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const todayStr = useMemo(() => yyyyMmDd(new Date()), []);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return yyyyMmDd(d);
  });
  const [to, setTo] = useState(() => todayStr);

  const tz = useMemo(() => new Date().getTimezoneOffset(), []);

  const apiUrl = useMemo(() => {
    const start = localDayStart(from).toISOString();
    const endExclusive = localDayEndExclusive(to).toISOString();
    const p = new URLSearchParams({ from: start, to: endExclusive, tz: String(tz) });
    return `/api/analytics?${p.toString()}`;
  }, [from, to, tz]);

  const { data, error, isLoading, mutate } = useSWR<ApiStats>(apiUrl, fetcher, {
    revalidateOnFocus: false,
  });

  const setPreset = useCallback(
    (days: number) => {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - (days - 1));
      setFrom(yyyyMmDd(start));
      setTo(yyyyMmDd(end));
      // force immediate reload
      queueMicrotask(() => mutate());
    },
    [mutate]
  );

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <div className="shrink-0 border-b border-zinc-900/10 bg-zinc-200/70 backdrop-blur">
        <div className="mx-auto max-w-[1200px] px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-base font-bold text-zinc-900">Avito CRM</div>
            <div className="text-xs text-zinc-500">Аналитика</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/"
              className="inline-flex items-center rounded-xl bg-zinc-200/70 px-3 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-900/10 shadow-sm hover:bg-zinc-200/85 transition"
            >
              CRM
            </a>
            <a
              href="/ai-assistant"
              className="inline-flex items-center rounded-xl bg-zinc-200/70 px-3 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-900/10 shadow-sm hover:bg-zinc-200/85 transition"
            >
              AI Ассистент
            </a>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-[1200px] w-full px-4 py-4 flex-1">
        <div className="rounded-3xl bg-zinc-200/70 ring-1 ring-zinc-900/10 p-4">
          <div className="text-sm font-semibold text-zinc-900">Период</div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-xs text-zinc-600">
              С
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="ml-2 rounded-xl bg-white/60 ring-1 ring-zinc-900/10 px-3 py-2 text-sm text-zinc-900"
              />
            </label>

            <label className="text-xs text-zinc-600">
              По
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="ml-2 rounded-xl bg-white/60 ring-1 ring-zinc-900/10 px-3 py-2 text-sm text-zinc-900"
              />
            </label>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPreset(1)}
                className="rounded-xl bg-white/60 ring-1 ring-zinc-900/10 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-white/70 transition"
              >
                Сегодня
              </button>
              <button
                onClick={() => setPreset(7)}
                className="rounded-xl bg-white/60 ring-1 ring-zinc-900/10 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-white/70 transition"
              >
                7 дней
              </button>
              <button
                onClick={() => setPreset(30)}
                className="rounded-xl bg-white/60 ring-1 ring-zinc-900/10 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-white/70 transition"
              >
                30 дней
              </button>
            </div>

            <div className="flex-1" />
            <button
              onClick={() => mutate()}
              className="rounded-xl bg-zinc-900 text-white px-4 py-2 text-xs font-semibold hover:opacity-90 transition"
            >
              Обновить
            </button>
          </div>

          <div className="mt-2 text-xs text-zinc-500">
            Показатели считаются по сообщениям (IN/OUT) в выбранном диапазоне.
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {isLoading ? (
            <div className="rounded-3xl bg-zinc-200/70 ring-1 ring-zinc-900/10 p-4 text-sm text-zinc-600">
              Загрузка…
            </div>
          ) : error ? (
            <div className="rounded-3xl bg-rose-50 ring-1 ring-rose-200 p-4 text-sm text-rose-800">
              Ошибка загрузки аналитики.
            </div>
          ) : data?.ok ? (
            <>
              <StatCard title="Сегодня" stats={data.today} />
              <StatCard
                title={`Период: ${from} — ${to}`}
                stats={data.period}
              />
            </>
          ) : (
            <div className="rounded-3xl bg-rose-50 ring-1 ring-rose-200 p-4 text-sm text-rose-800">
              Аналитика недоступна.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
