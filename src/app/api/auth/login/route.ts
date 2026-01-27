import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { createSessionToken } from "@/lib/auth"; // из src/lib/auth.ts
import crypto from "crypto";

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as null | { username?: unknown; password?: unknown };
  if (!body) return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });

  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");

  if (!username || !password) {
    return NextResponse.json({ ok: false, error: "missing_credentials" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.isActive) {
    return NextResponse.json({ ok: false, error: "invalid_credentials" }, { status: 401 });
  }

  const ok = bcrypt.compareSync(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "invalid_credentials" }, { status: 401 });
  }

  const token = createSessionToken();
  const tokenHash = sha256(token);

  const ttlDays = env.SESSION_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });

  return res;
}
