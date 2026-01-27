import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    nodeEnv: process.env.NODE_ENV,
    mockMode: env.MOCK_MODE,
    devTokenLen: env.DEV_TOKEN?.length ?? 0,
    devTokenSample: env.DEV_TOKEN ? env.DEV_TOKEN.slice(0, 2) + "***" + env.DEV_TOKEN.slice(-2) : null,
  });
}
