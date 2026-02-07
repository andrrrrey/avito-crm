// src/app/api/ai-assistant/files/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import {
  listVectorStoreFiles,
  uploadFileToVectorStore,
  deleteFileFromVectorStore,
} from "@/lib/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getKeysOrError() {
  const settings = await prisma.aiAssistant.findUnique({ where: { id: 1 } });
  if (!settings?.apiKey) {
    return { error: "API-ключ OpenAI не задан" };
  }
  if (!settings?.vectorStoreId) {
    return { error: "Vector Store ID не задан" };
  }
  return { apiKey: settings.apiKey, vectorStoreId: settings.vectorStoreId };
}

/** GET — список файлов в vector store */
export async function GET(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const keys = await getKeysOrError();
  if ("error" in keys) {
    return NextResponse.json({ ok: false, error: keys.error }, { status: 400 });
  }

  try {
    const files = await listVectorStoreFiles(keys.apiKey, keys.vectorStoreId);
    return NextResponse.json({ ok: true, files });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Ошибка OpenAI";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}

/** POST — загрузить файл в vector store */
export async function POST(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const keys = await getKeysOrError();
  if ("error" in keys) {
    return NextResponse.json({ ok: false, error: keys.error }, { status: 400 });
  }

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

  try {
    const result = await uploadFileToVectorStore(
      keys.apiKey,
      keys.vectorStoreId,
      file,
    );
    return NextResponse.json({ ok: true, fileId: result.fileId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Ошибка загрузки файла";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}

/** DELETE — удалить файл из vector store */
export async function DELETE(req: Request) {
  const guard = await requireAuth(req);
  if (guard) return guard;

  const keys = await getKeysOrError();
  if ("error" in keys) {
    return NextResponse.json({ ok: false, error: keys.error }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const fileId = body?.fileId;
  if (!fileId || typeof fileId !== "string") {
    return NextResponse.json(
      { ok: false, error: "fileId не указан" },
      { status: 400 },
    );
  }

  try {
    await deleteFileFromVectorStore(keys.apiKey, keys.vectorStoreId, fileId);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Ошибка удаления файла";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
