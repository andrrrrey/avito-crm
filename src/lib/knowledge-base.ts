// src/lib/knowledge-base.ts
// Локальная база знаний для DeepSeek — хранит файлы и чанки в PostgreSQL,
// поиск через полнотекстовый поиск (tsvector/tsquery).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Размер чанка в символах */
const CHUNK_SIZE = 1000;
/** Перекрытие между чанками */
const CHUNK_OVERLAP = 200;
/** Максимальное число чанков, возвращаемых при поиске */
const MAX_CHUNKS = 5;
/** Поддерживаемые MIME-типы для извлечения текста */
const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
  "application/x-yaml",
  "text/yaml",
  "text/x-yaml",
]);

/** Проверить, поддерживается ли файл для извлечения текста */
export function isSupportedFile(file: File): boolean {
  if (TEXT_MIME_TYPES.has(file.type)) return true;
  // Дополнительно проверяем по расширению
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".csv") ||
    name.endsWith(".json") ||
    name.endsWith(".yaml") ||
    name.endsWith(".yml") ||
    name.endsWith(".html") ||
    name.endsWith(".htm")
  );
}

/** Разбить текст на перекрывающиеся чанки */
export function chunkText(text: string): string[] {
  // Нормализуем переносы строк и убираем лишние пробелы
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(start + CHUNK_SIZE, normalized.length);
    const chunk = normalized.slice(start, end).trim();
    if (chunk.length >= 30) {
      chunks.push(chunk);
    }
    if (end >= normalized.length) break;
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks;
}

/** Извлечь текст из файла (только plain-text форматы) */
export async function extractTextFromFile(file: File): Promise<string> {
  const text = await file.text();
  if (!text || text.trim().length === 0) {
    throw new Error("Файл пустой или не содержит текста");
  }
  return text;
}

/** Сохранить файл и его чанки в БД (опционально привязать к пользователю) */
export async function storeKnowledgeFile(
  filename: string,
  fileSize: number,
  mimeType: string,
  content: string,
  userId?: string,
): Promise<{ id: string; chunksCount: number }> {
  const chunks = chunkText(content);
  if (chunks.length === 0) {
    throw new Error("Не удалось разбить файл на чанки — возможно файл слишком короткий");
  }

  const kbFile = await prisma.knowledgeBaseFile.create({
    data: {
      ...(userId ? { userId } : {}),
      filename,
      fileSize,
      mimeType,
      chunks: {
        create: chunks.map((chunkContent, chunkIndex) => ({
          content: chunkContent,
          chunkIndex,
        })),
      },
    },
  });

  return { id: kbFile.id, chunksCount: chunks.length };
}

/** Удалить файл из базы знаний (чанки удаляются каскадно) */
export async function deleteKnowledgeFile(fileId: string): Promise<void> {
  await prisma.knowledgeBaseFile.delete({ where: { id: fileId } });
}

