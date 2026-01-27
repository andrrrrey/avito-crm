import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireDev(req: Request) {
  if (process.env.NODE_ENV !== "development") return NextResponse.json({ ok: false }, { status: 404 });
  const token = req.headers.get("x-dev-token") ?? new URL(req.url).searchParams.get("token");
  if (!token || token !== env.DEV_TOKEN) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return null;
}

export async function POST(req: Request) {
  const auth = requireDev(req);
  if (auth) return auth;

  await prisma.message.deleteMany({});
  await prisma.chat.deleteMany({});

  return NextResponse.json({ ok: true });
}
