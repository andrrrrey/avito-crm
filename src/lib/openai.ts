// src/lib/openai.ts
import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { buildKnowledgeContext, hasKnowledgeFiles } from "@/lib/knowledge-base";

/** Дефолтная инструкция для ассистента: когда переводить на менеджера */
export const DEFAULT_ESCALATE_INSTRUCTION = `
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
 * Отправить сообщение пользователя в AI и получить ответ.
 * Поддерживает два провайдера: OpenAI (Responses API) и DeepSeek (Chat Completions API).
 */
export async function getAssistantReply(
  chatId: string,
  incomingText: string,
): Promise<string | null> {
  const settings = await getAiSettings();
  if (!settings?.enabled || !settings.model) {
    console.log("[AI] Skip: assistant disabled or missing settings", {
      enabled: settings?.enabled,
      model: settings?.model,
    });
    return null;
  }

  const provider = settings.provider ?? "openai";

  if (provider === "deepseek") {
    return getDeepSeekReply(chatId, incomingText, settings);
  }

  return getOpenAIReply(chatId, incomingText, settings);
}

// ─── OpenAI (Responses API) ───────────────────────────────────────────────────

async function getOpenAIReply(
  chatId: string,
  incomingText: string,
  settings: NonNullable<Awaited<ReturnType<typeof getAiSettings>>>,
): Promise<string | null> {
  if (!settings.apiKey) {
    console.log("[AI] Skip: OpenAI API key not set");
    return null;
  }

  console.log(`[AI][OpenAI] Processing message for chat ${chatId}: "${incomingText.slice(0, 80)}"`);

  const client = new OpenAI({ apiKey: settings.apiKey });

  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { id: true, raw: true, customerName: true, itemTitle: true, price: true },
  });
  if (!chat) return null;

  const rawObj = (chat.raw && typeof chat.raw === "object") ? (chat.raw as Record<string, unknown>) : {};
  const previousResponseId = rawObj.openaiResponseId as string | undefined;

  const chatContext = buildChatContext(chat);
  const escalateInstruction = settings.escalatePrompt || DEFAULT_ESCALATE_INSTRUCTION;

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
      escalateInstruction;
    console.log(`[AI][OpenAI] file_search enabled, vector store: ${settings.vectorStoreId}`);
  } else {
    instructions +=
      "\n\n" +
      (chatContext ? chatContext + "\n\n" : "") +
      "## Контекст диалога\n\n" +
      "Учитывай контекст всего диалога: помни, о чём шла речь ранее, что клиент уже спрашивал, " +
      "какую информацию ты ему уже давал. Используй историю переписки для точного ответа.\n\n" +
      escalateInstruction;
    console.log(`[AI][OpenAI] WARNING: no vectorStoreId configured — file_search disabled`);
  }

  const tools: OpenAI.Responses.Tool[] = [];
  if (settings.vectorStoreId) {
    tools.push({
      type: "file_search",
      vector_store_ids: [settings.vectorStoreId],
    });
  }

  const baseParams: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
    model: settings.model!,
    instructions,
    input: [],
    truncation: "auto",
  };
  if (tools.length > 0) {
    baseParams.tools = tools;
  }

  let response: OpenAI.Responses.Response;

  if (previousResponseId) {
    try {
      console.log(`[AI][OpenAI] Continuing conversation, previous_response_id: ${previousResponseId}`);
      response = await client.responses.create({
        ...baseParams,
        previous_response_id: previousResponseId,
        input: [{ role: "user", content: incomingText }],
      });
    } catch (e) {
      console.warn("[AI][OpenAI] previous_response_id failed, falling back to full history:", e);
      const input = await buildInputFromHistory(chatId, incomingText);
      response = await client.responses.create({
        ...baseParams,
        input,
      });
    }
  } else {
    console.log(`[AI][OpenAI] Starting new conversation for chat ${chatId}`);
    const input = await buildInputFromHistory(chatId, incomingText);
    response = await client.responses.create({
      ...baseParams,
      input,
    });
  }

  await prisma.chat.update({
    where: { id: chatId },
    data: { raw: { ...rawObj, openaiResponseId: response.id } },
  });

  let reply: string | null = response.output_text || null;
  if (reply) {
    reply = reply.replace(/【[^】]*†[^】]*】/g, "").replace(/\s{2,}/g, " ").trim();
  }

  console.log(`[AI][OpenAI] Got reply for chat ${chatId}: "${(reply ?? "").slice(0, 100)}"`);
  return reply || null;
}

// ─── DeepSeek (Chat Completions API) ─────────────────────────────────────────

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

async function getDeepSeekReply(
  chatId: string,
  incomingText: string,
  settings: NonNullable<Awaited<ReturnType<typeof getAiSettings>>>,
): Promise<string | null> {
  if (!settings.deepseekApiKey) {
    console.log("[AI] Skip: DeepSeek API key not set");
    return null;
  }

  console.log(`[AI][DeepSeek] Processing message for chat ${chatId}: "${incomingText.slice(0, 80)}"`);

  // DeepSeek is OpenAI-compatible — use OpenAI SDK with custom baseURL
  const client = new OpenAI({
    apiKey: settings.deepseekApiKey,
    baseURL: DEEPSEEK_BASE_URL,
  });

  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { id: true, customerName: true, itemTitle: true, price: true },
  });
  if (!chat) return null;

  const chatContext = buildChatContext(chat);
  const escalateInstruction = settings.escalatePrompt || DEFAULT_ESCALATE_INSTRUCTION;

  // Ищем релевантные чанки в локальной базе знаний
  const kbHasFiles = await hasKnowledgeFiles();
  const knowledgeContext = kbHasFiles
    ? await buildKnowledgeContext(incomingText)
    : null;

  let systemContent = settings.instructions ?? "";

  if (knowledgeContext) {
    systemContent +=
      "\n\n" +
      knowledgeContext +
      "\n\n" +
      (chatContext ? chatContext + "\n\n" : "") +
      "## Работа с базой знаний\n\n" +
      "Используй информацию из базы знаний выше для ответа на вопрос клиента. " +
      "Учитывай контекст всего диалога: помни, о чём шла речь ранее. " +
      "Если в базе знаний нет ответа на вопрос клиента — переводи на менеджера (см. правила ниже).\n\n" +
      escalateInstruction;
    console.log(`[AI][DeepSeek] knowledge base context injected (${knowledgeContext.length} chars)`);
  } else {
    systemContent +=
      "\n\n" +
      (chatContext ? chatContext + "\n\n" : "") +
      "## Контекст диалога\n\n" +
      "Учитывай контекст всего диалога: помни, о чём шла речь ранее, что клиент уже спрашивал, " +
      "какую информацию ты ему уже давал. Используй историю переписки для точного ответа.\n\n" +
      escalateInstruction;
    if (kbHasFiles) {
      console.log(`[AI][DeepSeek] knowledge base has files but no relevant chunks found for query`);
    }
  }

  // Загружаем историю чата
  const historyMessages = await buildInputFromHistory(chatId, incomingText);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    ...historyMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const completion = await client.chat.completions.create({
    model: settings.model!,
    messages,
  });

  const reply = completion.choices[0]?.message?.content?.trim() ?? null;

  console.log(`[AI][DeepSeek] Got reply for chat ${chatId}: "${(reply ?? "").slice(0, 100)}"`);
  return reply || null;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Максимальное количество исторических сообщений для загрузки */
const MAX_HISTORY_MESSAGES = 20;

/**
 * Формирует массив input-сообщений из истории чата в БД.
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

    messages.push({ role: "user", content: currentIncomingText });

    console.log(`[AI] Built input from history: ${messages.length} messages`);
    return messages;
  } catch (e) {
    console.warn("[AI] Failed to load chat history:", e);
    return [{ role: "user", content: currentIncomingText }];
  }
}

/**
 * Формирует контекстную информацию о чате для дополнительных инструкций.
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

/** Список файлов в vector store (только OpenAI) */
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

/** Загрузить файл в vector store (только OpenAI) */
export async function uploadFileToVectorStore(
  apiKey: string,
  vectorStoreId: string,
  file: File,
) {
  const client = new OpenAI({ apiKey });

  const uploaded = await client.files.create({
    file,
    purpose: "assistants",
  });

  const vsFile = await client.vectorStores.files.create(vectorStoreId, {
    file_id: uploaded.id,
  });

  return { fileId: uploaded.id, vsFile };
}

/** Удалить файл из vector store (только OpenAI) */
export async function deleteFileFromVectorStore(
  apiKey: string,
  vectorStoreId: string,
  fileId: string,
) {
  const client = new OpenAI({ apiKey });

  await client.vectorStores.files.delete(fileId, { vector_store_id: vectorStoreId });

  try {
    await client.files.delete(fileId);
  } catch {
    // может уже удалён — не страшно
  }
}
