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

type UserSettings = {
  id: string;
  email: string | null;
  username: string | null;
  role: string;
  avitoClientId: string;
  hasAvitoClientSecret: boolean;
  avitoAccountId: number | null;
  aiInstructions: string;
  aiEscalatePrompt: string;
};

type KbFile = {
  id: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  chunksCount: number;
  created_at: number;
};

type AiSettings = {
  enabled: boolean;
  provider: string;
  hasApiKey: boolean;
  hasDeepseekApiKey: boolean;
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

  const {
    data: aiData,
  } = useSWR<{ ok: boolean; data: AiSettings }>("/api/ai-assistant", fetcher);

  const settings = settingsData?.data;
  const aiSettings = aiData?.data;
  const isAdmin = meData?.user?.role === "ADMIN";

  // Form state
  const [avitoClientId, setAvitoClientId] = useState("");
  const [avitoClientSecret, setAvitoClientSecret] = useState("");
  const [avitoClientSecretTouched, setAvitoClientSecretTouched] = useState(false);
  const [avitoAccountId, setAvitoAccountId] = useState("");
  const [aiInstructions, setAiInstructions] = useState("");
  const [aiEscalatePrompt, setAiEscalatePrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setAvitoClientId(settings.avitoClientId ?? "");
    setAvitoAccountId(settings.avitoAccountId ? String(settings.avitoAccountId) : "");
    setAiInstructions(settings.aiInstructions ?? "");
    setAiEscalatePrompt(settings.aiEscalatePrompt ?? "");
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
        aiInstructions,
        aiEscalatePrompt,
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
    avitoAccountId, aiInstructions, aiEscalatePrompt, mutateSettings,
  ]);

  // Knowledge base
  const hasDeepseek = aiSettings?.provider === "deepseek" && aiSettings?.hasDeepseekApiKey;
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-zinc-400">Загрузка...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">Личный кабинет</h1>
            <p className="text-sm text-zinc-500 mt-1">
              {settings.email ?? settings.username ?? "Пользователь"}
              {isAdmin && (
                <span className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                  Администратор
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                onClick={() => router.push("/ai-assistant")}
                className="rounded-xl bg-amber-100 px-4 py-2 text-sm font-medium text-amber-700 shadow-sm ring-1 ring-amber-900/10 hover:bg-amber-200/80"
              >
                AI Настройки
              </button>
            )}
            <button
              onClick={() => router.push("/")}
              className="rounded-xl bg-zinc-200/80 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm ring-1 ring-zinc-900/10 hover:bg-zinc-200/90"
            >
              Чаты
            </button>
            <button
              onClick={handleLogout}
              className="rounded-xl bg-zinc-200/80 px-4 py-2 text-sm font-medium text-zinc-500 shadow-sm ring-1 ring-zinc-900/10 hover:bg-zinc-200/90"
            >
              Выйти
            </button>
          </div>
        </div>

        {/* ── Настройки Avito API ── */}
        <section className="rounded-2xl bg-zinc-200/80 p-6 shadow-sm ring-1 ring-zinc-900/10">
          <h2 className="text-lg font-semibold text-zinc-900 mb-1">Настройки Avito API</h2>
          <p className="text-sm text-zinc-500 mb-4">
            Укажите ваши Avito API-ключи для интеграции с вашим аккаунтом Avito.
          </p>

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

        {/* ── Инструкция для ИИ ── */}
        <section className="mt-6 rounded-2xl bg-zinc-200/80 p-6 shadow-sm ring-1 ring-zinc-900/10">
          <h2 className="text-lg font-semibold text-zinc-900 mb-1">Инструкция для ИИ-ассистента</h2>
          <p className="text-sm text-zinc-500 mb-4">
            Персональная инструкция для ИИ при обработке ваших чатов. Если не задана — используется
            глобальная инструкция администратора.
          </p>

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

        {/* ── База знаний ── */}
        <section className="mt-6 rounded-2xl bg-zinc-200/80 p-6 shadow-sm ring-1 ring-zinc-900/10">
          <h2 className="text-lg font-semibold text-zinc-900 mb-1">База знаний</h2>
          <p className="text-sm text-zinc-500 mb-4">
            Загрузите файлы с информацией о ваших товарах, услугах или FAQ. ИИ будет использовать
            их при ответах на вопросы в ваших чатах.
            {!hasDeepseek && (
              <span className="block mt-1 text-amber-600">
                База знаний используется при работе с DeepSeek. Для OpenAI используйте Vector Store.
              </span>
            )}
          </p>

          {/* Upload */}
          <div className="flex items-center gap-3 mb-4">
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
            <div className="text-sm text-zinc-400">Загрузка...</div>
          ) : kbFiles.length === 0 ? (
            <div className="text-sm text-zinc-400">
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
  );
}
