-- Add manualUnread to Chat
ALTER TABLE "Chat" ADD COLUMN     "manualUnread" BOOLEAN NOT NULL DEFAULT false;
