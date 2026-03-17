// src/app/admin/billing/overview/page.tsx
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

function fmt(n: number, digits = 2) {
  return n.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function IconBilling({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <line x1="2" x2="22" y1="10" y2="10" />
    </svg>
  );
}

type DailyPoint = { date: string; revenue: number; cost: number; profit: number; messages: number };
type ModelStat = { model: string; messages: number; revenue: number; cost: number; profit: number };
type TopUser = { userId: string; email: string | null; username: string | null; messages: number; revenue: number; cost: number; profit: number };
type StatsData = {
  days: number;
  since: string;
  totals: { messages: number; revenue: number; cost: number; profit: number; inputTokens: number; outputTokens: number };
  topUsers: TopUser[];
  byModel: ModelStat[];
  daily: DailyPoint[];
};

const PERIOD_OPTIONS = [
  { label: "7 дней", value: 7 },
  { label: "30 дней", value: 30 },
  { label: "90 дней", value: 90 },
];

function MiniBarChart({ data, valueKey, color = "#10b981" }: {
  data: DailyPoint[];
  valueKey: keyof DailyPoint;
  color?: string;
}) {
  if (!data.length) return <div className="h-20 flex items-center justify-center text-xs text-zinc-400">Нет данных</div>;

  const values = data.map((d) => Number(d[valueKey]));
  const max = Math.max(...values, 1);
  const barW = Math.max(2, Math.floor(360 / data.length) - 2);

  return (
    <div className="flex items-end gap-px h-20 overflow-hidden">
      {data.map((d, i) => {
        const h = Math.max(2, (Number(d[valueKey]) / max) * 72);
        return (
          <div key={i} className="group relative flex items-end" style={{ width: barW }}>
            <div
              className="w-full rounded-t-sm transition-opacity hover:opacity-80"
              style={{ height: h, backgroundColor: color }}
            />
            <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10">
              {d.date}: {fmt(Number(d[valueKey]))}₽
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function BillingOverviewPage() {
  const router = useRouter();

  const { data: meData } = useSWR<{ ok: boolean; user: { role: string } | null }>("/api/auth/me", fetcher);
  const [days, setDays] = useState(30);
  const [showAdminMenu, setShowAdminMenu] = useState(false);

  const { data: statsData, isLoading } = useSWR<{ ok: boolean; data: StatsData }>(
    `/api/admin/billing/stats?days=${days}`,
    fetcher,
  );

  const isAdmin = meData?.user?.role === "ADMIN";
  const stats = statsData?.data;

  if (!isAdmin && meData) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-zinc-900/10 text-center">
          <div className="text-lg font-semibold text-zinc-900 mb-2">Только для администраторов</div>
          <button
            onClick={() => router.push("/dashboard")}
            className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-700 transition-colors"
          >
            Перейти в кабинет
          </button>
        </div>
      </div>
    );
  }

  const totals = stats?.totals;
  const margin = totals && totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;

  // Распределение по моделям (для пай-чарта текстовым способом)
  const totalMessages = totals?.messages ?? 0;

  return (
    <div className="min-h-screen">
      <div className="min-h-screen p-0 sm:p-2 lg:p-5 flex flex-col">
        <div className="mx-auto w-full max-w-7xl flex-1 flex flex-col bg-white rounded-none sm:rounded-2xl lg:rounded-[30px] shadow-none sm:shadow-2xl overflow-hidden">

          {/* Header */}
          <header className="border-b border-zinc-100 px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 md:py-4 flex items-center justify-between shrink-0 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 sm:h-8 sm:w-8 flex bg-emerald-400 rounded-full items-center justify-center shrink-0">
                <IconBilling className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-zinc-900" />
              </div>
              <span className="text-base sm:text-lg tracking-tight font-medium font-geist">AITOCRM</span>
              <span className="hidden sm:inline-flex text-[10px] px-2 py-0.5 rounded-full bg-zinc-950 text-white font-medium font-geist">
                Биллинг
              </span>
              <span className="hidden md:inline-flex text-[10px] px-2 py-0.5 rounded-full font-medium font-geist bg-zinc-100 text-zinc-500">
                Обзор
              </span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                onClick={() => router.push("/admin/billing/users")}
                className="px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-xs font-medium rounded-full bg-zinc-100 hover:bg-zinc-200 transition font-geist whitespace-nowrap"
              >
                Пользователи
              </button>
              <button
                onClick={() => router.push("/admin/billing/settings")}
                className="px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-xs font-medium rounded-full bg-zinc-100 hover:bg-zinc-200 transition font-geist whitespace-nowrap"
              >
                Настройки
              </button>
              <button
                onClick={() => router.push("/")}
                className="px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-xs font-medium rounded-full bg-zinc-100 hover:bg-zinc-200 transition font-geist whitespace-nowrap"
              >
                Чаты
              </button>
              <div className="relative">
                <button
                  onClick={() => setShowAdminMenu((v) => !v)}
                  className="px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-xs font-medium rounded-full bg-violet-600 text-white hover:bg-violet-700 transition font-geist whitespace-nowrap"
                >
                  Админка
                </button>
                {showAdminMenu && (
                  <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-zinc-200 rounded-2xl shadow-lg py-1 min-w-[180px]">
                    <a href="/ai-assistant" className="block px-4 py-2 text-xs text-zinc-700 hover:bg-zinc-50 font-geist" onClick={() => setShowAdminMenu(false)}>AI Ассистент</a>
                    <a href="/admin/users" className="block px-4 py-2 text-xs text-zinc-700 hover:bg-zinc-50 font-geist" onClick={() => setShowAdminMenu(false)}>Пользователи</a>
                    <a href="/admin/billing/overview" className="block px-4 py-2 text-xs text-zinc-700 hover:bg-zinc-50 font-geist" onClick={() => setShowAdminMenu(false)}>Биллинг — Обзор</a>
                    <a href="/admin/billing/users" className="block px-4 py-2 text-xs text-zinc-700 hover:bg-zinc-50 font-geist" onClick={() => setShowAdminMenu(false)}>Биллинг — Пользователи</a>
                    <a href="/admin/billing/settings" className="block px-4 py-2 text-xs text-zinc-700 hover:bg-zinc-50 font-geist" onClick={() => setShowAdminMenu(false)}>Биллинг — Настройки</a>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 md:p-8">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-zinc-900 font-geist">Аналитика биллинга</h1>
                <p className="text-sm text-zinc-500 mt-1 font-geist">
                  Общие показатели по всем пользователям
                </p>
              </div>
              {/* Period selector */}
              <div className="flex items-center gap-1 rounded-xl bg-zinc-100 p-1 shrink-0">
                {PERIOD_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDays(opt.value)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
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
              <div className="flex items-center justify-center py-20 text-zinc-400 text-sm">
                Загрузка…
              </div>
            ) : (
              <div className="space-y-6">

                {/* KPI Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="rounded-2xl bg-zinc-200/80 p-4 ring-1 ring-zinc-900/10">
                    <div className="text-xs text-zinc-500 mb-1">Выручка</div>
                    <div className="text-2xl font-bold text-zinc-900 font-geist">
                      {fmt(totals?.revenue ?? 0)}₽
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">за {days} дней</div>
                  </div>
                  <div className="rounded-2xl bg-zinc-200/80 p-4 ring-1 ring-zinc-900/10">
                    <div className="text-xs text-zinc-500 mb-1">Себестоимость</div>
                    <div className="text-2xl font-bold text-zinc-700 font-geist">
                      {fmt(totals?.cost ?? 0)}₽
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">провайдер AI</div>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
                    <div className="text-xs text-emerald-600 mb-1">Прибыль</div>
                    <div className="text-2xl font-bold text-emerald-700 font-geist">
                      {fmt(totals?.profit ?? 0)}₽
                    </div>
                    <div className="text-xs text-emerald-500 mt-0.5">маржа {fmt(margin, 1)}%</div>
                  </div>
                  <div className="rounded-2xl bg-zinc-200/80 p-4 ring-1 ring-zinc-900/10">
                    <div className="text-xs text-zinc-500 mb-1">AI сообщений</div>
                    <div className="text-2xl font-bold text-zinc-900 font-geist">
                      {(totals?.messages ?? 0).toLocaleString("ru-RU")}
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      токенов: {((totals?.inputTokens ?? 0) + (totals?.outputTokens ?? 0)).toLocaleString("ru-RU")}
                    </div>
                  </div>
                </div>

                {/* Revenue chart */}
                <section className="rounded-2xl bg-zinc-200/80 p-6 ring-1 ring-zinc-900/10">
                  <h2 className="text-base font-semibold text-zinc-900 mb-4 font-geist">Доход по дням</h2>
                  {stats?.daily && stats.daily.length > 0 ? (
                    <>
                      <MiniBarChart data={stats.daily} valueKey="revenue" color="#10b981" />
                      <div className="mt-2 flex gap-4 text-xs text-zinc-500">
                        <span className="flex items-center gap-1">
                          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                          Выручка
                        </span>
                        <span className="text-zinc-400">наведите на столбец для деталей</span>
                      </div>
                    </>
                  ) : (
                    <div className="h-20 flex items-center justify-center text-sm text-zinc-400">
                      Нет данных за выбранный период
                    </div>
                  )}
                </section>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Top users */}
                  <section className="rounded-2xl bg-zinc-200/80 p-6 ring-1 ring-zinc-900/10">
                    <h2 className="text-base font-semibold text-zinc-900 mb-4 font-geist">
                      Топ пользователей по расходу
                    </h2>
                    {!stats?.topUsers?.length ? (
                      <div className="text-sm text-zinc-400">Нет данных</div>
                    ) : (
                      <div className="space-y-3">
                        {stats.topUsers.slice(0, 5).map((u, i) => {
                          const maxRevenue = stats.topUsers[0]?.revenue ?? 1;
                          const pct = maxRevenue > 0 ? (u.revenue / maxRevenue) * 100 : 0;
                          return (
                            <div key={u.userId}>
                              <div className="flex items-center justify-between mb-1">
                                <div className="text-xs text-zinc-700 font-medium truncate max-w-[180px]">
                                  <span className="text-zinc-400 mr-1.5">{i + 1}.</span>
                                  {u.email ?? u.username ?? u.userId.slice(0, 8) + "…"}
                                </div>
                                <div className="text-xs font-mono text-zinc-900 font-semibold">
                                  {fmt(u.revenue)}₽
                                </div>
                              </div>
                              <div className="h-1.5 rounded-full bg-zinc-300 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-emerald-500 transition-all"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <div className="flex justify-between text-[10px] text-zinc-400 mt-0.5">
                                <span>доход: {fmt(u.profit)}₽</span>
                                <span>{u.messages} сообщений</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {(stats?.topUsers?.length ?? 0) > 0 && (
                      <button
                        onClick={() => router.push(`/admin/billing/users?days=${days}`)}
                        className="mt-4 text-xs text-sky-600 hover:text-sky-800 transition"
                      >
                        Все пользователи →
                      </button>
                    )}
                  </section>

                  {/* Model distribution */}
                  <section className="rounded-2xl bg-zinc-200/80 p-6 ring-1 ring-zinc-900/10">
                    <h2 className="text-base font-semibold text-zinc-900 mb-4 font-geist">
                      Распределение по моделям
                    </h2>
                    {!stats?.byModel?.length ? (
                      <div className="text-sm text-zinc-400">Нет данных</div>
                    ) : (
                      <div className="space-y-4">
                        {stats.byModel.map((m) => {
                          const pct = totalMessages > 0 ? (m.messages / totalMessages) * 100 : 0;
                          const isGpt = m.model.toLowerCase().includes("gpt");
                          return (
                            <div key={m.model}>
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`inline-block w-2 h-2 rounded-full ${
                                      isGpt ? "bg-violet-500" : "bg-sky-500"
                                    }`}
                                  />
                                  <span className="text-xs font-medium text-zinc-700">{m.model}</span>
                                </div>
                                <span className="text-xs text-zinc-500">{fmt(pct, 1)}%</span>
                              </div>
                              <div className="h-2 rounded-full bg-zinc-300 overflow-hidden mb-1.5">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    isGpt ? "bg-violet-500" : "bg-sky-500"
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <div className="flex justify-between text-[10px] text-zinc-400">
                                <span>{m.messages.toLocaleString("ru-RU")} сообщений</span>
                                <span>выручка {fmt(m.revenue)}₽ · доход {fmt(m.profit)}₽</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Summary breakdown */}
                    {(stats?.byModel?.length ?? 0) > 0 && (
                      <div className="mt-4 pt-4 border-t border-zinc-300/60 grid grid-cols-2 gap-3">
                        {stats!.byModel.map((m) => {
                          const isGpt = m.model.toLowerCase().includes("gpt");
                          return (
                            <div key={m.model} className="rounded-xl bg-white/60 p-3">
                              <div className={`text-xs font-semibold mb-1 ${isGpt ? "text-violet-700" : "text-sky-700"}`}>
                                {m.model}
                              </div>
                              <div className="text-sm font-bold text-zinc-900">{fmt(m.revenue)}₽</div>
                              <div className="text-[10px] text-zinc-500">доход: {fmt(m.profit)}₽</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </div>

              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
