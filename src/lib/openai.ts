// src/lib/openai.ts
import OpenAI from "openai";
import { prisma } from "@/lib/prisma";

/** Инструкция для ассистента: когда переводить на менеджера */
export const ESCALATE_INSTRUCTION = `
## Перевод на менеджера

Ты ОБЯЗАН добавить маркер [ESCALATE] и перевести на менеджера, если:
- Клиент просит позвать человека, оператора, менеджера или живого сотрудника.
- Клиент настаивает на разговоре с человеком.
- Ты выполнил поиск по базе знаний и НЕ нашёл ответа на вопрос клиента — переводи СРАЗУ, не заставляй клиента повторять вопрос.
- Клиент выражает сильное недовольство, жалуется или конфликтует.
- Клиент просит решить проблему, которая требует действий менеджера (возврат, компенсация, изменение заказа, проверка статуса заказа и т.д.).
- Ты не уверен в правильности своего ответа — лучше перевести на менеджера, чем дать неточную информацию.

Когда переводишь на менеджера:
1. Коротко и вежливо сообщи клиенту, что переводишь на менеджера.
2. В самом конце своего сообщения добавь маркер [ESCALATE] на отдельной строке.

Пример:
"Понял, сейчас переведу вас на менеджера. Он свяжется с вами в ближайшее время!
[ESCALATE]"

ВАЖНО:
- Маркер [ESCALATE] должен быть ПОСЛЕДНИМ в сообщении, на отдельной строке.
- НЕ используй маркер [ESCALATE], если ты нашёл чёткий ответ в базе знаний и уверен в нём.
`.trim();

/** Маркер эскалации в ответе ассистента */
export const ESCALATE_MARKER = "[ESCALATE]";

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
 * Отправить сообщение пользователя в OpenAI Responses API и получить ответ.
 * Использует previous_response_id для сохранения контекста между вызовами.
 * Автоматически загружает историю из БД при первом вызове.
 */
export async function getAssistantReply(
  chatId: string,
  incomingText: string,
): Promise<string | null> {
  const settings = await getAiSettings();
  if (!settings?.enabled || !settings.apiKey || !settings.model) {
    console.log("[AI] Skip: assistant disabled or missing settings", {
      enabled: settings?.enabled,
      hasKey: !!settings?.apiKey,
      model: settings?.model,
    });
    return null;
  }

  console.log(`[AI] Processing message for chat ${chatId}: "${incomingText.slice(0, 80)}"`);

  const client = new OpenAI({ apiKey: settings.apiKey });

  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { id: true, raw: true, customerName: true, itemTitle: true, price: true },
  });
  if (!chat) return null;

  const rawObj = (chat.raw && typeof chat.raw === "object") ? (chat.raw as Record<string, unknown>) : {};
  const previousResponseId = rawObj.openaiResponseId as string | undefined;

  // Собираем контекст чата для персонализации ответов
  const chatContext = buildChatContext(chat);

  // Формируем инструкции
  let instructions = settings.instructions ?? "";

  if (settings.vectorStoreId) {
    instructions +=
      "\n\n" +
      (chatContext ? chatContext + "\n\n" : "") +
      "## Работа с базой знаний и контекстом диалога\n\n" +
      "Для КАЖДОГО сообщения клиента ты ОБЯЗАН выполнить поиск по файлам (file_search) в базе знаний.\n" +
      "При этом ты ДОЛЖЕН учитывать контекст всего диалога: помни, о чём шла речь ранее, что клиент уже спрашивал, " +
      "какую информацию ты ему уже давал. Используй историю переписки чтобы лучше понять текущий вопрос клиента.\n" +
      "Комбинируй информацию из базы знаний с контекстом диалога для наиболее точного и полезного ответа.\n" +
      "Если в базе знаний нет ответа на вопрос клиента — переводи на менеджера (см. правила ниже).\n\n" +
      ESCALATE_INSTRUCTION;
    console.log(`[AI] file_search enabled, vector store: ${settings.vectorStoreId}`);
  } else {
    instructions +=
      "\n\n" +
      (chatContext ? chatContext + "\n\n" : "") +
      "## Контекст диалога\n\n" +
      "Учитывай контекст всего диалога: помни, о чём шла речь ранее, что клиент уже спрашивал, " +
      "какую информацию ты ему уже давал. Используй историю переписки для точного ответа.\n\n" +
      ESCALATE_INSTRUCTION;
    console.log(`[AI] WARNING: no vectorStoreId configured — file_search disabled`);
  }

  // Формируем tools
  const tools: OpenAI.Responses.Tool[] = [];
  if (settings.vectorStoreId) {
    tools.push({
      type: "file_search",
      vector_store_ids: [settings.vectorStoreId],
    });
  }

  // Формируем параметры запроса
  const baseParams: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
    model: settings.model,
    instructions,
    input: [],
    truncation: "auto",
  };
  if (tools.length > 0) {
    baseParams.tools = tools;
  }

  let response: OpenAI.Responses.Response;

  if (previousResponseId) {
    // Продолжаем диалог через previous_response_id
    try {
      console.log(`[AI] Continuing conversation, previous_response_id: ${previousResponseId}`);
      response = await client.responses.create({
        ...baseParams,
        previous_response_id: previousResponseId,
        input: [{ role: "user", content: incomingText }],
      });
    } catch (e) {
      // Если previous_response_id невалидный — fallback на полную историю
      console.warn("[AI] previous_response_id failed, falling back to full history:", e);
      const input = await buildInputFromHistory(chatId, incomingText);
      response = await client.responses.create({
        ...baseParams,
        input,
      });
    }
  } else {
    // Новый диалог — загружаем историю из БД
    console.log(`[AI] Starting new conversation for chat ${chatId}`);
    const input = await buildInputFromHistory(chatId, incomingText);
    response = await client.responses.create({
      ...baseParams,
      input,
    });
  }

  // Сохраняем response ID для следующего вызова
  await prisma.chat.update({
    where: { id: chatId },
    data: { raw: { ...rawObj, openaiResponseId: response.id } },
  });

  // Извлекаем текстовый ответ
  let reply: string | null = response.output_text || null;
  if (reply) {
    // Убираем аннотации file_search вида 【4:0†source】
    reply = reply.replace(/【[^】]*†[^】]*】/g, "").replace(/\s{2,}/g, " ").trim();
  }

  console.log(`[AI] Got reply for chat ${chatId}: "${(reply ?? "").slice(0, 100)}"`);
  return reply || null;
}

