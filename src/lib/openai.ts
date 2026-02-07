// src/lib/openai.ts
import OpenAI from "openai";
import { prisma } from "@/lib/prisma";

/** Получить настройки AI-ассистента из БД (синглтон id=1) */
export async function getAiSettings() {
  return prisma.aiAssistant.findUnique({ where: { id: 1 } });
}

/** Создать инстанс OpenAI SDK с ключом из БД */
export async function getOpenAIClient(): Promise<OpenAI | null> {
  const settings = await getAiSettings();
  if (!settings?.apiKey) return null;
  return new OpenAI({ apiKey: settings.apiKey });
}

/** Список файлов в vector store */
export async function listVectorStoreFiles(apiKey: string, vectorStoreId: string) {
  const client = new OpenAI({ apiKey });
  const result = await client.vectorStores.files.list(vectorStoreId);
  const files: Array<{
    id: string;
    object: string;
    status: string;
    created_at: number;
    vector_store_id: string;
    filename?: string;
    bytes?: number;
  }> = [];

  for await (const f of result) {
    // Получаем информацию о файле, чтобы узнать имя
    let filename: string | undefined;
    let bytes: number | undefined;
    try {
      const fileInfo = await client.files.retrieve(f.id);
      filename = fileInfo.filename;
      bytes = fileInfo.bytes;
    } catch {
      // ignore — покажем без имени
    }
    files.push({
      id: f.id,
      object: f.object,
      status: f.status,
      created_at: f.created_at,
      vector_store_id: f.vector_store_id,
      filename,
      bytes,
    });
  }

  return files;
}

/** Загрузить файл в vector store */
export async function uploadFileToVectorStore(
  apiKey: string,
  vectorStoreId: string,
  file: File,
) {
  const client = new OpenAI({ apiKey });

  // Загружаем файл в OpenAI Files
  const uploaded = await client.files.create({
    file,
    purpose: "assistants",
  });

  // Привязываем к vector store
  const vsFile = await client.vectorStores.files.create(vectorStoreId, {
    file_id: uploaded.id,
  });

  return { fileId: uploaded.id, vsFile };
}

/** Удалить файл из vector store (и из OpenAI Files) */
export async function deleteFileFromVectorStore(
  apiKey: string,
  vectorStoreId: string,
  fileId: string,
) {
  const client = new OpenAI({ apiKey });

  // Удаляем из vector store
  await client.vectorStores.files.delete(fileId, { vector_store_id: vectorStoreId });

  // Удаляем сам файл из OpenAI
  try {
    await client.files.delete(fileId);
  } catch {
    // может уже удалён — не страшно
  }
}
