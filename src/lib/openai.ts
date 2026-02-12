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

/**
 * Отправить сообщение пользователя в OpenAI Assistants API и получить ответ.
 * Использует thread per chat (хранится в raw.openaiThreadId).
 */
export async function getAssistantReply(
  chatId: string,
  incomingText: string,
): Promise<string | null> {
  const settings = await getAiSettings();
  if (!settings?.enabled || !settings.apiKey || !settings.assistantId) {
    console.log("[AI] Skip: assistant disabled or missing settings", {
      enabled: settings?.enabled,
      hasKey: !!settings?.apiKey,
      hasAssistant: !!settings?.assistantId,
    });
    return null;
  }

  console.log(`[AI] Processing message for chat ${chatId}: "${incomingText.slice(0, 80)}"`);

  const client = new OpenAI({ apiKey: settings.apiKey });

  // Получаем или создаём thread для этого чата
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { id: true, raw: true },
  });
  if (!chat) return null;

  const rawObj = (chat.raw && typeof chat.raw === "object") ? (chat.raw as Record<string, unknown>) : {};
  let threadId = rawObj.openaiThreadId as string | undefined;

  if (!threadId) {
    console.log(`[AI] Creating new thread for chat ${chatId}`);
    const thread = await client.beta.threads.create();
    threadId = thread.id;

    // Сохраняем threadId в raw
    await prisma.chat.update({
      where: { id: chatId },
      data: { raw: { ...rawObj, openaiThreadId: threadId } },
    });
  }

  // Добавляем сообщение пользователя в thread
  await client.beta.threads.messages.create(threadId, {
    role: "user",
    content: incomingText,
  });

  // Запускаем run с ассистентом (instructions синхронизированы с OpenAI при сохранении)
  const runParams: OpenAI.Beta.Threads.Runs.RunCreateParams = {
    assistant_id: settings.assistantId,
  };

  console.log(`[AI] Starting run for thread ${threadId}, assistant ${settings.assistantId}`);
  const run = await client.beta.threads.runs.createAndPoll(threadId, runParams);

  if (run.status !== "completed") {
    console.error(`[AI] Run finished with status: ${run.status}`, run.last_error);
    return null;
  }

  // Забираем последнее сообщение ассистента
  const messages = await client.beta.threads.messages.list(threadId, {
    order: "desc",
    limit: 1,
  });

  const assistantMsg = messages.data[0];
  if (!assistantMsg || assistantMsg.role !== "assistant") return null;

  // Извлекаем текст
  const textBlock = assistantMsg.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") return null;

  const reply = textBlock.text.value || null;
  console.log(`[AI] Got reply for chat ${chatId}: "${(reply ?? "").slice(0, 100)}"`);
  return reply;
}

/** Получить текущие instructions ассистента со стороны OpenAI */
export async function fetchAssistantInstructions(
  apiKey: string,
  assistantId: string,
): Promise<string | null> {
  const client = new OpenAI({ apiKey });
  const assistant = await client.beta.assistants.retrieve(assistantId);
  return assistant.instructions ?? null;
}

/** Обновить instructions ассистента на стороне OpenAI и привязать vector store */
export async function updateAssistantInstructions(
  apiKey: string,
  assistantId: string,
  instructions: string | null,
  vectorStoreId?: string | null,
) {
  const client = new OpenAI({ apiKey });
  const updateParams: OpenAI.Beta.Assistants.AssistantUpdateParams = {
    instructions: instructions ?? "",
  };

  if (vectorStoreId) {
    updateParams.tools = [{ type: "file_search" }];
    updateParams.tool_resources = {
      file_search: { vector_store_ids: [vectorStoreId] },
    };
  }

  await client.beta.assistants.update(assistantId, updateParams);
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