/** Максимальное количество исторических сообщений для загрузки */
const MAX_HISTORY_MESSAGES = 20;

/**
 * Формирует массив input-сообщений из истории чата в БД.
 * Используется при первом вызове (когда нет previous_response_id).
 */
async function buildInputFromHistory(
  chatId: string,
  currentIncomingText: string,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  try {
    const history = await prisma.message.findMany({
      where: { chatId },
      orderBy: { sentAt: "asc" },
      take: MAX_HISTORY_MESSAGES,
      select: { direction: true, text: true, sentAt: true },
    });

    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      // Исключаем текущее входящее сообщение (оно будет добавлено отдельно)
      if (
        i === history.length - 1 &&
        msg.direction === "IN" &&
        msg.text.trim() === currentIncomingText.trim()
      ) {
        continue;
      }
      if (msg.text.trim().length === 0) continue;

      messages.push({
        role: msg.direction === "IN" ? "user" : "assistant",
        content: msg.text,
      });
    }

    // Добавляем текущее сообщение
    messages.push({ role: "user", content: currentIncomingText });

    console.log(`[AI] Built input from history: ${messages.length} messages`);
    return messages;
  } catch (e) {
    console.warn("[AI] Failed to load chat history:", e);
    // Fallback — только текущее сообщение
    return [{ role: "user", content: currentIncomingText }];
  }
}

/**
 * Формирует контекстную информацию о чате для дополнительных инструкций.
 * Включает имя клиента, название товара, цену — чтобы ответы были персонализированными.
 */
function buildChatContext(chat: {
  customerName: string | null;
  itemTitle: string | null;
  price: number | null;
}): string | null {
  const parts: string[] = [];
  if (chat.customerName) parts.push(`Имя клиента: ${chat.customerName}`);
  if (chat.itemTitle) parts.push(`Товар/объявление: ${chat.itemTitle}`);
  if (chat.price) parts.push(`Цена: ${chat.price} ₽`);

  if (parts.length === 0) return null;
  return "## Контекст текущего чата\n\n" + parts.join("\n");
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
