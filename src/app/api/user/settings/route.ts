// src/app/api/user/settings/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — получить настройки текущего пользователя */
export async function GET(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
      avitoClientId: true,
      avitoClientSecret: true,
      avitoAccountId: true,
      aiEnabled: true,
      aiInstructions: true,
      aiEscalatePrompt: true,
      followupEnabled: true,
      followupMessage: true,
    },
  });

  if (!user) return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });

  return NextResponse.json({
    ok: true,
    data: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      avitoClientId: user.avitoClientId ?? "",
      hasAvitoClientSecret: !!user.avitoClientSecret,
      avitoAccountId: user.avitoAccountId ?? null,
      aiEnabled: user.aiEnabled,
      aiInstructions: user.aiInstructions ?? "",
      aiEscalatePrompt: user.aiEscalatePrompt ?? "",
      followupEnabled: user.followupEnabled,
      followupMessage: user.followupMessage ?? "",
    },
  });
}

/** PUT — обновить настройки текущего пользователя */
export async function PUT(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const {
    avitoClientId,
    avitoClientSecret,
    avitoAccountId,
    aiEnabled,
    aiInstructions,
    aiEscalatePrompt,
    followupEnabled,
    followupMessage,
  } = body;

  const data: Record<string, unknown> = {};

  if (typeof avitoClientId === "string") data.avitoClientId = avitoClientId || null;
  if (typeof avitoClientSecret === "string") data.avitoClientSecret = avitoClientSecret || null;
  if (avitoAccountId !== undefined) {
    if (avitoAccountId === null || avitoAccountId === "") {
      data.avitoAccountId = null;
    } else {
      const n = Number(avitoAccountId);
      if (Number.isInteger(n) && n > 0) data.avitoAccountId = n;
    }
  }
  if (typeof aiEnabled === "boolean") data.aiEnabled = aiEnabled;
  if (typeof aiInstructions === "string") data.aiInstructions = aiInstructions || null;
  if (typeof aiEscalatePrompt === "string") data.aiEscalatePrompt = aiEscalatePrompt || null;
  if (typeof followupEnabled === "boolean") data.followupEnabled = followupEnabled;
  if (typeof followupMessage === "string") data.followupMessage = followupMessage.trim() || null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: "nothing_to_update" }, { status: 400 });
  }

  // Проверяем, что avitoAccountId не занят другим пользователем —
  // иначе пользователи могли бы видеть чаты чужих аккаунтов.
  if (data.avitoAccountId != null) {
    const conflicting = await prisma.user.findFirst({
      where: {
        avitoAccountId: data.avitoAccountId as number,
        id: { not: sessionUser.id },
      },
      select: { id: true },
    });
    if (conflicting) {
      return NextResponse.json(
        { ok: false, error: "avito_account_id_taken" },
        { status: 409 }
      );
    }
  }

  const user = await prisma.user.update({
    where: { id: sessionUser.id },
    data,
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
      avitoClientId: true,
      avitoClientSecret: true,
      avitoAccountId: true,
      aiEnabled: true,
      aiInstructions: true,
      aiEscalatePrompt: true,
      followupEnabled: true,
      followupMessage: true,
    },
  });

  return NextResponse.json({
    ok: true,
    data: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      avitoClientId: user.avitoClientId ?? "",
      hasAvitoClientSecret: !!user.avitoClientSecret,
      avitoAccountId: user.avitoAccountId ?? null,
      aiEnabled: user.aiEnabled,
      aiInstructions: user.aiInstructions ?? "",
      aiEscalatePrompt: user.aiEscalatePrompt ?? "",
      followupEnabled: user.followupEnabled,
      followupMessage: user.followupMessage ?? "",
    },
  });
}
