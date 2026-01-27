import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { destroySession } from "@/lib/auth";

export async function POST(req: Request) {
  await destroySession(req);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(env.SESSION_COOKIE_NAME, "", { path: "/", expires: new Date(0) });
  return res;
}
