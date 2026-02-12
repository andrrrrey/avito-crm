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
 * Отправить сообщение пользователя в OpenAI Assistants API и получить ответ.
 * Использует thread per chat (хранится в raw.openaiThreadId).
 * Загружает историю сообщений в новый thread для сохранения контекста.
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
    select: { id: true, raw: true, customerName: true, itemTitle: true, price: true },
  });
  if (!chat) return null;

  const rawObj = (chat.raw && typeof chat.raw === "object") ? (chat.raw as Record<string, unknown>) : {};
  let threadId = rawObj.openaiThreadId as string | undefined;

  if (!threadId) {
    console.log(`[AI] Creating new thread for chat ${chatId}`);
    // Привязываем vector store к thread, чтобы file_search мог искать по файлам
    const threadParams: OpenAI.Beta.Threads.ThreadCreateParams = {};
    if (settings.vectorStoreId) {
      threadParams.tool_resources = {
        file_search: { vector_store_ids: [settings.vectorStoreId] },
      };
    }
    const thread = await client.beta.threads.create(threadParams);
    threadId = thread.id;

    // Сохраняем threadId в raw
    await prisma.chat.update({
      where: { id: chatId },
      data: { raw: { ...rawObj, openaiThreadId: threadId } },
    });

    // Загружаем историю предыдущих сообщений в новый thread для контекста
    // (исключаем текущее входящее сообщение — оно будет добавлено ниже)
    await loadChatHistoryIntoThread(client, threadId!, chatId, incomingText);
  }

  // Собираем контекст чата для персонализации ответов
  const chatContext = buildChatContext(chat);

  // Добавляем сообщение пользователя в thread
  await client.beta.threads.messages.create(threadId, {
    role: "user",
    content: incomingText,
  });

  // Запускаем run с ассистентом — явно включаем file_search, если есть vector store
  const runParams: OpenAI.Beta.Threads.Runs.RunCreateParams = {
    assistant_id: settings.assistantId,
  };

  // Переопределяем модель, если задана в настройках
  if (settings.model) {
    runParams.model = settings.model;
  }

  if (settings.vectorStoreId) {
    runParams.tools = [{ type: "file_search" }];
    runParams.additional_instructions =
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
    // Без vector store — только контекст диалога и эскалация
    runParams.additional_instructions =
      (chatContext ? chatContext + "\n\n" : "") +
      "## Контекст диалога\n\n" +
      "Учитывай контекст всего диалога: помни, о чём шла речь ранее, что клиент уже спрашивал, " +
      "какую информацию ты ему уже давал. Используй историю переписки для точного ответа.\n\n" +
      ESCALATE_INSTRUCTION;
    console.log(`[AI] WARNING: no vectorStoreId configured — file_search disabled`);
  }

  console.log(`[AI] Starting run for thread ${threadId}, assistant ${settings.assistantId}`);
  const run = await client.beta.threads.runs.createAndPoll(threadId, runParams);

  if (run.status !== "completed") {
    console.error(`[AI] Run finished with status: ${run.status}`, run.last_error);
    return null;
  }

  console.log(`[AI] Run completed. Tools used: ${JSON.stringify(run.tools?.map(t => t.type) ?? [])}`);

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

  // Убираем аннотации file_search вида 【4:0†source】
  let reply = textBlock.text.value || null;
  if (reply) {
    reply = reply.replace(/【[^】]*†[^】]*】/g, "").replace(/\s{2,}/g, " ").trim();
  }

  console.log(`[AI] Got reply for chat ${chatId}: "${(reply ?? "").slice(0, 100)}"`);
  return reply || null;
}

/** Максимальное количество исторических сообщений для загрузки в новый thread */
const MAX_HISTORY_MESSAGES = 20;

/**
 * Загружает историю сообщений из БД в новый OpenAI thread.
 * Это нужно, чтобы ассистент имел контекст предыдущей переписки
 * (например, если thread был создан заново или AI был только что включён).
 */
async function loadChatHistoryIntoThread(
  client: OpenAI,
  threadId: string,
  chatId: string,
  currentIncomingText: string,
) {
  try {
    const history = await prisma.message.findMany({
      where: { chatId },
      orderBy: { sentAt: "asc" },
      take: MAX_HISTORY_MESSAGES,
      select: { direction: true, text: true, sentAt: true },
    });

    // Исключаем последнее сообщение, если оно совпадает с текущим входящим
    // (оно будет добавлено отдельно после вызова этой функции)
    const filtered = history.filter((m: { direction: string; text: string }, i: number) => {
      if (i === history.length - 1 && m.direction === "IN" && m.text.trim() === currentIncomingText.trim()) {
        return false;
      }
      return m.text.trim().length > 0;
    });

    if (filtered.length === 0) return;

    console.log(`[AI] Loading ${filtered.length} historical messages into thread ${threadId}`);

    for (const msg of filtered) {
      await client.beta.threads.messages.create(threadId, {
        role: msg.direction === "IN" ? "user" : "assistant",
        content: msg.text,
      });
    }
  } catch (e) {
    // Не блокируем основной поток — история это дополнительный контекст
    console.warn("[AI] Failed to load chat history into thread:", e);
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

/** Получить текущие instructions ассистента со стороны OpenAI */
export async function fetchAssistantInstructions(
  apiKey: string,
  assistantId: string,
): Promise<string | null> {
  const client = new OpenAI({ apiKey });
  const assistant = await client.beta.assistants.retrieve(assistantId);
  return assistant.instructions ?? null;
}

/** Обновить instructions ассистента на стороне OpenAI и привязать vector store / модель */
export async function updateAssistantInstructions(
  apiKey: string,
  assistantId: string,
  instructions: string | null,
  vectorStoreId?: string | null,
  model?: string | null,
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

  if (model) {
    updateParams.model = model;
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
