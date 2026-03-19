-- Migration: isolate user chats indexes
-- Replace simple status/pinned/time indexes with accountId-prefixed compound indexes.
-- In a multi-user setup every chat query starts with WHERE accountId = $N,
-- so accountId must be the leading column for PostgreSQL to use the index efficiently.

-- Drop old indexes
DROP INDEX IF EXISTS "Chat_status_pinned_lastMessageAt_idx";
DROP INDEX IF EXISTS "Chat_status_pinned_price_idx";

-- Create new compound indexes (accountId is always the first filter column)
CREATE INDEX "Chat_accountId_status_pinned_lastMessageAt_idx"
  ON "Chat"("accountId", "status", "pinned", "lastMessageAt");

CREATE INDEX "Chat_accountId_status_pinned_price_idx"
  ON "Chat"("accountId", "status", "pinned", "price");
