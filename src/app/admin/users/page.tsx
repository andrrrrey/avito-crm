// src/app/admin/users/page.tsx
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

function fmt(n: number) {
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function IconUsers({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

type AdminUser = {
  id: string;
  email: string | null;
  username: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
  balance: number;
};

type UsersData = {
  total: number;
  page: number;
  limit: number;
  pages: number;
  users: AdminUser[];
};

type BalanceModalState = {
  userId: string;
  displayName: string;
  currentBalance: number;
};

export default function AdminUsersPage() {
  const router = useRouter();

  const { data: meData } = useSWR<{ ok: boolean; user: { role: string; id: string } | null }>(
    "/api/auth/me",
    fetcher,
  );

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [showAdminMenu, setShowAdminMenu] = useState(false);

  const params = new URLSearchParams({ page: String(page), limit: "20" });
  if (search) params.set("search", search);

  const { data: usersData, isLoading, mutate } = useSWR<{ ok: boolean; data: UsersData }>(
    `/api/admin/users?${params}`,
    fetcher,
  );

  const isAdmin = meData?.user?.role === "ADMIN";

  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<string | null>(null);

  const runMigration = useCallback(async () => {
    setMigrating(true);
    setMigrateResult(null);
    try {
      const r = await apiFetch("/api/admin/migrate/fix-chat-accounts", { method: "POST" });
      const j = await r.json();
      if (j.ok) {
        setMigrateResult(`Готово: переназначено ${j.totalUpdated} чатов`);
      } else {
        setMigrateResult("Ошибка: " + (j.error || "неизвестная"));
      }
    } catch {
      setMigrateResult("Ошибка сети");
    } finally {
      setMigrating(false);
    }
  }, []);
  const data = usersData?.data;

  // Balance modal
  const [balanceModal, setBalanceModal] = useState<BalanceModalState | null>(null);
  const [balanceAmount, setBalanceAmount] = useState("");
  const [balanceDesc, setBalanceDesc] = useState("");
  const [balanceSaving, setBalanceSaving] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  // Action states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleSearch = useCallback(() => {
    setSearch(searchInput.trim());
    setPage(1);
  }, [searchInput]);

  const openBalanceModal = (user: AdminUser) => {
    setBalanceModal({
      userId: user.id,
      displayName: user.email ?? user.username ?? user.id.slice(0, 8),
      currentBalance: user.balance,
    });
    setBalanceAmount("");
    setBalanceDesc("");
    setBalanceError(null);
  };

  const closeBalanceModal = () => {
    setBalanceModal(null);
    setBalanceAmount("");
    setBalanceDesc("");
    setBalanceError(null);
  };

  const submitBalance = useCallback(async () => {
    if (!balanceModal) return;
    const amount = parseFloat(balanceAmount.replace(",", "."));
    if (!isFinite(amount) || amount === 0) {
      setBalanceError("Введите ненулевую сумму");
      return;
    }
    setBalanceSaving(true);
    setBalanceError(null);
    try {
      const r = await apiFetch(`/api/admin/users/${balanceModal.userId}/balance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount, description: balanceDesc || undefined }),
      });
      const j = await r.json();
      if (j.ok) {
        closeBalanceModal();
        mutate();
      } else {
        setBalanceError(j.error ?? "Ошибка");
      }
    } catch {
      setBalanceError("Ошибка сети");
    } finally {
      setBalanceSaving(false);
    }
  }, [balanceModal, balanceAmount, balanceDesc, mutate]);

  const toggleBlock = useCallback(async (user: AdminUser) => {
    const newStatus = !user.isActive;
    const action = newStatus ? "разблокировать" : "заблокировать";
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} пользователя ${user.email ?? user.username}?`)) return;
    setActionLoading(user.id + ":block");
    setActionError(null);
    try {
      const r = await apiFetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: newStatus }),
      });
      const j = await r.json();
      if (j.ok) {
        mutate();
      } else {
        setActionError(j.error ?? "Ошибка");
      }
    } catch {
      setActionError("Ошибка сети");
    } finally {
      setActionLoading(null);
    }
  }, [mutate]);

  const deleteUser = useCallback(async (user: AdminUser) => {
    const name = user.email ?? user.username ?? user.id.slice(0, 8);
    if (!confirm(`Удалить пользователя «${name}»? Это действие необратимо.`)) return;
    setActionLoading(user.id + ":delete");
    setActionError(null);
    try {
      const r = await apiFetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      const j = await r.json();
      if (j.ok) {
        mutate();
      } else {
        setActionError(j.error ?? "Ошибка");
      }
    } catch {
      setActionError("Ошибка сети");
    } finally {
      setActionLoading(null);
    }
  }, [mutate]);

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
        <div className="mx-auto w-full max-w-7xl flex-1 flex flex-col bg-white rounded-none sm:rounded-2xl lg:rounded-[30px] shadow-none sm:shadow-2xl overflow-hidden">

          {/* Header */}
          <header className="border-b border-zinc-100 px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 md:py-4 flex items-center justify-between shrink-0 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 sm:h-8 sm:w-8 flex bg-violet-400 rounded-full items-center justify-center shrink-0">
                <IconUsers className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-zinc-900" />
              </div>
              <span className="text-base sm:text-lg tracking-tight font-medium font-geist">AITOCRM</span>
              <span className="hidden sm:inline-flex text-[10px] px-2 py-0.5 rounded-full bg-zinc-950 text-white font-medium font-geist">
                Админка
              </span>
              <span className="hidden md:inline-flex text-[10px] px-2 py-0.5 rounded-full font-medium font-geist bg-zinc-100 text-zinc-500">
                Пользователи
              </span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                onClick={runMigration}
                disabled={migrating}
                title="Переназначить accountId у чатов по данным Avito API для каждого пользователя"
                className={`px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-xs font-medium rounded-full transition font-geist whitespace-nowrap ${migrating ? "opacity-50 pointer-events-none bg-amber-100 text-amber-700" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`}
              >
                {migrating ? "Миграция..." : "Исправить чаты"}
              </button>
              {migrateResult && (
                <span className={`text-[10px] font-geist ${migrateResult.startsWith("Готово") ? "text-emerald-600" : "text-rose-600"}`}>
                  {migrateResult}
                </span>
              )}
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
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-zinc-900 font-geist">Пользователи</h1>
              <p className="text-sm text-zinc-500 mt-1 font-geist">
                Управление пользователями: баланс, блокировка, удаление
              </p>
            </div>

            {/* Search */}
            <div className="flex flex-wrap gap-3 mb-6">
              <div className="flex gap-1">
                <input
                  type="text"
                  placeholder="Поиск по email или имени..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900 w-56"
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

            {actionError && (
              <div className="mb-4 rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 ring-1 ring-rose-700/10">
                {actionError}
              </div>
            )}

            {/* Table */}
            <div className="rounded-2xl bg-zinc-200/80 ring-1 ring-zinc-900/10 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-zinc-500 border-b border-zinc-300/60 bg-zinc-100/50">
                      <th className="px-4 py-3 font-medium">Пользователь</th>
                      <th className="px-4 py-3 font-medium">Роль</th>
                      <th className="px-4 py-3 font-medium">Статус</th>
                      <th className="px-4 py-3 font-medium text-right">Баланс</th>
                      <th className="px-4 py-3 font-medium">Зарегистрирован</th>
                      <th className="px-4 py-3 font-medium text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-zinc-400 text-sm">
                          Загрузка…
                        </td>
                      </tr>
                    ) : !data || data.users.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-zinc-400 text-sm">
                          {search ? "Пользователи не найдены" : "Нет пользователей"}
                        </td>
                      </tr>
                    ) : (
                      data.users.map((u, i) => (
                        <tr
                          key={u.id}
                          className={`border-b border-zinc-300/40 hover:bg-white/40 transition-colors ${
                            i % 2 === 0 ? "" : "bg-white/20"
                          } ${!u.isActive ? "opacity-60" : ""}`}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium text-zinc-800">
                              {u.email ?? u.username ?? u.id.slice(0, 8) + "…"}
                            </div>
                            {u.email && u.username && (
                              <div className="text-xs text-zinc-400">{u.username}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex text-[10px] px-2 py-0.5 rounded-full font-medium ${
                              u.role === "ADMIN"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-zinc-100 text-zinc-500"
                            }`}>
                              {u.role === "ADMIN" ? "Администратор" : "Пользователь"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex text-[10px] px-2 py-0.5 rounded-full font-medium ${
                              u.isActive
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-rose-100 text-rose-700"
                            }`}>
                              {u.isActive ? "Активен" : "Заблокирован"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-mono font-medium text-sm ${u.balance > 0 ? "text-sky-700" : u.balance < 0 ? "text-rose-600" : "text-zinc-400"}`}>
                              {fmt(u.balance)}₽
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-zinc-500">
                            {fmtDate(u.createdAt)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              <button
                                onClick={() => openBalanceModal(u)}
                                className="rounded-lg px-2.5 py-1 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 transition-colors whitespace-nowrap"
                              >
                                Баланс
                              </button>
                              <button
                                onClick={() => toggleBlock(u)}
                                disabled={actionLoading === u.id + ":block"}
                                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap disabled:opacity-50 ${
                                  u.isActive
                                    ? "text-amber-700 bg-amber-50 hover:bg-amber-100"
                                    : "text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                                }`}
                              >
                                {actionLoading === u.id + ":block" ? "…" : u.isActive ? "Заблокировать" : "Разблокировать"}
                              </button>
                              <button
                                onClick={() => deleteUser(u)}
                                disabled={actionLoading === u.id + ":delete"}
                                className="rounded-lg px-2.5 py-1 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 transition-colors whitespace-nowrap disabled:opacity-50"
                              >
                                {actionLoading === u.id + ":delete" ? "…" : "Удалить"}
                              </button>
                            </div>
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

      {/* Balance Modal */}
      {balanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-zinc-900/10">
            <h2 className="text-lg font-semibold text-zinc-900 mb-1 font-geist">Изменить баланс</h2>
            <p className="text-sm text-zinc-500 mb-4">
              {balanceModal.displayName} · Текущий баланс: <span className="font-mono font-medium text-zinc-900">{fmt(balanceModal.currentBalance)}₽</span>
            </p>

            <label className="block mb-3">
              <span className="text-xs font-medium text-zinc-700">
                Сумма (+ пополнение, − списание)
              </span>
              <input
                type="number"
                step="0.01"
                value={balanceAmount}
                onChange={(e) => setBalanceAmount(e.target.value)}
                placeholder="Например: 500 или -100"
                className="mt-1 w-full rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/25 font-mono"
                autoFocus
              />
            </label>

            <label className="block mb-4">
              <span className="text-xs font-medium text-zinc-700">Комментарий (необязательно)</span>
              <input
                type="text"
                value={balanceDesc}
                onChange={(e) => setBalanceDesc(e.target.value)}
                placeholder="Пополнение за март"
                className="mt-1 w-full rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/25"
              />
            </label>

            {balanceError && (
              <div className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-700/10">
                {balanceError}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={submitBalance}
                disabled={balanceSaving}
                className="flex-1 rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50 hover:bg-sky-700 transition-colors"
              >
                {balanceSaving ? "Сохранение..." : "Применить"}
              </button>
              <button
                onClick={closeBalanceModal}
                disabled={balanceSaving}
                className="flex-1 rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
