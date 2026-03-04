import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { publish } from "@/lib/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

type LabelColor = "YELLOW" | "RED" | "BLUE" | "GREEN";

function parseLabelColor(v: any): LabelColor | null {
  if (v === null || v === undefined || v === "" || v === "NONE") return null;
  const s = String(v).trim().toUpperCase();
  if (s === "YELLOW" || s === "RED" || s === "BLUE" || s === "GREEN") return s as LabelColor;
  return null;
}

// POST /api/chats/:id/label  { labelColor: "RED" | "YELLOW" | "BLUE" | "GREEN" | null }
export async function POST(req: Request, ctx: Ctx) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const { id } = await ctx.params;

  const chat = await prisma.chat.findUnique({ where: { id } });
  if (!chat) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as null | { labelColor?: unknown };
  const next = parseLabelColor(body?.labelColor);

  const updated = await prisma.chat.update({
    where: { id },
    data: { labelColor: next },
    select: { labelColor: true, avitoChatId: true },
  });

  publish({ type: "chat_updated", chatId: id, avitoChatId: updated.avitoChatId });

  return NextResponse.json({ ok: true, labelColor: updated.labelColor });
}
