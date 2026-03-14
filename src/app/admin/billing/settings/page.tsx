// src/app/admin/billing/settings/page.tsx
"use client";

import React, { useCallback, useEffect, useState } from "react";
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

type BillingConfig = {
  markupMultiplier: number;
  usdToRub: number;
  gpt52InputPrice: number;
  gpt52OutputPrice: number;
  deepseekInputPrice: number;
  deepseekOutputPrice: number;
  updatedAt: string;
  modelStats: { model: string; messages: number; avgCostRub: number; avgChargedRub: number }[];
};

export default function BillingSettingsPage() {
  const router = useRouter();

  const { data: meData } = useSWR<{ ok: boolean; user: { role: string } | null }>("/api/auth/me", fetcher);
  const { data: configData, mutate } = useSWR<{ ok: boolean; data: BillingConfig }>("/api/admin/billing/config", fetcher);

  const isAdmin = meData?.user?.role === "ADMIN";
  const config = configData?.data;

  const [markup, setMarkup] = useState("");
  const [usdToRub, setUsdToRub] = useState("");
  const [gptInput, setGptInput] = useState("");
  const [gptOutput, setGptOutput] = useState("");
  const [dsInput, setDsInput] = useState("");
  const [dsOutput, setDsOutput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!config) return;
    setMarkup(String(config.markupMultiplier));
    setUsdToRub(String(config.usdToRub));
    setGptInput(String(config.gpt52InputPrice));
    setGptOutput(String(config.gpt52OutputPrice));
    setDsInput(String(config.deepseekInputPrice));
    setDsOutput(String(config.deepseekOutputPrice));
  }, [config]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await apiFetch("/api/admin/billing/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          markupMultiplier: parseFloat(markup),
          usdToRub: parseFloat(usdToRub),
          gpt52InputPrice: parseFloat(gptInput),
          gpt52OutputPrice: parseFloat(gptOutput),
          deepseekInputPrice: parseFloat(dsInput),
          deepseekOutputPrice: parseFloat(dsOutput),
        }),
      });
      const j = await r.json();
      if (j.ok) {
        setSaveMsg("Сохранено");
        mutate();
      } else {
        setSaveMsg("Ошибка: " + (j.error || "неизвестная"));
      }
    } catch {
      setSaveMsg("Ошибка сети");
    } finally {
      setSaving(false);
    }
  }, [markup, usdToRub, gptInput, gptOutput, dsInput, dsOutput, mutate]);

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

  // Расчёт средней стоимости сообщения по текущим настройкам
  const markupVal = parseFloat(markup) || 2.5;
  const usdVal = parseFloat(usdToRub) || 90;
  const gptInputVal = parseFloat(gptInput) || 15;
  const gptOutputVal = parseFloat(gptOutput) || 60;
  const dsInputVal = parseFloat(dsInput) || 0.27;
  const dsOutputVal = parseFloat(dsOutput) || 1.1;

  // Средняя стоимость для типичного сообщения: 500 input + 200 output токенов
  const avgIn = 500, avgOut = 200;
  const gptCost = (avgIn * gptInputVal / 1_000_000 + avgOut * gptOutputVal / 1_000_000) * usdVal;
  const gptCharged = gptCost * markupVal;
  const dsCost = (avgIn * dsInputVal / 1_000_000 + avgOut * dsOutputVal / 1_000_000) * usdVal;
  const dsCharged = dsCost * markupVal;

  const modelStatsMap = Object.fromEntries((config?.modelStats ?? []).map((s) => [s.model, s]));

  return (
    <div className="min-h-screen">
      <div className="min-h-screen p-0 sm:p-2 lg:p-5 flex flex-col">
        <div className="mx-auto w-full max-w-4xl flex-1 flex flex-col bg-white rounded-none sm:rounded-2xl lg:rounded-[30px] shadow-none sm:shadow-2xl overflow-hidden">

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
                Настройки
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
                onClick={() => router.push("/admin/billing/users")}
                className="px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] sm:text-xs font-medium rounded-full bg-zinc-100 hover:bg-zinc-200 transition font-geist whitespace-nowrap"
              >
                Пользователи
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
            <div className="mx-auto max-w-2xl space-y-6">
              <div className="mb-6">
                <h1 className="text-2xl font-bold text-zinc-900 font-geist">Настройки биллинга</h1>
                <p className="text-sm text-zinc-500 mt-1 font-geist">
                  Наценка, курс валют и цены провайдеров AI
                </p>
              </div>

              {/* Наценка и курс */}
              <section className="rounded-2xl bg-zinc-200/80 p-6 shadow-sm ring-1 ring-zinc-900/10">
                <h2 className="text-lg font-semibold text-zinc-900 mb-4 font-geist">Наценка и курс</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">
                      Множитель наценки
                      <span className="ml-2 text-xs text-zinc-500 font-normal">
                        (например 2.5 = себестоимость × 2.5, наценка +150%)
                      </span>
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        step="0.1"
                        min="1"
                        value={markup}
                        onChange={(e) => setMarkup(e.target.value)}
                        className="w-32 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900"
                      />
                      <span className="text-sm text-zinc-500">
                        = наценка {markupVal > 0 ? ((markupVal - 1) * 100).toFixed(0) : "—"}%
                      </span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">
                      Курс USD / RUB
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        step="0.01"
                        min="1"
                        value={usdToRub}
                        onChange={(e) => setUsdToRub(e.target.value)}
                        className="w-32 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900"
                      />
                      <span className="text-sm text-zinc-500">₽ за $1</span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Цены провайдеров */}
              <section className="rounded-2xl bg-zinc-200/80 p-6 shadow-sm ring-1 ring-zinc-900/10">
                <h2 className="text-lg font-semibold text-zinc-900 mb-1 font-geist">Цены провайдеров</h2>
                <p className="text-xs text-zinc-500 mb-4">USD за 1 млн токенов</p>

                <div className="space-y-5">
                  {/* GPT-5.2 */}
                  <div>
                    <div className="text-sm font-semibold text-zinc-800 mb-2">GPT-5.2 (OpenAI)</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-zinc-500 mb-1">Input (за 1M токенов)</label>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-zinc-400">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={gptInput}
                            onChange={(e) => setGptInput(e.target.value)}
                            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-500 mb-1">Output (за 1M токенов)</label>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-zinc-400">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={gptOutput}
                            onChange={(e) => setGptOutput(e.target.value)}
                            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-zinc-300/60" />

                  {/* DeepSeek */}
                  <div>
                    <div className="text-sm font-semibold text-zinc-800 mb-2">DeepSeek Chat</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-zinc-500 mb-1">Input (за 1M токенов)</label>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-zinc-400">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={dsInput}
                            onChange={(e) => setDsInput(e.target.value)}
                            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-500 mb-1">Output (за 1M токенов)</label>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-zinc-400">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={dsOutput}
                            onChange={(e) => setDsOutput(e.target.value)}
                            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Средняя стоимость сообщения */}
              <section className="rounded-2xl bg-zinc-200/80 p-6 shadow-sm ring-1 ring-zinc-900/10">
                <h2 className="text-lg font-semibold text-zinc-900 mb-1 font-geist">Средняя стоимость сообщения</h2>
                <p className="text-xs text-zinc-500 mb-4">
                  Расчёт по текущим настройкам (500 input + 200 output токенов) и фактические данные за 30 дней
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-zinc-500 border-b border-zinc-300/60">
                        <th className="pb-2 font-medium pr-4">Модель</th>
                        <th className="pb-2 font-medium pr-4">Себестоимость</th>
                        <th className="pb-2 font-medium pr-4">С наценкой</th>
                        <th className="pb-2 font-medium pr-4">Факт (30д)</th>
                        <th className="pb-2 font-medium">Сообщений</th>
                      </tr>
                    </thead>
                    <tbody className="text-zinc-700">
                      <tr className="border-b border-zinc-300/40">
                        <td className="py-2.5 pr-4 font-medium">GPT-5.2</td>
                        <td className="py-2.5 pr-4 font-mono">{fmt(gptCost, 2)}₽</td>
                        <td className="py-2.5 pr-4 font-mono text-emerald-700 font-semibold">{fmt(gptCharged, 2)}₽</td>
                        <td className="py-2.5 pr-4 font-mono text-zinc-500">
                          {modelStatsMap["gpt-5.2"] ? fmt(modelStatsMap["gpt-5.2"].avgChargedRub, 2) + "₽" : "—"}
                        </td>
                        <td className="py-2.5 font-mono text-zinc-500">
                          {modelStatsMap["gpt-5.2"]?.messages.toLocaleString("ru-RU") ?? "—"}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pr-4 font-medium">DeepSeek Chat</td>
                        <td className="py-2.5 pr-4 font-mono">{fmt(dsCost, 4)}₽</td>
                        <td className="py-2.5 pr-4 font-mono text-emerald-700 font-semibold">{fmt(dsCharged, 4)}₽</td>
                        <td className="py-2.5 pr-4 font-mono text-zinc-500">
                          {modelStatsMap["deepseek-chat"] ? fmt(modelStatsMap["deepseek-chat"].avgChargedRub, 4) + "₽" : "—"}
                        </td>
                        <td className="py-2.5 font-mono text-zinc-500">
                          {modelStatsMap["deepseek-chat"]?.messages.toLocaleString("ru-RU") ?? "—"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Save */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-xl bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 transition-colors disabled:opacity-50"
                >
                  {saving ? "Сохранение…" : "Сохранить"}
                </button>
                {saveMsg && (
                  <span className={`text-sm ${saveMsg.startsWith("Ошибка") ? "text-red-600" : "text-emerald-600"}`}>
                    {saveMsg}
                  </span>
                )}
              </div>

              {config?.updatedAt && (
                <p className="text-xs text-zinc-400">
                  Последнее обновление: {new Date(config.updatedAt).toLocaleString("ru-RU")}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
