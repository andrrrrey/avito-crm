-- Add chat labels (color)

-- CreateEnum
CREATE TYPE "ChatLabelColor" AS ENUM ('YELLOW', 'RED', 'BLUE', 'GREEN');

-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "labelColor" "ChatLabelColor";

-- Index for filtering/sorting
CREATE INDEX "Chat_labelColor_idx" ON "Chat"("labelColor");
