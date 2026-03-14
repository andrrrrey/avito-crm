// src/app/admin/billing/users/page.tsx
"use client";

import React, { useState, useCallback } from "react";
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

type UserStat = {
  userId: string;
  email: string | null;
  username: string | null;
  messages: number;
  avgPrice: number;
  revenue: number;
  cost: number;
  profit: number;
  balance: number;
};

type UsersData = {
  total: number;
  page: number;
  limit: number;
  pages: number;
  users: UserStat[];
};

const PERIOD_OPTIONS = [
  { label: "7 дней", value: 7 },
  { label: "30 дней", value: 30 },
  { label: "90 дней", value: 90 },
];

const MODEL_OPTIONS = [
  { label: "Все модели", value: "" },
  { label: "GPT-5.2", value: "gpt-5.2" },
  { label: "DeepSeek Chat", value: "deepseek-chat" },
];

export default function BillingUsersPage() {
  const router = useRouter();

  const { data: meData } = useSWR<{ ok: boolean; user: { role: string } | null }>("/api/auth/me", fetcher);

  const [days, setDays] = useState(30);
  const [model, setModel] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ days: String(days), page: String(page), limit: "20" });
  if (model) params.set("model", model);
  if (search) params.set("search", search);

  const { data: usersData, isLoading } = useSWR<{ ok: boolean; data: UsersData }>(
    `/api/admin/billing/users?${params}`,
    fetcher,
  );

  const isAdmin = meData?.user?.role === "ADMIN";
  const data = usersData?.data;

  const handleSearch = useCallback(() => {
    setSearch(searchInput.trim());
    setPage(1);
  }, [searchInput]);

  const handlePeriodChange = (d: number) => {
    setDays(d);
    setPage(1);
  };

  const handleModelChange = (m: string) => {
    setModel(m);
    setPage(1);
  };

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

  return (
    <div className="min-h-screen">
      <div className="min-h-screen p-0 sm:p-2 lg:p-5 flex flex-col">
        <div className="mx-auto w-full max-w-6xl flex-1 flex flex-col bg-white rounded-none sm:rounded-2xl lg:rounded-[30px] shadow-none sm:shadow-2xl overflow-hidden">

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
                Пользователи
              </span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                onClick={() => router.push("/admin/billing/overview")}
                className="px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-xs font-medium rounded-full bg-zinc-100 hover:bg-zinc-200 transition font-geist whitespace-nowrap"
              >
                Обзор
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
            </div>
          </header>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 md:p-8">
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-zinc-900 font-geist">Статистика по пользователям</h1>
              <p className="text-sm text-zinc-500 mt-1 font-geist">
                Расходы, доходы и балансы по каждому пользователю
              </p>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 mb-6">
              {/* Period */}
              <div className="flex items-center gap-1 rounded-xl bg-zinc-100 p-1">
                {PERIOD_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handlePeriodChange(opt.value)}
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

              {/* Model filter */}
              <select
                value={model}
                onChange={(e) => handleModelChange(e.target.value)}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900"
              >
                {MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>

              {/* Search */}
              <div className="flex gap-1">
                <input
                  type="text"
                  placeholder="Поиск по email..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900 w-48"
                />
                <button
                  onClick={handleSearch}
                  className="rounded-xl bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 transition"
                >
                  Найти
                </button>
                {search && (
                  <button
                    onClick={() => { setSearch(""); setSearchInput(""); setPage(1); }}
                    className="rounded-xl bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-200 transition"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="rounded-2xl bg-zinc-200/80 ring-1 ring-zinc-900/10 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-zinc-500 border-b border-zinc-300/60 bg-zinc-100/50">
                      <th className="px-4 py-3 font-medium">Пользователь</th>
                      <th className="px-4 py-3 font-medium text-right">AI сообщений</th>
                      <th className="px-4 py-3 font-medium text-right">Средняя цена</th>
                      <th className="px-4 py-3 font-medium text-right">Потрачено</th>
                      <th className="px-4 py-3 font-medium text-right">Себестоимость</th>
                      <th className="px-4 py-3 font-medium text-right">Наш доход</th>
                      <th className="px-4 py-3 font-medium text-right">Баланс</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-zinc-400 text-sm">
                          Загрузка…
                        </td>
                      </tr>
                    ) : !data || data.users.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-zinc-400 text-sm">
                          Нет данных за выбранный период
                        </td>
                      </tr>
                    ) : (
                      data.users.map((u, i) => (
                        <tr
                          key={u.userId}
                          className={`border-b border-zinc-300/40 hover:bg-white/40 transition-colors ${
                            i % 2 === 0 ? "" : "bg-white/20"
                          }`}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium text-zinc-800">
                              {u.email ?? u.username ?? u.userId.slice(0, 8) + "…"}
                            </div>
                            {u.email && u.username && (
                              <div className="text-xs text-zinc-400">{u.username}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-zinc-700">
                            {u.messages.toLocaleString("ru-RU")}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-zinc-700">
                            {fmt(u.avgPrice)}₽
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-semibold text-zinc-900">
                            {fmt(u.revenue)}₽
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-zinc-500">
                            {fmt(u.cost)}₽
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-emerald-700 font-semibold">
                            {fmt(u.profit)}₽
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-mono font-medium ${u.balance > 0 ? "text-sky-700" : "text-zinc-400"}`}>
                              {fmt(u.balance)}₽
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            {data && data.pages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <span className="text-xs text-zinc-500">
                  Всего {data.total} пользователей
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 rounded-xl text-xs font-medium bg-zinc-100 hover:bg-zinc-200 disabled:opacity-40 transition"
                  >
                    ←
                  </button>
                  <span className="text-xs text-zinc-600">
                    {page} / {data.pages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
                    disabled={page === data.pages}
                    className="px-3 py-1.5 rounded-xl text-xs font-medium bg-zinc-100 hover:bg-zinc-200 disabled:opacity-40 transition"
                  >
                    →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
