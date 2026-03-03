// src/app/register/page.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Пароли не совпадают");
      return;
    }

    if (password.length < 8) {
      setError("Пароль должен содержать не менее 8 символов");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const j = await r.json().catch(() => null);

      if (!r.ok || !j?.ok) {
        const msgMap: Record<string, string> = {
          email_taken: "Этот email уже используется",
          invalid_email: "Некорректный email адрес",
          password_too_short: "Пароль должен содержать не менее 8 символов",
          missing_credentials: "Заполните все поля",
        };
        setError(msgMap[j?.error] ?? "Ошибка регистрации");
        return;
      }

      // Auto-login after registration
      const loginResp = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (loginResp.ok) {
        router.push("/dashboard");
        router.refresh();
      } else {
        router.push("/login");
      }
    } catch {
      setError("Ошибка сети");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-transparent p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl bg-zinc-200/80 p-6 shadow-sm ring-1 ring-zinc-900/10"
      >
        <div className="text-xl font-semibold text-zinc-900">Регистрация</div>
        <div className="mt-1 text-sm text-zinc-500">Создайте аккаунт для работы с CRM</div>

        <label className="mt-5 block text-sm font-medium text-zinc-700">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-zinc-300 bg-zinc-100/90 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/25"
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
        </label>

        <label className="mt-3 block text-sm font-medium text-zinc-700">
          Пароль
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            className="mt-1 w-full rounded-xl border border-zinc-300 bg-zinc-100/90 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/25"
            autoComplete="new-password"
            placeholder="Минимум 8 символов"
            required
          />
        </label>

        <label className="mt-3 block text-sm font-medium text-zinc-700">
          Повторите пароль
          <input
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            type="password"
            className="mt-1 w-full rounded-xl border border-zinc-300 bg-zinc-100/90 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/25"
            autoComplete="new-password"
            placeholder="Повторите пароль"
            required
          />
        </label>

        {error && (
          <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-700/10">
            {error}
          </div>
        )}

        <button
          disabled={loading || !email.trim() || !password || !confirmPassword}
          className="mt-5 w-full rounded-xl bg-sky-700 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-800 disabled:opacity-50"
        >
          {loading ? "Регистрация..." : "Зарегистрироваться"}
        </button>

        <div className="mt-4 text-center text-sm text-zinc-500">
          Уже есть аккаунт?{" "}
          <Link href="/login" className="text-sky-600 hover:underline font-medium">
            Войти
          </Link>
        </div>
      </form>
    </div>
  );
}
