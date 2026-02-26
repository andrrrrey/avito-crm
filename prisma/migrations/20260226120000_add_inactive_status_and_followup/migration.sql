-- Добавляем новый статус INACTIVE в перечисление ChatStatus
ALTER TYPE "ChatStatus" ADD VALUE IF NOT EXISTS 'INACTIVE';

-- Добавляем поле followupSentAt в таблицу Chat
ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "followupSentAt" TIMESTAMP(3);

-- Индекс для быстрого поиска чатов, требующих дожима
CREATE INDEX IF NOT EXISTS "Chat_status_followupSentAt_lastMessageAt_idx"
  ON "Chat"("status", "followupSentAt", "lastMessageAt");
