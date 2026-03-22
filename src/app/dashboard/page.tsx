// src/app/dashboard/page.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
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

function formatBytes(bytes: number | undefined) {
  if (!bytes) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function IconSparkles({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" />
    </svg>
  );
}

type UserSettings = {
  id: string;
  email: string | null;
  username: string | null;
  role: string;
  avitoClientId: string;
  hasAvitoClientSecret: boolean;
  avitoAccountId: number | null;
  aiEnabled: boolean;
  aiInstructions: string;
  aiEscalatePrompt: string;
  followupEnabled: boolean;
  followupMessage: string;
};

type BalanceData = {
  balance: number;
  transactions: {
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    description: string | null;
    createdAt: string;
  }[];
};

type KbFile = {
  id: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  chunksCount: number;
  created_at: number;
};

type AvitoAccountInfo = {
  id: number | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  totalItems: number | null;
};

export default function DashboardPage() {
  const router = useRouter();

  const { data: meData } = useSWR<{ ok: boolean; user: { role: string; email: string } | null }>(
    "/api/auth/me",
    fetcher,
  );

  const {
    data: settingsData,
    mutate: mutateSettings,
  } = useSWR<{ ok: boolean; data: UserSettings }>("/api/user/settings", fetcher);

  const { data: balanceData } = useSWR<{ ok: boolean; data: BalanceData }>(
    "/api/billing/balance",
    fetcher,
  );

  const {
    data: accountInfoData,
    mutate: mutateAccountInfo,
    isLoading: accountInfoLoading,
  } = useSWR<{ ok: boolean; data: AvitoAccountInfo }>(
    "/api/avito/account-info",
    fetcher,
    { shouldRetryOnError: false },
  );

  const settings = settingsData?.data;
  const isAdmin = meData?.user?.role === "ADMIN";
  const balance = balanceData?.data?.balance ?? null;

  // Form state
  const [avitoClientId, setAvitoClientId] = useState("");
  const [avitoClientSecret, setAvitoClientSecret] = useState("");
  const [avitoClientSecretTouched, setAvitoClientSecretTouched] = useState(false);
  const [avitoAccountId, setAvitoAccountId] = useState("");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiInstructions, setAiInstructions] = useState("");
  const [aiEscalatePrompt, setAiEscalatePrompt] = useState("");
  const [followupEnabled, setFollowupEnabled] = useState(true);
  const [followupMessage, setFollowupMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [generatingInstructions, setGeneratingInstructions] = useState(false);
  const [generateMsg, setGenerateMsg] = useState<string | null>(null);


  useEffect(() => {
    if (!settings) return;
    setAvitoClientId(settings.avitoClientId ?? "");
    setAvitoAccountId(settings.avitoAccountId ? String(settings.avitoAccountId) : "");
    setAiEnabled(settings.aiEnabled ?? true);
    setAiInstructions(settings.aiInstructions ?? "");
    setAiEscalatePrompt(settings.aiEscalatePrompt ?? "");
    setFollowupEnabled(settings.followupEnabled ?? true);
    setFollowupMessage(settings.followupMessage ?? "");
    setAvitoClientSecret("");
    setAvitoClientSecretTouched(false);
  }, [settings]);

  const saveSettings = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload: Record<string, unknown> = {
        avitoClientId,
        avitoAccountId: avitoAccountId ? Number(avitoAccountId) : null,
        aiEnabled,
        aiInstructions,
        aiEscalatePrompt,
        followupEnabled,
        followupMessage,
      };
      if (avitoClientSecretTouched && avitoClientSecret) {
        payload.avitoClientSecret = avitoClientSecret;
      }

      const r = await apiFetch("/api/user/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (j.ok) {
        setSaveMsg("Сохранено");
        mutateSettings();
        mutateAccountInfo();
      } else {
        setSaveMsg("Ошибка: " + (j.error || "неизвестная"));
      }
    } catch {
      setSaveMsg("Ошибка сети");
    } finally {
      setSaving(false);
    }
  }, [
    avitoClientId, avitoClientSecret, avitoClientSecretTouched,
    avitoAccountId, aiEnabled, aiInstructions, aiEscalatePrompt, followupEnabled, followupMessage, mutateSettings, mutateAccountInfo,
  ]);

  const generateInstructions = useCallback(async () => {
    setGeneratingInstructions(true);
    setGenerateMsg(null);
    try {
      const r = await apiFetch("/api/user/generate-instructions", { method: "POST" });
      const j = await r.json();
      if (j.ok) {
        setAiInstructions(j.instructions ?? "");
        if (j.escalatePrompt) setAiEscalatePrompt(j.escalatePrompt);
        setGenerateMsg(`Готово: сгенерировано по ${j.listingsCount} объявлениям. Нажмите «Сохранить» чтобы применить.`);
      } else {
        setGenerateMsg("Ошибка: " + (j.error || "неизвестная"));
      }
    } catch {
      setGenerateMsg("Ошибка сети");
    } finally {
      setGeneratingInstructions(false);
    }
  }, []);

  const syncChats = useCallback(async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await apiFetch("/api/avito/sync?fillPrices=1", { method: "POST" });
      const j = await r.json();
      if (j.ok) {
        const { totalChatsFetched, chatsDeleted, totalChatsInDb } = j.stats ?? {};
        const deletedNote = (chatsDeleted ?? 0) > 0 ? `, удалено ${chatsDeleted} устаревших` : "";
        setSyncMsg(`Готово: получено ${totalChatsFetched ?? 0} из Avito, всего в базе ${totalChatsInDb ?? 0} чатов${deletedNote}`);
      } else {
        setSyncMsg("Ошибка: " + (j.error || "неизвестная"));
      }
    } catch {
      setSyncMsg("Ошибка сети");
    } finally {
      setSyncing(false);
    }
  }, []);

  // Knowledge base
  const {
    data: kbFilesData,
    mutate: mutateKbFiles,
    isLoading: kbFilesLoading,
  } = useSWR<{ ok: boolean; files: KbFile[] }>(
    "/api/ai-assistant/deepseek-files",
    fetcher,
  );
  const kbFiles = kbFilesData?.ok ? kbFilesData.files : [];

  const [kbUploading, setKbUploading] = useState(false);
  const [kbDeletingId, setKbDeletingId] = useState<string | null>(null);
  const [kbFileError, setKbFileError] = useState<string | null>(null);
  const kbFileInputRef = useRef<HTMLInputElement>(null);

  const handleKbUpload = useCallback(async () => {
    const file = kbFileInputRef.current?.files?.[0];
    if (!file) return;

    setKbUploading(true);
    setKbFileError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);

      const r = await apiFetch("/api/ai-assistant/deepseek-files", {
        method: "POST",
        body: fd,
      });
      const j = await r.json();
      if (j.ok) {
        mutateKbFiles();
        if (kbFileInputRef.current) kbFileInputRef.current.value = "";
      } else {
        setKbFileError(j.error || "Ошибка загрузки");
      }
    } catch {
      setKbFileError("Ошибка сети");
    } finally {
      setKbUploading(false);
    }
  }, [mutateKbFiles]);

  const handleKbDelete = useCallback(
    async (fileId: string) => {
      if (!confirm("Удалить файл из базы знаний?")) return;
      setKbDeletingId(fileId);
      setKbFileError(null);
      try {
        const r = await apiFetch("/api/ai-assistant/deepseek-files", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fileId }),
        });
        const j = await r.json();
        if (j.ok) {
          mutateKbFiles();
        } else {
          setKbFileError(j.error || "Ошибка удаления");
        }
      } catch {
        setKbFileError("Ошибка сети");
      } finally {
        setKbDeletingId(null);
      }
    },
    [mutateKbFiles],
  );

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (!settings) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-cover bg-center"
        style={{
          backgroundImage:
            "url('https://hoirqrkdgbmvpwutwuwj.supabase.co/storage/v1/object/public/assets/assets/8e249747-11d9-4c29-9017-590f07779c2e_3840w.jpg')",
          backgroundColor: "#e4e4e7",
        }}
      >
        <div className="text-zinc-400 font-geist">Загрузка...</div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen"
    >
      <div className="min-h-screen p-0 sm:p-2 lg:p-5 flex flex-col">
        <div className="mx-auto w-full max-w-7xl flex-1 flex flex-col bg-white rounded-none sm:rounded-2xl lg:rounded-[30px] shadow-none sm:shadow-2xl overflow-hidden">

          {/* ── Header ── */}
          <header className="border-b border-zinc-100 px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 md:py-4 flex items-center justify-between shrink-0 gap-2">
            {/* Left: logo + user info */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 sm:h-8 sm:w-8 flex bg-green-400 rounded-full items-center justify-center shrink-0">
                <IconSparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-zinc-900" />
              </div>
              <span className="text-base sm:text-lg tracking-tight font-medium font-geist">
                AITOCRM
              </span>
              <span className="hidden sm:inline-flex text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 font-medium font-geist truncate max-w-[160px]">
                {settings.email ?? settings.username ?? "Пользователь"}
              </span>
              {isAdmin && (
                <span className="hidden md:inline-flex text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium font-geist">
                  Администратор
                </span>
              )}
            </div>

            {/* Right: nav */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                onClick={() => router.push("/")}
                className="px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-xs font-medium rounded-full bg-zinc-100 hover:bg-zinc-200 transition font-geist whitespace-nowrap"
              >
                Чаты
              </button>
              <button
                onClick={handleLogout}
                className="px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-xs font-medium rounded-full bg-zinc-100 text-zinc-500 hover:bg-zinc-200 transition font-geist whitespace-nowrap"
              >
                Выйти
              </button>
              {isAdmin && (
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
              )}
            </div>
          </header>

          {/* ── Content ── */}
          <div className="flex-1 overflow-y-auto p-4 md:p-8">
            <div className="mx-auto max-w-2xl">

              {/* Page title */}
              <div className="mb-6">
                <h1 className="text-2xl font-bold text-zinc-900 font-geist">Личный кабинет</h1>
                <p className="text-sm text-zinc-500 mt-1 font-geist">
                  Настройки вашего аккаунта и интеграций
                </p>
              </div>

              {/* ── Баланс ── */}
              <section className="mb-6 rounded-2xl bg-zinc-200/80 p-6 shadow-sm ring-1 ring-zinc-900/10">
                <h2 className="text-lg font-semibold text-zinc-900 mb-1 font-geist">Баланс</h2>
                <p className="text-sm text-zinc-500 mb-4">
                  Ваш текущий баланс для оплаты AI-запросов.
                </p>
                <div className="flex items-end gap-3">
                  <span className="text-4xl font-bold font-geist tabular-nums text-zinc-900">
                    {balance === null ? (
                      <span className="text-zinc-300">—</span>
                    ) : (
                      balance.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    )}
                  </span>
                  <span className="text-2xl font-medium text-zinc-400 mb-0.5">₽</span>
                </div>
                {balance !== null && balance <= 0 && (
                  <p className="mt-2 text-sm text-rose-600 font-medium">
                    Баланс исчерпан — AI-ассистент недоступен. Пополните баланс у администратора.
                  </p>
                )}
              </section>

              {/* ── Настройки Avito API ── */}
              <section className="rounded-2xl bg-zinc-200/80 p-6 shadow-sm ring-1 ring-zinc-900/10">
                <h2 className="text-lg font-semibold text-zinc-900 mb-1 font-geist">Настройки Avito API</h2>
                <p className="text-sm text-zinc-500 mb-4">
                  Укажите ваши Avito API-ключи для интеграции с вашим аккаунтом Avito.
                </p>

                {/* Avito account info card */}
                {accountInfoLoading && (
                  <div className="mb-4 rounded-xl bg-zinc-100 px-4 py-3 text-sm text-zinc-400 font-geist">
                    Загрузка данных аккаунта Avito...
                  </div>
                )}
                {!accountInfoLoading && accountInfoData?.ok && accountInfoData.data && (
                  <div className="mb-5 rounded-xl bg-white ring-1 ring-zinc-200 px-4 py-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-semibold text-zinc-700 font-geist">Аккаунт Avito</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium font-geist">Подключён</span>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      {accountInfoData.data.name && (
                        <>
                          <dt className="text-zinc-500">Имя</dt>
                          <dd className="text-zinc-800 font-medium truncate">{accountInfoData.data.name}</dd>
                        </>
                      )}
                      {accountInfoData.data.id && (
                        <>
                          <dt className="text-zinc-500">ID аккаунта</dt>
                          <dd className="text-zinc-800 font-medium tabular-nums">{accountInfoData.data.id}</dd>
                        </>
                      )}
                      {accountInfoData.data.email && (
                        <>
                          <dt className="text-zinc-500">Email</dt>
                          <dd className="text-zinc-800 font-medium truncate">{accountInfoData.data.email}</dd>
                        </>
                      )}
                      {accountInfoData.data.phone && (
                        <>
                          <dt className="text-zinc-500">Телефон</dt>
                          <dd className="text-zinc-800 font-medium">{accountInfoData.data.phone}</dd>
                        </>
                      )}
                      <dt className="text-zinc-500">Объявлений</dt>
                      <dd className="text-zinc-800 font-semibold tabular-nums">
                        {accountInfoData.data.totalItems !== null
                          ? accountInfoData.data.totalItems.toLocaleString("ru-RU")
                          : <span className="text-zinc-400">—</span>
                        }
                      </dd>
                    </dl>
                  </div>
                )}

                <label className="block">
                  <span className="text-sm font-medium text-zinc-700">Avito Client ID</span>
                  <input
                    type="text"
                    value={avitoClientId}
                    onChange={(e) => setAvitoClientId(e.target.value)}
                    placeholder="Ваш Client ID из кабинета разработчика Avito"
                    className="mt-1 w-full rounded-xl border border-zinc-300 bg-zinc-100/90 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/25"
                  />
                </label>

                <label className="mt-3 block">
                  <span className="text-sm font-medium text-zinc-700">Avito Client Secret</span>
                  {settings.hasAvitoClientSecret && !avitoClientSecretTouched && (
                    <span className="ml-2 text-xs text-emerald-600">(ключ установлен)</span>
                  )}
                  <input
                    type="password"
                    value={avitoClientSecretTouched ? avitoClientSecret : ""}
                    onChange={(e) => {
                      setAvitoClientSecretTouched(true);
                      setAvitoClientSecret(e.target.value);
                    }}
                    placeholder="Оставьте пустым, чтобы не менять"
                    className="mt-1 w-full rounded-xl border border-zinc-300 bg-zinc-100/90 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/25"
                  />
                </label>

                <label className="mt-3 block">
                  <span className="text-sm font-medium text-zinc-700">Avito Account ID</span>
                  <input
                    type="number"
                    value={avitoAccountId}
                    onChange={(e) => setAvitoAccountId(e.target.value)}
                    placeholder="Числовой ID вашего аккаунта Avito"
                    className="mt-1 w-full rounded-xl border border-zinc-300 bg-zinc-100/90 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/25"
                  />
                  <span className="text-xs text-zinc-400">
                    Найти можно в личном кабинете Avito или через API
                  </span>
                </label>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    onClick={saveSettings}
                    disabled={saving}
                    className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50 hover:bg-sky-700 transition-colors"
                  >
                    {saving ? "Сохранение..." : "Сохранить"}
                  </button>
                  <button
                    onClick={syncChats}
                    disabled={syncing}
                    className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50 hover:bg-emerald-700 transition-colors"
                  >
                    {syncing ? "Синхронизация..." : "Синхронизировать чаты"}
                  </button>
                  {saveMsg && (
                    <span className={saveMsg === "Сохранено" ? "text-sm text-emerald-600" : "text-sm text-rose-600"}>
                      {saveMsg}
                    </span>
                  )}
                  {syncMsg && (
                    <span className={syncMsg.startsWith("Готово") ? "text-sm text-emerald-600" : "text-sm text-rose-600"}>
                      {syncMsg}
                    </span>
                  )}
                </div>
              </section>

              {/* ── ИИ-ассистент (вкл/выкл + инструкции) ── */}
              <section className="mt-6 rounded-2xl bg-zinc-200/80 p-6 shadow-sm ring-1 ring-zinc-900/10">
                <h2 className="text-lg font-semibold text-zinc-900 mb-1 font-geist">ИИ-ассистент</h2>
                <p className="text-sm text-zinc-500 mb-4">
                  Управление ИИ-ассистентом для ваших чатов.
                </p>

                {/* Переключатель вкл/выкл ИИ */}
                <div className="flex items-center justify-between py-3 border-b border-zinc-200 mb-4">
                  <div>
                    <div className="text-sm font-medium text-zinc-700">ИИ-ассистент включён</div>
                    <div className="text-xs text-zinc-500">
                      Когда выключено, ИИ не будет отвечать ни в одном из ваших чатов
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={aiEnabled}
                    onClick={() => setAiEnabled((v) => !v)}
                    className={[
                      "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200",
                      aiEnabled ? "bg-sky-600" : "bg-zinc-300",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200",
                        aiEnabled ? "translate-x-5" : "translate-x-0",
                      ].join(" ")}
                    />
                  </button>
                </div>

                {/* Персональные инструкции для ИИ */}
                <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-zinc-700 font-geist">Инструкция для ИИ-ассистента</h3>
                  <button
                    onClick={generateInstructions}
                    disabled={generatingInstructions}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm disabled:opacity-50 hover:bg-violet-700 transition-colors shrink-0"
                  >
                    <IconSparkles className="h-3.5 w-3.5" />
                    {generatingInstructions ? "Генерация..." : "Сгенерировать из моих объявлений"}
                  </button>
                </div>
                <p className="text-sm text-zinc-500 mb-3">
                  Персональная инструкция для ИИ при обработке ваших чатов. Если не задана — используется
                  глобальная инструкция администратора.
                </p>
                {generateMsg && (
                  <div className={[
                    "mb-3 rounded-xl px-3 py-2 text-sm ring-1",
                    generateMsg.startsWith("Готово")
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-700/10"
                      : "bg-rose-50 text-rose-700 ring-rose-700/10",
                  ].join(" ")}>
                    {generateMsg}
                  </div>
                )}

                <textarea
                  rows={6}
                  placeholder="Вы — вежливый помощник по продажам. Отвечайте кратко и по делу..."
                  value={aiInstructions}
                  onChange={(e) => setAiInstructions(e.target.value)}
                  className="w-full rounded-xl border border-zinc-300 bg-zinc-100/90 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/25 resize-y"
                />

                <div className="mt-3">
                  <h3 className="text-sm font-medium text-zinc-700 mb-1">
                    Промпт переключения на менеджера
                  </h3>
                  <p className="text-xs text-zinc-500 mb-2">
                    Инструкция когда переводить на менеджера. Если пусто — используется стандартная.
                  </p>
                  <textarea
                    rows={4}
                    placeholder="Переводи на менеджера если клиент недоволен или просит живого оператора..."
                    value={aiEscalatePrompt}
                    onChange={(e) => setAiEscalatePrompt(e.target.value)}
                    className="w-full rounded-xl border border-zinc-300 bg-zinc-100/90 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/25 resize-y font-mono"
                  />
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={saveSettings}
                    disabled={saving}
                    className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50 hover:bg-sky-700 transition-colors"
                  >
                    {saving ? "Сохранение..." : "Сохранить"}
                  </button>
                  {saveMsg && (
                    <span className={saveMsg === "Сохранено" ? "text-sm text-emerald-600" : "text-sm text-rose-600"}>
                      {saveMsg}
                    </span>
                  )}
                </div>
              </section>

              {/* ── Дожим бота ── */}
              <section className="mt-6 rounded-2xl bg-zinc-200/80 p-6 shadow-sm ring-1 ring-zinc-900/10">
                <h2 className="text-lg font-semibold text-zinc-900 mb-1 font-geist">Дожим ИИ-ботом</h2>
                <p className="text-sm text-zinc-500 mb-4">
                  Если включено, бот автоматически отправляет сообщение-напоминание
                  клиентам, которые не ответили в течение 1 часа.
                </p>

                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={followupEnabled}
                    onClick={() => setFollowupEnabled((v) => !v)}
                    className={[
                      "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200",
                      followupEnabled ? "bg-sky-600" : "bg-zinc-300",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200",
                        followupEnabled ? "translate-x-5" : "translate-x-0",
                      ].join(" ")}
                    />
                  </button>
                  <span className="text-sm font-medium text-zinc-700">
                    {followupEnabled ? "Дожим включён" : "Дожим отключён"}
                  </span>
                </label>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-zinc-700 mb-1">
                    Фраза сообщения
                  </label>
                  <input
                    type="text"
                    value={followupMessage}
                    onChange={(e) => setFollowupMessage(e.target.value)}
                    placeholder="Актуален ли ваш заказ?"
                    className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                  <p className="mt-1 text-xs text-zinc-400">
                    По умолчанию: «Актуален ли ваш заказ?»
                  </p>
                </div>

                <div className="mt-5 flex items-center gap-3">
                  <button
                    onClick={saveSettings}
                    disabled={saving}
                    className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50 hover:bg-sky-700 transition-colors"
                  >
                    {saving ? "Сохранение..." : "Сохранить"}
                  </button>
                  {saveMsg && (
                    <span className={saveMsg === "Сохранено" ? "text-sm text-emerald-600" : "text-sm text-rose-600"}>
                      {saveMsg}
                    </span>
                  )}
                </div>
              </section>

              {/* ── База знаний ── */}
              <section className="mt-6 mb-6 rounded-2xl bg-zinc-200/80 p-6 shadow-sm ring-1 ring-zinc-900/10">
                <h2 className="text-lg font-semibold text-zinc-900 mb-1 font-geist">База знаний</h2>
                <p className="text-sm text-zinc-500 mb-4">
                  Загрузите файлы с информацией о ваших товарах, услугах или FAQ. ИИ будет использовать
                  их при ответах на вопросы в ваших чатах.
                </p>

                {/* Upload */}
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <input
                    ref={kbFileInputRef}
                    type="file"
                    accept=".txt,.md,.csv,.json,.yaml,.yml,.html,.htm"
                    className="text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-sky-700 hover:file:bg-sky-100"
                  />
                  <button
                    onClick={handleKbUpload}
                    disabled={kbUploading}
                    className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50 hover:bg-sky-700 transition-colors"
                  >
                    {kbUploading ? "Загрузка..." : "Загрузить"}
                  </button>
                </div>

                {kbFileError && (
                  <div className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-700/10">
                    {kbFileError}
                  </div>
                )}

                <p className="text-xs text-zinc-400 mb-3">
                  Поддерживаемые форматы: .txt, .md, .csv, .json, .yaml, .html
                </p>

                {kbFilesLoading ? (
                  <div className="text-sm text-zinc-400 font-geist">Загрузка...</div>
                ) : kbFiles.length === 0 ? (
                  <div className="text-sm text-zinc-400 font-geist">
                    База знаний пуста. Загрузите файлы выше.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead>
                        <tr className="border-b border-zinc-100 text-zinc-500">
                          <th className="py-2 pr-4 font-medium">Имя файла</th>
                          <th className="py-2 pr-4 font-medium">Размер</th>
                          <th className="py-2 pr-4 font-medium">Чанков</th>
                          <th className="py-2 pr-4 font-medium">Дата</th>
                          <th className="py-2 font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {kbFiles.map((f) => (
                          <tr
                            key={f.id}
                            className="border-b border-zinc-200/70 hover:bg-zinc-200/50"
                          >
                            <td className="py-2 pr-4 text-zinc-700">{f.filename}</td>
                            <td className="py-2 pr-4 text-zinc-500">{formatBytes(f.fileSize)}</td>
                            <td className="py-2 pr-4 text-zinc-500">
                              <span className="inline-block rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                                {f.chunksCount}
                              </span>
                            </td>
                            <td className="py-2 pr-4 text-zinc-500">{formatDate(f.created_at)}</td>
                            <td className="py-2">
                              <button
                                onClick={() => handleKbDelete(f.id)}
                                disabled={kbDeletingId === f.id}
                                className="rounded-lg px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50 transition-colors"
                              >
                                {kbDeletingId === f.id ? "..." : "Удалить"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