/** Получить список файлов в базе знаний (для конкретного пользователя или глобально) */
export async function listKnowledgeFiles(userId?: string) {
  const files = await prisma.knowledgeBaseFile.findMany({
    where: userId ? { userId } : {},
    select: {
      id: true,
      filename: true,
      fileSize: true,
      mimeType: true,
      createdAt: true,
      _count: { select: { chunks: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return files.map((f) => ({
    id: f.id,
    filename: f.filename,
    fileSize: f.fileSize,
    mimeType: f.mimeType,
    createdAt: f.createdAt,
    chunksCount: f._count.chunks,
    // Unix timestamp для единообразия с OpenAI-форматом
    created_at: Math.floor(f.createdAt.getTime() / 1000),
  }));
}

/** Проверить, есть ли файлы в базе знаний (для пользователя или глобально) */
export async function hasKnowledgeFiles(userId?: string): Promise<boolean> {
  const count = await prisma.knowledgeBaseFile.count({
    where: userId ? { userId } : {},
  });
  return count > 0;
}

/**
 * Поиск по базе знаний с помощью PostgreSQL full-text search.
 * Использует конфигурацию 'simple' (без стемминга) — работает для любого языка.
 * Возвращает массив текстов релевантных чанков.
 * Если передан userId — ищет только в файлах этого пользователя.
 */
export async function searchKnowledgeBase(query: string, userId?: string): Promise<string[]> {
  if (!query || query.trim().length === 0) return [];

  try {
    // Очищаем запрос от спецсимволов tsquery
    const sanitized = query.replace(/[&|!():*]/g, " ").trim();
    if (!sanitized) return [];

    let ftsResults: Array<{ content: string }>;

    if (userId) {
      // Поиск только по файлам пользователя через JOIN
      ftsResults = await prisma.$queryRaw<Array<{ content: string }>>`
        SELECT c.content
        FROM "KnowledgeBaseChunk" c
        JOIN "KnowledgeBaseFile" f ON c."fileId" = f.id
        WHERE f."userId" = ${userId}
          AND to_tsvector('simple', c.content) @@ plainto_tsquery('simple', ${sanitized})
        ORDER BY ts_rank(to_tsvector('simple', c.content), plainto_tsquery('simple', ${sanitized})) DESC
        LIMIT ${MAX_CHUNKS}
      `;
    } else {
      // Глобальный поиск (без фильтра по пользователю)
      ftsResults = await prisma.$queryRaw<Array<{ content: string }>>`
        SELECT content
        FROM "KnowledgeBaseChunk"
        WHERE to_tsvector('simple', content) @@ plainto_tsquery('simple', ${sanitized})
        ORDER BY ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', ${sanitized})) DESC
        LIMIT ${MAX_CHUNKS}
      `;
    }

    if (ftsResults.length > 0) {
      return ftsResults.map((r) => r.content);
    }

    // Fallback: keyword ILIKE поиск по первым трём словам запроса
    const keywords = sanitized.split(/\s+/).filter((w) => w.length >= 3).slice(0, 3);
    if (keywords.length === 0) return [];

    if (userId) {
      const conditions = keywords.map((kw) => Prisma.sql`c.content ILIKE ${"%" + kw + "%"}`);
      const whereClause = conditions.reduce(
        (acc, cond) => Prisma.sql`${acc} OR ${cond}`,
      );
      const likeResults = await prisma.$queryRaw<Array<{ content: string }>>(
        Prisma.sql`
          SELECT c.content FROM "KnowledgeBaseChunk" c
          JOIN "KnowledgeBaseFile" f ON c."fileId" = f.id
          WHERE f."userId" = ${userId} AND (${whereClause})
          LIMIT ${MAX_CHUNKS}
        `,
      );
      return likeResults.map((r) => r.content);
    } else {
      const conditions = keywords.map((kw) => Prisma.sql`content ILIKE ${"%" + kw + "%"}`);
      const whereClause = conditions.reduce(
        (acc, cond) => Prisma.sql`${acc} OR ${cond}`,
      );
      const likeResults = await prisma.$queryRaw<Array<{ content: string }>>(
        Prisma.sql`SELECT content FROM "KnowledgeBaseChunk" WHERE ${whereClause} LIMIT ${MAX_CHUNKS}`,
      );
      return likeResults.map((r) => r.content);
    }
  } catch (e) {
    console.warn("[KB] searchKnowledgeBase error:", e);
    return [];
  }
}

/**
 * Формирует блок контекста из базы знаний для вставки в системный промпт.
 * Возвращает null, если ничего не найдено.
 */
export async function buildKnowledgeContext(query: string, userId?: string): Promise<string | null> {
  const chunks = await searchKnowledgeBase(query, userId);
  if (chunks.length === 0) return null;

  const context = chunks.join("\n\n---\n\n");
  return (
    "## Информация из базы знаний\n\n" +
    "Используй следующие данные из базы знаний для ответа на вопрос клиента:\n\n" +
    context
  );
}
