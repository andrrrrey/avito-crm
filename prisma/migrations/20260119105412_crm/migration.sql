-- CreateIndex
CREATE INDEX "Chat_status_pinned_lastMessageAt_idx" ON "Chat"("status", "pinned", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Chat_status_pinned_price_idx" ON "Chat"("status", "pinned", "price");

-- CreateIndex
CREATE INDEX "Message_chatId_direction_isRead_idx" ON "Message"("chatId", "direction", "isRead");
