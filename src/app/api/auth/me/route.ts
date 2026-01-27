// src/app/api/auth/me/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
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

export async function GET(req: Request) {
  const token = getCookie(req, env.SESSION_COOKIE_NAME);
  if (!token) return NextResponse.json({ ok: true, user: null });

  const tokenHash = sha256(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) return NextResponse.json({ ok: true, user: null });
  if (!session.user.isActive) return NextResponse.json({ ok: true, user: null });
  if (session.expiresAt.getTime() < Date.now()) return NextResponse.json({ ok: true, user: null });

  return NextResponse.json({
    ok: true,
    user: { id: session.user.id, username: session.user.username, role: session.user.role },
  });
}
