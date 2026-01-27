// src/app/login/page.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const j = await r.json().catch(() => null);

      if (!r.ok || !j?.ok) {
        setError("Неверный логин или пароль");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Ошибка сети");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-900/10"
      >
        <div className="text-xl font-semibold text-slate-900">Вход в CRM</div>
        <div className="mt-1 text-sm text-slate-500">Введите логин и пароль сотрудника</div>

        <label className="mt-5 block text-sm font-medium text-slate-700">
          Логин
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/30"
            autoComplete="username"
          />
        </label>

        <label className="mt-3 block text-sm font-medium text-slate-700">
          Пароль
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/30"
            autoComplete="current-password"
          />
        </label>

        {error && (
          <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-700/10">
            {error}
          </div>
        )}

        <button
          disabled={loading || !username.trim() || !password}
          className="mt-5 w-full rounded-xl bg-sky-600 px-3 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50"
        >
          {loading ? "Входим..." : "Войти"}
        </button>

        <div className="mt-4 text-xs text-slate-500">
          Если не пускает — проверь, что пользователь есть в БД и <code>isActive=true</code>.
        </div>
      </form>
    </div>
  );
}
