// src/app/ai-assistant/page.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";

export const dynamic = "force-dynamic";

/* ─── helpers ───────────────────────────────────────────────── */

async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const r = await fetch(input, { ...init, credentials: "include" });
  if (r.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  return r;
}

const fetcher = (url: string) => apiFetch(url).then((r) => r.json());

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

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

/* ─── types ─────────────────────────────────────────────────── */

type AiSettings = {
  enabled: boolean;
  provider: string;
  apiKey: string | null;
  hasApiKey: boolean;
  deepseekApiKey: string | null;
  hasDeepseekApiKey: boolean;
  vectorStoreId: string;
  instructions: string;
  escalatePrompt: string;
  model: string;
};

type KbFile = {
  id: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  chunksCount: number;
  created_at: number;
};

/* ─── page ──────────────────────────────────────────────────── */

export default function AiAssistantPage() {
  const router = useRouter();

  const { data: meData } = useSWR<{ ok: boolean; user: { role: string } | null }>(
    "/api/auth/me",
    fetcher,
  );

  const {
    data: settingsData,
    mutate: mutateSettings,
  } = useSWR<{ ok: boolean; data: AiSettings }>("/api/ai-assistant", fetcher);

  const settings = settingsData?.data;
  const isAdmin = meData?.user?.role === "ADMIN";

  // Доступные модели по провайдеру
  const OPENAI_MODELS = [
    { value: "gpt-5.2", label: "GPT-5.2 Thinking" },
    { value: "gpt-5.2-chat-latest", label: "GPT-5.2 Instant" },
    { value: "gpt-4.1", label: "GPT-4.1" },
    { value: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { value: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "o3-mini", label: "o3-mini" },
  ];

  const DEEPSEEK_MODELS = [
    { value: "deepseek-chat", label: "DeepSeek Chat (V3)" },
    { value: "deepseek-reasoner", label: "DeepSeek Reasoner (R1)" },
  ];

  // Form state
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<"openai" | "deepseek">("openai");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyTouched, setApiKeyTouched] = useState(false);
  const [deepseekApiKey, setDeepseekApiKey] = useState("");
  const [deepseekApiKeyTouched, setDeepseekApiKeyTouched] = useState(false);
  const [vectorStoreId, setVectorStoreId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [escalatePrompt, setEscalatePrompt] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [showAdminMenu, setShowAdminMenu] = useState(false);

  // Sync form when settings loaded
  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.enabled);
    setProvider((settings.provider as "openai" | "deepseek") ?? "openai");
    setVectorStoreId(settings.vectorStoreId);
    setInstructions(settings.instructions);
    setEscalatePrompt(settings.escalatePrompt);
    setModel(settings.model);
    setApiKey("");
    setApiKeyTouched(false);
    setDeepseekApiKey("");
    setDeepseekApiKeyTouched(false);
  }, [settings]);

  // Files — для DeepSeek (локальная база знаний)
  const hasDeepseekKb = !!(provider === "deepseek" && settings?.hasDeepseekApiKey);
  const {
    data: kbFilesData,
    mutate: mutateKbFiles,
    isLoading: kbFilesLoading,
  } = useSWR<{ ok: boolean; files: KbFile[] }>(
    hasDeepseekKb ? "/api/ai-assistant/deepseek-files" : null,
    fetcher,
  );
  const kbFiles = kbFilesData?.ok ? kbFilesData.files : [];

  const [kbUploading, setKbUploading] = useState(false);
  const [kbDeletingId, setKbDeletingId] = useState<string | null>(null);
  const [kbFileError, setKbFileError] = useState<string | null>(null);
  const kbFileInputRef = useRef<HTMLInputElement>(null);

  const activeModels = provider === "deepseek" ? DEEPSEEK_MODELS : OPENAI_MODELS;

  /* ─── handlers ──────────────────────────────────────────── */

  const saveSettings = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload: Record<string, unknown> = {
        enabled,
        provider,
        vectorStoreId,
        instructions,
        escalatePrompt,
        model,
      };
      if (apiKeyTouched && apiKey) {
        payload.apiKey = apiKey;
      }
      if (deepseekApiKeyTouched && deepseekApiKey) {
        payload.deepseekApiKey = deepseekApiKey;
      }

      const r = await apiFetch("/api/ai-assistant", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (j.ok) {
        setSaveMsg("Сохранено");
        mutateSettings();
      } else {
        setSaveMsg("Ошибка: " + (j.error || "неизвестная"));
      }
    } catch {
      setSaveMsg("Ошибка сети");
    } finally {
      setSaving(false);
    }
  }, [
    enabled, provider, apiKey, apiKeyTouched,
    deepseekApiKey, deepseekApiKeyTouched,
    vectorStoreId, instructions, escalatePrompt, model, mutateSettings,
  ]);

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

  /* ─── render ────────────────────────────────────────────── */

  if (!settings || meData === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-zinc-400 font-geist">Загрузка...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-zinc-900/10 text-center">
          <div className="h-12 w-12 bg-green-400 rounded-full flex items-center justify-center mx-auto mb-4">
            <IconSparkles className="h-5 w-5 text-zinc-900" />
          </div>
          <div className="text-lg font-semibold text-zinc-900 mb-2 font-geist">Только для администраторов</div>
          <p className="text-sm text-zinc-500 mb-4">
            Управление настройками ИИ доступно только администраторам платформы.
            Для настройки ваших инструкций и базы знаний перейдите в личный кабинет.
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-700 transition-colors"
          >
            Перейти в личный кабинет
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="min-h-screen p-0 sm:p-2 lg:p-5 flex flex-col">
        <div className="mx-auto w-full max-w-7xl flex-1 flex flex-col bg-white rounded-none sm:rounded-2xl lg:rounded-[30px] shadow-none sm:shadow-2xl overflow-hidden">

          {/* ── Header ── */}
          <header className="border-b border-zinc-100 px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 md:py-4 flex items-center justify-between shrink-0 gap-2">
            {/* Left: logo + page label */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 sm:h-8 sm:w-8 flex bg-green-400 rounded-full items-center justify-center shrink-0">
                <IconSparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-zinc-900" />
              </div>
              <span className="text-base sm:text-lg tracking-tight font-medium font-geist">
                AITOCRM
              </span>
              <span className="hidden sm:inline-flex text-[10px] px-2 py-0.5 rounded-full bg-zinc-950 text-white font-medium font-geist">
                AI Ассистент
              </span>
              <span
                className={cn(
                  "hidden md:inline-flex text-[10px] px-2 py-0.5 rounded-full font-medium font-geist",
                  enabled ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"
                )}
              >
                {enabled ? "● Включён" : "○ Выключен"}
              </span>
            </div>

            {/* Right: nav */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                onClick={() => router.push("/dashboard")}
                className="px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-xs font-medium rounded-full bg-zinc-100 hover:bg-zinc-200 transition font-geist whitespace-nowrap"
              >
                Кабинет
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
                    <a href="/admin/billing/overview" className="block px-4 py-2 text-xs text-zinc-700 hover:bg-zinc-50 font-geist" onClick={() => setShowAdminMenu(false)}>Биллинг — Обзор</a>
                    <a href="/admin/billing/users" className="block px-4 py-2 text-xs text-zinc-700 hover:bg-zinc-50 font-geist" onClick={() => setShowAdminMenu(false)}>Биллинг — Пользователи</a>
                    <a href="/admin/billing/settings" className="block px-4 py-2 text-xs text-zinc-700 hover:bg-zinc-50 font-geist" onClick={() => setShowAdminMenu(false)}>Биллинг — Настройки</a>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* ── Content ── */}
          <div className="flex-1 overflow-y-auto p-4 md:p-8">
            <div className="mx-auto max-w-2xl">

              {/* Page title */}
              <div className="mb-6">
                <h1 className="text-2xl font-bold text-zinc-900 font-geist">AI Ассистент</h1>
                <p className="text-sm text-zinc-500 mt-1 font-geist">
                  Настройка ИИ-ассистента для ответов в чатах
                </p>
              </div>

              {/* ── Основные настройки ── */}
              <section className="rounded-2xl bg-zinc-200/80 p-6 shadow-sm ring-1 ring-zinc-900/10">
                <h2 className="text-lg font-semibold text-zinc-900 mb-4 font-geist">
                  Основные настройки
                </h2>

                {/* Переключатель вкл/выкл */}
                <div className="flex items-center justify-between py-3 border-b border-zinc-100">
                  <div>
                    <div className="text-sm font-medium text-zinc-700">
                      Ассистент включён
                    </div>
                    <div className="text-xs text-zinc-500">
                      Когда включено, ассистент будет отвечать в чатах со статусом BOT
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    onClick={() => setEnabled(!enabled)}
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                      enabled ? "bg-sky-600" : "bg-zinc-200",
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none inline-block h-5 w-5 rounded-full bg-zinc-100 shadow-sm ring-0 transition-transform",
                        enabled ? "translate-x-5" : "translate-x-0",
                      )}
                    />
                  </button>
                </div>

                {/* Провайдер API */}
                <div className="mt-4">
                  <span className="text-sm font-medium text-zinc-700 block mb-2">
                    Провайдер API
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setProvider("openai")}
                      className={cn(
                        "flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors",
                        provider === "openai"
                          ? "border-sky-500 bg-sky-50 text-sky-700"
                          : "border-zinc-300 bg-zinc-100/90 text-zinc-600 hover:bg-zinc-200/60",
                      )}
                    >
                      OpenAI
                    </button>
                    <button
                      type="button"
                      onClick={() => setProvider("deepseek")}
                      className={cn(
                        "flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors",
                        provider === "deepseek"
                          ? "border-sky-500 bg-sky-50 text-sky-700"
                          : "border-zinc-300 bg-zinc-100/90 text-zinc-600 hover:bg-zinc-200/60",
                      )}
                    >
                      DeepSeek
                    </button>
                  </div>
                </div>

                {/* OpenAI API Key */}
                {provider === "openai" && (
                  <label className="mt-4 block">
                    <span className="text-sm font-medium text-zinc-700">
                      OpenAI API Key
                    </span>
                    {settings.hasApiKey && !apiKeyTouched && (
                      <span className="ml-2 text-xs text-emerald-600">
                        (ключ установлен: {settings.apiKey})
                      </span>
                    )}
                    <input
                      type="password"
                      placeholder="sk-..."
                      value={apiKeyTouched ? apiKey : ""}
                      onChange={(e) => {
                        setApiKeyTouched(true);
                        setApiKey(e.target.value);
                      }}
                      className="mt-1 w-full rounded-xl border border-zinc-300 bg-zinc-100/90 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/25"
                    />
                    <span className="text-xs text-zinc-400">
                      Оставьте пустым, чтобы не менять
                    </span>
                  </label>
                )}

                {/* DeepSeek API Key */}
                {provider === "deepseek" && (
                  <label className="mt-4 block">
                    <span className="text-sm font-medium text-zinc-700">
                      DeepSeek API Key
                    </span>
                    {settings.hasDeepseekApiKey && !deepseekApiKeyTouched && (
                      <span className="ml-2 text-xs text-emerald-600">
                        (ключ установлен: {settings.deepseekApiKey})
                      </span>
                    )}
                    <input
                      type="password"
                      placeholder="sk-..."
                      value={deepseekApiKeyTouched ? deepseekApiKey : ""}
                      onChange={(e) => {
                        setDeepseekApiKeyTouched(true);
                        setDeepseekApiKey(e.target.value);
                      }}
                      className="mt-1 w-full rounded-xl border border-zinc-300 bg-zinc-100/90 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/25"
                    />
                    <span className="text-xs text-zinc-400">
                      Получить ключ можно на platform.deepseek.com. Оставьте пустым, чтобы не менять.
                    </span>
                  </label>
                )}

                {/* Model */}
                <label className="mt-4 block">
                  <span className="text-sm font-medium text-zinc-700">
                    Модель
                  </span>
                  <span className="ml-1 text-xs text-rose-500">*</span>
                  <input
                    type="text"
                    list="ai-models-list"
                    placeholder={
                      provider === "deepseek"
                        ? "deepseek-chat"
                        : "Введите название модели, например: gpt-4o"
                    }
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-zinc-300 bg-zinc-100/90 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/25"
                  />
                  <datalist id="ai-models-list">
                    {activeModels.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </datalist>
                  <span className="text-xs text-zinc-400">
                    Выберите из списка или введите название модели вручную
                  </span>
                </label>

                {/* Vector Store ID — только для OpenAI */}
                {provider === "openai" && (
                  <label className="mt-4 block">
                    <span className="text-sm font-medium text-zinc-700">
                      Vector Store ID
                    </span>
                    <input
                      type="text"
                      placeholder="vs_..."
                      value={vectorStoreId}
                      onChange={(e) => setVectorStoreId(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-zinc-300 bg-zinc-100/90 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/25"
                    />
                    <span className="text-xs text-zinc-400">
                      ID векторного хранилища OpenAI для поиска по базе знаний
                    </span>
                  </label>
                )}

                {/* Save */}
                <div className="mt-5 flex items-center gap-3">
                  <button
                    onClick={saveSettings}
                    disabled={saving}
                    className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50 hover:bg-sky-700 transition-colors"
                  >
                    {saving ? "Сохранение..." : "Сохранить"}
                  </button>
                  {saveMsg && (
                    <span
                      className={cn(
                        "text-sm",
                        saveMsg === "Сохранено"
                          ? "text-emerald-600"
                          : "text-rose-600",
                      )}
                    >
                      {saveMsg}
                    </span>
                  )}
                </div>
              </section>

              {/* ── База знаний DeepSeek ── */}
              {provider === "deepseek" && (
                <section className="mt-6 mb-6 rounded-2xl bg-zinc-200/80 p-6 shadow-sm ring-1 ring-zinc-900/10">
                  <h2 className="text-lg font-semibold text-zinc-900 mb-1 font-geist">
                    База знаний
                  </h2>
                  <p className="text-sm text-zinc-500 mb-4">
                    Загрузите файлы с информацией о товарах, услугах или FAQ.
                    При ответе ИИ автоматически найдёт и использует релевантные данные.
                    Поддерживаемые форматы: .txt, .md, .csv, .json, .yaml, .html
                  </p>

                  {!hasDeepseekKb ? (
                    <p className="text-sm text-zinc-500">
                      Сохраните DeepSeek API-ключ выше, чтобы управлять базой знаний.
                    </p>
                  ) : (
                    <>
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

                      {/* File list */}
                      {kbFilesLoading ? (
                        <div className="text-sm text-zinc-400 font-geist">Загрузка списка файлов...</div>
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
                                  <td className="py-2 pr-4 text-zinc-700">
                                    {f.filename}
                                  </td>
                                  <td className="py-2 pr-4 text-zinc-500">
                                    {formatBytes(f.fileSize)}
                                  </td>
                                  <td className="py-2 pr-4 text-zinc-500">
                                    <span className="inline-block rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                                      {f.chunksCount}
                                    </span>
                                  </td>
                                  <td className="py-2 pr-4 text-zinc-500">
                                    {formatDate(f.created_at)}
                                  </td>
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
                    </>
                  )}
                </section>
              )}

              {/* bottom spacing for last section when no DeepSeek/OpenAI */}
              {provider === "openai" && (
                <div className="mb-6" />
              )}

            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
