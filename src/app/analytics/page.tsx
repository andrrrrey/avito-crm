// src/app/analytics/page.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
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

// ── Types ──────────────────────────────────────────────────────────────────

type DailyPoint = {
  date: string;
  chats: number;
  messagesIN: number;
  messagesOUT: number;
  aiMessages: number;
  managerMessages: number;
};

type AnalyticsData = {
  period: { days: number; since: string };
  chats: {
    total: number;
    today: number;
    period: number;
    byStatus: { BOT: number; MANAGER: number; INACTIVE: number };
  };
  messages: {
    total: number;
    period: number;
    byDirection: { IN: number; OUT: number };
    byAuthor: { customer: number; ai: number; manager: number };
    byAuthorPeriod: { customer: number; ai: number; manager: number };
  };
  conversion: {
    aiToManager: number;
    totalEscalated: number;
    totalBotHandled: number;
  };
  daily: DailyPoint[];
};

// ── Helpers ────────────────────────────────────────────────────────────────

function pct(n: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

function fmtNum(n: number) {
  return n.toLocaleString("ru-RU");
}

function fmtPct(n: number) {
  return `${Math.round(n * 100)}%`;
}

// ── Mini bar chart ─────────────────────────────────────────────────────────

type BarChartSeries = {
  key: keyof DailyPoint;
  color: string;
  label: string;
};

function MiniBarChart({
  data,
  series,
  height = 80,
}: {
  data: DailyPoint[];
  series: BarChartSeries[];
  height?: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (!data.length)
    return (
      <div className="flex items-center justify-center text-xs text-zinc-400" style={{ height }}>
        Нет данных
      </div>
    );

  const maxVal = Math.max(
    ...data.map((d) => series.reduce((s, k) => s + Number(d[k.key]), 0)),
    1
  );

  const barGroupW = Math.max(4, Math.floor((360 - data.length) / data.length));

  return (
    <div className="relative">
      <div className="flex items-end gap-px overflow-hidden" style={{ height }}>
        {data.map((d, i) => {
          const total = series.reduce((s, k) => s + Number(d[k.key]), 0);
          return (
            <div
              key={i}
              className="group flex flex-col-reverse items-end justify-start cursor-default relative"
              style={{ width: barGroupW, height }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              {series.map((s) => {
                const val = Number(d[s.key]);
                const h = total > 0 ? (val / maxVal) * (height - 4) : 0;
                return (
                  <div
                    key={s.key as string}
                    className="w-full rounded-t-sm transition-opacity"
                    style={{
                      height: Math.max(h, val > 0 ? 2 : 0),
                      backgroundColor: s.color,
                      opacity: hovered !== null && hovered !== i ? 0.5 : 1,
                    }}
                  />
                );
              })}
              {hovered === i && (
                <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-[10px] px-2 py-1 rounded-lg whitespace-nowrap z-20 pointer-events-none shadow-lg">
                  <div className="font-medium mb-0.5">{d.date}</div>
                  {series.map((s) => (
                    <div key={s.key as string} className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
                      <span>{s.label}: {fmtNum(Number(d[s.key]))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* X-axis labels: first and last */}
      {data.length > 1 && (
        <div className="flex justify-between mt-1 text-[10px] text-zinc-400">
          <span>{data[0].date.slice(5)}</span>
          <span>{data[data.length - 1].date.slice(5)}</span>
        </div>
      )}
    </div>
  );
}

// ── Stat card ──────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color = "zinc",
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: "zinc" | "sky" | "emerald" | "amber" | "violet" | "rose";
}) {
  const bg: Record<string, string> = {
    zinc: "bg-zinc-100",
    sky: "bg-sky-50 ring-sky-200",
    emerald: "bg-emerald-50 ring-emerald-200",
    amber: "bg-amber-50 ring-amber-200",
    violet: "bg-violet-50 ring-violet-200",
    rose: "bg-rose-50 ring-rose-200",
  };
  const text: Record<string, string> = {
    zinc: "text-zinc-900",
    sky: "text-sky-800",
    emerald: "text-emerald-800",
    amber: "text-amber-800",
    violet: "text-violet-800",
    rose: "text-rose-800",
  };
  const subText: Record<string, string> = {
    zinc: "text-zinc-500",
    sky: "text-sky-600",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    violet: "text-violet-600",
    rose: "text-rose-600",
  };

  return (
    <div className={`rounded-2xl ${bg[color]} p-4 ring-1 ring-zinc-900/10`}>
      <div className="text-xs text-zinc-500 mb-1 font-geist">{label}</div>
      <div className={`text-2xl font-bold ${text[color]} font-geist`}>{typeof value === "number" ? fmtNum(value) : value}</div>
      {sub && <div className={`text-xs ${subText[color]} mt-0.5 font-geist`}>{sub}</div>}
    </div>
  );
}

// ── Donut-like bar ─────────────────────────────────────────────────────────

function DistBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!total) return <div className="h-3 rounded-full bg-zinc-200" />;
  return (
    <div className="flex h-3 rounded-full overflow-hidden gap-px">
      {segments.map((s) => {
        const w = (s.value / total) * 100;
        if (!w) return null;
        return (
          <div
            key={s.label}
            className="transition-all"
            style={{ width: `${w}%`, backgroundColor: s.color }}
            title={`${s.label}: ${fmtNum(s.value)} (${pct(s.value, total)})`}
          />
        );
      })}
    </div>
  );
}

// ── Icon ───────────────────────────────────────────────────────────────────

function IconAnalytics({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

// ── Period selector ────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { label: "Сегодня", value: 1 },
  { label: "7 дней", value: 7 },
  { label: "30 дней", value: 30 },
  { label: "90 дней", value: 90 },
];

// ── Main page ──────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const router = useRouter();
  const [days, setDays] = useState(30);

  const { data: meData } = useSWR<{ ok: boolean; user: { role: string } | null }>("/api/auth/me", fetcher);
  const { data: analyticsResp, isLoading } = useSWR<{ ok: boolean; data: AnalyticsData }>(
    `/api/analytics?days=${days}`,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false }
  );

  const isAdmin = meData?.user?.role === "ADMIN";
  const d = analyticsResp?.data;

  const totalMessages = d?.messages.total ?? 0;
  const periodMessages = d?.messages.period ?? 0;
  const totalChats = d?.chats.total ?? 0;
  const convRate = d?.conversion.aiToManager ?? 0;

  return (
    <div className="min-h-screen">
      <div className="min-h-screen p-0 sm:p-2 lg:p-5 flex flex-col">
        <div className="mx-auto w-full max-w-7xl flex-1 flex flex-col bg-white rounded-none sm:rounded-2xl lg:rounded-[30px] shadow-none sm:shadow-2xl overflow-hidden">

          {/* ── Header ── */}
          <header className="border-b border-zinc-100 px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 md:py-4 flex items-center justify-between shrink-0 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 sm:h-8 sm:w-8 flex bg-sky-400 rounded-full items-center justify-center shrink-0">
                <IconAnalytics className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-zinc-900" />
              </div>
              <span className="text-base sm:text-lg tracking-tight font-medium font-geist">AITOCRM</span>
              <span className="hidden sm:inline-flex text-[10px] px-2 py-0.5 rounded-full bg-zinc-950 text-white font-medium font-geist">
                Аналитика
              </span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                onClick={() => router.push("/")}
                className="px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-xs font-medium rounded-full bg-zinc-100 hover:bg-zinc-200 transition font-geist whitespace-nowrap"
              >
                Чаты
              </button>
              <button
                onClick={() => router.push("/dashboard")}
                className="px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-xs font-medium rounded-full bg-zinc-100 hover:bg-zinc-200 transition font-geist whitespace-nowrap"
              >
                Настройки
              </button>
              {isAdmin && (
                <button
                  onClick={() => router.push("/admin/billing/overview")}
                  className="px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-xs font-medium rounded-full bg-violet-600 text-white hover:bg-violet-700 transition font-geist whitespace-nowrap"
                >
                  Биллинг
                </button>
              )}
            </div>
          </header>

          {/* ── Content ── */}
          <div className="flex-1 overflow-y-auto p-4 md:p-8">
            {/* Title + period */}
            <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-zinc-900 font-geist">Аналитика</h1>
                <p className="text-sm text-zinc-500 mt-1 font-geist">
                  Статистика чатов, сообщений и конверсии
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-xl bg-zinc-100 p-1 self-start shrink-0">
                {PERIOD_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDays(opt.value)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition font-geist ${
                      days === opt.value
                        ? "bg-white shadow text-zinc-900"
                        : "text-zinc-500 hover:text-zinc-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-24 text-zinc-400 text-sm font-geist">
                Загрузка…
              </div>
            ) : !d ? (
              <div className="flex items-center justify-center py-24 text-zinc-400 text-sm font-geist">
                Нет данных
              </div>
            ) : (
              <div className="space-y-6">

                {/* ── Чаты ── */}
                <section>
                  <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3 font-geist">Чаты</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <StatCard label="Всего" value={totalChats} />
                    <StatCard label="Сегодня" value={d.chats.today} color="sky" />
                    <StatCard label={`За ${days === 1 ? "сегодня" : `${days} дней`}`} value={d.chats.period} sub="новых чатов" />
                    <StatCard label="С ИИ (BOT)" value={d.chats.byStatus.BOT} color="violet" sub={pct(d.chats.byStatus.BOT, totalChats)} />
                    <StatCard label="С менеджером" value={d.chats.byStatus.MANAGER} color="emerald" sub={pct(d.chats.byStatus.MANAGER, totalChats)} />
                    <StatCard label="Неактивных" value={d.chats.byStatus.INACTIVE} color="zinc" sub={pct(d.chats.byStatus.INACTIVE, totalChats)} />
                  </div>

                  {/* Status dist bar */}
                  <div className="mt-3 space-y-1.5">
                    <DistBar segments={[
                      { label: "BOT", value: d.chats.byStatus.BOT, color: "#8b5cf6" },
                      { label: "MANAGER", value: d.chats.byStatus.MANAGER, color: "#10b981" },
                      { label: "INACTIVE", value: d.chats.byStatus.INACTIVE, color: "#a1a1aa" },
                    ]} />
                    <div className="flex gap-4 text-[11px] text-zinc-500 font-geist">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-violet-500 inline-block" />ИИ</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" />Менеджер</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-zinc-400 inline-block" />Неактивные</span>
                    </div>
                  </div>
                </section>

                {/* ── Сообщения ── */}
                <section>
                  <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3 font-geist">Сообщения</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    <StatCard label="Всего" value={totalMessages} />
                    <StatCard label={`За ${days === 1 ? "сегодня" : `${days} дней`}`} value={periodMessages} sub="всего за период" />
                    <StatCard label="Входящих (клиенты)" value={d.messages.byDirection.IN} color="sky" sub={pct(d.messages.byDirection.IN, totalMessages)} />
                    <StatCard label="От ИИ" value={d.messages.byAuthor.ai} color="violet" sub={pct(d.messages.byAuthor.ai, totalMessages)} />
                    <StatCard label="От менеджеров" value={d.messages.byAuthor.manager} color="emerald" sub={pct(d.messages.byAuthor.manager, totalMessages)} />
                  </div>

                  {/* Message dist bar */}
                  <div className="mt-3 space-y-1.5">
                    <DistBar segments={[
                      { label: "Клиенты (вх.)", value: d.messages.byDirection.IN, color: "#0ea5e9" },
                      { label: "ИИ (исх.)", value: d.messages.byAuthor.ai, color: "#8b5cf6" },
                      { label: "Менеджеры (исх.)", value: d.messages.byAuthor.manager, color: "#10b981" },
                    ]} />
                    <div className="flex gap-4 text-[11px] text-zinc-500 font-geist">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-sky-500 inline-block" />Клиенты</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-violet-500 inline-block" />ИИ</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" />Менеджеры</span>
                    </div>
                  </div>

                  {/* Period breakdown */}
                  {days > 1 && (
                    <div className="mt-3 rounded-2xl bg-zinc-50 ring-1 ring-zinc-200 p-4 grid grid-cols-3 gap-4">
                      <div className="text-center">
                        <div className="text-xs text-zinc-500 mb-1 font-geist">Клиентов за период</div>
                        <div className="text-xl font-bold text-sky-700 font-geist">{fmtNum(d.messages.byAuthorPeriod.customer)}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-zinc-500 mb-1 font-geist">ИИ за период</div>
                        <div className="text-xl font-bold text-violet-700 font-geist">{fmtNum(d.messages.byAuthorPeriod.ai)}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-zinc-500 mb-1 font-geist">Менеджеры за период</div>
                        <div className="text-xl font-bold text-emerald-700 font-geist">{fmtNum(d.messages.byAuthorPeriod.manager)}</div>
                      </div>
                    </div>
                  )}
                </section>

                {/* ── Конверсия ── */}
                <section>
                  <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3 font-geist">Конверсия</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* AI → Manager */}
                    <div className="rounded-2xl bg-emerald-50 ring-1 ring-emerald-200 p-5">
                      <div className="text-xs text-emerald-600 mb-2 font-geist">ИИ → Менеджер</div>
                      <div className="text-4xl font-bold text-emerald-800 font-geist">{fmtPct(convRate)}</div>
                      <div className="text-xs text-emerald-600 mt-1 font-geist">
                        {fmtNum(d.conversion.totalEscalated)} из {fmtNum(d.conversion.totalBotHandled)} чатов с ИИ
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-emerald-200 overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: fmtPct(convRate) }} />
                      </div>
                    </div>

                    {/* Bot coverage */}
                    <div className="rounded-2xl bg-violet-50 ring-1 ring-violet-200 p-5">
                      <div className="text-xs text-violet-600 mb-2 font-geist">Охват ИИ</div>
                      <div className="text-4xl font-bold text-violet-800 font-geist">
                        {pct(d.conversion.totalBotHandled, totalChats)}
                      </div>
                      <div className="text-xs text-violet-600 mt-1 font-geist">
                        {fmtNum(d.conversion.totalBotHandled)} из {fmtNum(totalChats)} чатов обработал ИИ
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-violet-200 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-violet-500 transition-all"
                          style={{ width: `${totalChats > 0 ? Math.round((d.conversion.totalBotHandled / totalChats) * 100) : 0}%` }}
                        />
                      </div>
                    </div>

                    {/* Manager ratio */}
                    <div className="rounded-2xl bg-sky-50 ring-1 ring-sky-200 p-5">
                      <div className="text-xs text-sky-600 mb-2 font-geist">Нагрузка на менеджеров</div>
                      <div className="text-4xl font-bold text-sky-800 font-geist">
                        {pct(d.chats.byStatus.MANAGER + d.chats.byStatus.INACTIVE, totalChats)}
                      </div>
                      <div className="text-xs text-sky-600 mt-1 font-geist">
                        {fmtNum(d.chats.byStatus.MANAGER + d.chats.byStatus.INACTIVE)} чатов перешло к людям
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-sky-200 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-sky-500 transition-all"
                          style={{ width: pct(d.chats.byStatus.MANAGER + d.chats.byStatus.INACTIVE, totalChats) }}
                        />
                      </div>
                    </div>
                  </div>
                </section>

                {/* ── Графики ── */}
                {d.daily.length > 1 && (
                  <section>
                    <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3 font-geist">Динамика</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                      {/* Чаты по дням */}
                      <div className="rounded-2xl bg-zinc-50 ring-1 ring-zinc-200 p-5">
                        <h3 className="text-sm font-semibold text-zinc-800 mb-4 font-geist">Новые чаты по дням</h3>
                        <MiniBarChart
                          data={d.daily}
                          series={[
                            { key: "chats", color: "#0ea5e9", label: "чатов" },
                          ]}
                        />
                        <div className="mt-2 flex gap-4 text-[11px] text-zinc-500 font-geist">
                          <span className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-sm bg-sky-500 inline-block" />
                            Новые чаты
                          </span>
                        </div>
                      </div>

                      {/* Сообщения по дням */}
                      <div className="rounded-2xl bg-zinc-50 ring-1 ring-zinc-200 p-5">
                        <h3 className="text-sm font-semibold text-zinc-800 mb-4 font-geist">Сообщения по дням</h3>
                        <MiniBarChart
                          data={d.daily}
                          series={[
                            { key: "messagesIN", color: "#0ea5e9", label: "входящих" },
                            { key: "aiMessages", color: "#8b5cf6", label: "от ИИ" },
                            { key: "managerMessages", color: "#10b981", label: "от менеджера" },
                          ]}
                        />
                        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-zinc-500 font-geist">
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-sky-500 inline-block" />Входящие</span>
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-violet-500 inline-block" />ИИ</span>
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />Менеджер</span>
                        </div>
                      </div>

                      {/* Конверсия по дням — соотношение */}
                      <div className="rounded-2xl bg-zinc-50 ring-1 ring-zinc-200 p-5 md:col-span-2">
                        <h3 className="text-sm font-semibold text-zinc-800 mb-4 font-geist">
                          Соотношение ИИ vs Менеджер (исходящие сообщения по дням)
                        </h3>
                        <MiniBarChart
                          data={d.daily}
                          series={[
                            { key: "aiMessages", color: "#8b5cf6", label: "от ИИ" },
                            { key: "managerMessages", color: "#10b981", label: "от менеджера" },
                          ]}
                          height={100}
                        />
                        <div className="mt-2 flex gap-4 text-[11px] text-zinc-500 font-geist">
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-violet-500 inline-block" />ИИ</span>
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />Менеджер</span>
                          <span className="text-zinc-400">наведите на столбец для деталей</span>
                        </div>
                      </div>

                    </div>
                  </section>
                )}

              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
