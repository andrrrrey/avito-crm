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

/* ─── types ─────────────────────────────────────────────────── */

type AiSettings = {
  enabled: boolean;
  apiKey: string | null;
  hasApiKey: boolean;
  assistantId: string;
  vectorStoreId: string;
  instructions: string;
};

type VsFile = {
  id: string;
  filename?: string;
  bytes?: number;
  status: string;
  created_at: number;
};

/* ─── page ──────────────────────────────────────────────────── */

export default function AiAssistantPage() {
  const router = useRouter();

  // Settings
  const {
    data: settingsData,
    mutate: mutateSettings,
  } = useSWR<{ ok: boolean; data: AiSettings }>("/api/ai-assistant", fetcher);

  const settings = settingsData?.data;

  // Form state
  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyTouched, setApiKeyTouched] = useState(false);
  const [assistantId, setAssistantId] = useState("");
  const [vectorStoreId, setVectorStoreId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Sync form when settings loaded
  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.enabled);
    setAssistantId(settings.assistantId);
    setVectorStoreId(settings.vectorStoreId);
    setInstructions(settings.instructions);
    setApiKey("");
    setApiKeyTouched(false);
  }, [settings]);

  // Files
  const hasVectorStore = !!(settings?.hasApiKey && settings?.vectorStoreId);
  const {
    data: filesData,
    mutate: mutateFiles,
    isLoading: filesLoading,
  } = useSWR<{ ok: boolean; files: VsFile[] }>(
    hasVectorStore ? "/api/ai-assistant/files" : null,
    fetcher,
  );
  const files = filesData?.ok ? filesData.files : [];

  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ─── handlers ──────────────────────────────────────────── */

  const saveSettings = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload: Record<string, unknown> = {
        enabled,
        assistantId,
        vectorStoreId,
        instructions,
      };
      if (apiKeyTouched && apiKey) {
        payload.apiKey = apiKey;
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
      } else if (j.error === "instructions_sync_failed") {
        setSaveMsg(j.message || "Не удалось синхронизировать инструкцию с OpenAI");
        mutateSettings();
      } else {
        setSaveMsg("Ошибка: " + (j.error || "неизвестная"));
      }
    } catch {
      setSaveMsg("Ошибка сети");
    } finally {
      setSaving(false);
    }
  }, [enabled, apiKey, apiKeyTouched, assistantId, vectorStoreId, instructions, mutateSettings]);

  const handleUpload = useCallback(async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setUploading(true);
    setFileError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);

      const r = await apiFetch("/api/ai-assistant/files", {
        method: "POST",
        body: fd,
      });
      const j = await r.json();
      if (j.ok) {
        mutateFiles();
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else {
        setFileError(j.error || "Ошибка загрузки");
      }
    } catch {
      setFileError("Ошибка сети");
    } finally {
      setUploading(false);
    }
  }, [mutateFiles]);

  const handleDelete = useCallback(
    async (fileId: string) => {
      if (!confirm("Удалить файл из Vector Store?")) return;
      setDeletingId(fileId);
      setFileError(null);
      try {
        const r = await apiFetch("/api/ai-assistant/files", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fileId }),
        });
        const j = await r.json();
        if (j.ok) {
          mutateFiles();
        } else {
          setFileError(j.error || "Ошибка удаления");
        }
      } catch {
        setFileError("Ошибка сети");
      } finally {
        setDeletingId(null);
      }
    },
    [mutateFiles],
  );

  /* ─── render ────────────────────────────────────────────── */

  if (!settings) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-400">Загрузка...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      {/* Header */}
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              AI Ассистент
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Настройка ChatGPT-ассистента для ответов в чатах
            </p>
          </div>
          <button
            onClick={() => router.push("/")}
            className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-900/10 hover:bg-slate-50"
          >
            Назад к чатам
          </button>
        </div>

        {/* ── Основные настройки ── */}
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-900/10">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            Основные настройки
          </h2>

          {/* Переключатель вкл/выкл */}
          <div className="flex items-center justify-between py-3 border-b border-slate-100">
            <div>
              <div className="text-sm font-medium text-slate-700">
                Ассистент включён
              </div>
              <div className="text-xs text-slate-500">
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
                enabled ? "bg-sky-600" : "bg-slate-200",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform",
                  enabled ? "translate-x-5" : "translate-x-0",
                )}
              />
            </button>
          </div>

          {/* API Key */}
          <label className="mt-4 block">
            <span className="text-sm font-medium text-slate-700">
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
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/30"
            />
            <span className="text-xs text-slate-400">
              Оставьте пустым, чтобы не менять
            </span>
          </label>

          {/* Assistant ID */}
          <label className="mt-4 block">
            <span className="text-sm font-medium text-slate-700">
              OpenAI Assistant ID
            </span>
            <input
              type="text"
              placeholder="asst_..."
              value={assistantId}
              onChange={(e) => setAssistantId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/30"
            />
          </label>

          {/* Vector Store ID */}
          <label className="mt-4 block">
            <span className="text-sm font-medium text-slate-700">
              Vector Store ID
            </span>
            <input
              type="text"
              placeholder="vs_..."
              value={vectorStoreId}
              onChange={(e) => setVectorStoreId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/30"
            />
          </label>

          {/* Instructions */}
          <label className="mt-4 block">
            <span className="text-sm font-medium text-slate-700">
              Инструкция для ассистента
            </span>
            <textarea
              rows={5}
              placeholder="Вы — вежливый помощник по продажам на Avito..."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/30 resize-y"
            />
          </label>

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

        {/* ── Файлы Vector Store ── */}
        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-900/10">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            Файлы Vector Store
          </h2>

          {!hasVectorStore ? (
            <p className="text-sm text-slate-500">
              Укажите API-ключ и Vector Store ID выше, чтобы управлять файлами.
            </p>
          ) : (
            <>
              {/* Upload */}
              <div className="flex items-center gap-3 mb-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-sky-700 hover:file:bg-sky-100"
                />
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50 hover:bg-sky-700 transition-colors"
                >
                  {uploading ? "Загрузка..." : "Загрузить"}
                </button>
              </div>

              {fileError && (
                <div className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-700/10">
                  {fileError}
                </div>
              )}

              {/* File list */}
              {filesLoading ? (
                <div className="text-sm text-slate-400">Загрузка списка файлов...</div>
              ) : files.length === 0 ? (
                <div className="text-sm text-slate-400">
                  Нет файлов в Vector Store
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-500">
                        <th className="py-2 pr-4 font-medium">Имя файла</th>
                        <th className="py-2 pr-4 font-medium">Размер</th>
                        <th className="py-2 pr-4 font-medium">Статус</th>
                        <th className="py-2 pr-4 font-medium">Дата</th>
                        <th className="py-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {files.map((f) => (
                        <tr
                          key={f.id}
                          className="border-b border-slate-50 hover:bg-slate-50/50"
                        >
                          <td className="py-2 pr-4 text-slate-700">
                            {f.filename || f.id}
                          </td>
                          <td className="py-2 pr-4 text-slate-500">
                            {formatBytes(f.bytes)}
                          </td>
                          <td className="py-2 pr-4">
                            <span
                              className={cn(
                                "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
                                f.status === "completed"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-amber-50 text-amber-700",
                              )}
                            >
                              {f.status}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-slate-500">
                            {formatDate(f.created_at)}
                          </td>
                          <td className="py-2">
                            <button
                              onClick={() => handleDelete(f.id)}
                              disabled={deletingId === f.id}
                              className="rounded-lg px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50 transition-colors"
                            >
                              {deletingId === f.id ? "..." : "Удалить"}
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
      </div>
    </div>
  );
}
