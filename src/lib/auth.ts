// src/lib/auth.ts
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

function extractToken(req: Request): string | null {
  const url = new URL(req.url);

  const q = url.searchParams.get("token");
  if (q) return q;

  const x = req.headers.get("x-crm-token");
  if (x) return x;

  const auth = req.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();

  return null;
}

export function requireCronToken(req: Request) {
  const token = extractToken(req);
  if (!token || token !== env.CRM_CRON_TOKEN) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function requireAuthOrCron(req: Request) {
  // сначала пробуем сессию (cookie)
  const auth = await requireAuth(req);
  if (!auth) return null;

  // если нет сессии — пробуем cron token
  const cron = requireCronToken(req);
  if (!cron) return null;

  // иначе возвращаем auth (401)
  return auth;
}

export function requireToken(req: Request) {
  // ✅ В локальном mock-режиме НЕ блокируем UI
  if (env.NODE_ENV !== "production" && env.MOCK_MODE) return null;

  const token = extractToken(req);
  if (!token) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const ok = token === env.CRM_TOKEN || token === env.DEV_TOKEN;
  if (!ok) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  return null;
}

function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  // простейший парсер cookie без зависимостей
  const parts = raw.split(";").map((s) => s.trim());
  for (const p of parts) {
    if (!p) continue;
    const i = p.indexOf("=");
    if (i < 0) continue;
    const k = p.slice(0, i).trim();
    const v = p.slice(i + 1);
    if (k === name) return decodeURIComponent(v);
  }
  return null;
}

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

export async function requireAuth(req: Request) {
  const cookieName = env.SESSION_COOKIE_NAME;
  const token = getCookie(req, cookieName);
  if (!token) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const tokenHash = sha256(token);

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (!session.user.isActive) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (session.expiresAt.getTime() < Date.now()) {
    // можно сразу удалить протухшую сессию
    await prisma.session.deleteMany({ where: { tokenHash } });
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // по желанию: обновлять lastUsedAt
  await prisma.session.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date() },
  });

  return null;
}

export async function destroySession(req: Request) {
  const cookieName = env.SESSION_COOKIE_NAME;
  const token = getCookie(req, cookieName);
  if (!token) return;

  const tokenHash = sha256(token);
  await prisma.session.deleteMany({ where: { tokenHash } });
}

