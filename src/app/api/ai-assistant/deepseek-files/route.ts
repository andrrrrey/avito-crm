// src/app/api/ai-assistant/deepseek-files/route.ts
// Управление файлами локальной базы знаний для DeepSeek.

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  listKnowledgeFiles,
  storeKnowledgeFile,
  deleteKnowledgeFile,
  extractTextFromFile,
  isSupportedFile,
} from "@/lib/knowledge-base";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — список файлов в базе знаний */
export async function GET(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  try {
    const files = await listKnowledgeFiles();
    return NextResponse.json({ ok: true, files });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Ошибка получения списка файлов";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** POST — загрузить файл в базу знаний */
export async function POST(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

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
    );
    return NextResponse.json({ ok: true, fileId: result.id, chunksCount: result.chunksCount });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Ошибка загрузки файла";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** DELETE — удалить файл из базы знаний */
export async function DELETE(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  const fileId = body?.fileId;
  if (!fileId || typeof fileId !== "string") {
    return NextResponse.json(
      { ok: false, error: "fileId не указан" },
      { status: 400 },
    );
  }

  try {
    await deleteKnowledgeFile(fileId);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Ошибка удаления файла";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
