// src/app/api/ai-assistant/deepseek-files/route.ts
// Управление файлами локальной базы знаний для DeepSeek (per-user).

import { NextResponse } from "next/server";
import { requireAuth, getSessionUser } from "@/lib/auth";
import {
  listKnowledgeFiles,
  storeKnowledgeFile,
  deleteKnowledgeFile,
  extractTextFromFile,
  isSupportedFile,
} from "@/lib/knowledge-base";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — список файлов в базе знаний текущего пользователя */
export async function GET(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    const files = await listKnowledgeFiles(sessionUser.id);
    return NextResponse.json({ ok: true, files });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Ошибка получения списка файлов";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** POST — загрузить файл в базу знаний текущего пользователя */
export async function POST(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json(
      { ok: false, error: "Файл не найден в запросе" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "Файл не найден в запросе" },
      { status: 400 },
    );
  }

  if (!isSupportedFile(file)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Формат файла не поддерживается. Поддерживаются: .txt, .md, .csv, .json, .yaml, .html",
      },
      { status: 400 },
    );
  }

  try {
    const content = await extractTextFromFile(file);
    const result = await storeKnowledgeFile(
      file.name,
      file.size,
      file.type || "text/plain",
      content,
      sessionUser.id,
    );
    return NextResponse.json({ ok: true, fileId: result.id, chunksCount: result.chunksCount });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Ошибка загрузки файла";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** DELETE — удалить файл из базы знаний (только свои файлы) */
export async function DELETE(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const fileId = body?.fileId;
  if (!fileId || typeof fileId !== "string") {
    return NextResponse.json(
      { ok: false, error: "fileId не указан" },
      { status: 400 },
    );
  }

  // Verify file belongs to this user
  const { prisma } = await import("@/lib/prisma");
  const file = await prisma.knowledgeBaseFile.findUnique({
    where: { id: fileId },
    select: { userId: true },
  });

  if (!file) {
    return NextResponse.json({ ok: false, error: "Файл не найден" }, { status: 404 });
  }

  if (file.userId && file.userId !== sessionUser.id && sessionUser.role !== "ADMIN") {
    return NextResponse.json({ ok: false, error: "Нет доступа к этому файлу" }, { status: 403 });
  }

  try {
    await deleteKnowledgeFile(fileId);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Ошибка удаления файла";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
