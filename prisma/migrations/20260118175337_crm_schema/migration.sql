/*
  Warnings:

  - You are about to drop the column `avitoAccessToken` on the `IntegrationState` table. All the data in the column will be lost.
  - You are about to drop the column `avitoAccessTokenExpiresAt` on the `IntegrationState` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `IntegrationState` table. All the data in the column will be lost.
  - You are about to drop the column `lastSyncAt` on the `IntegrationState` table. All the data in the column will be lost.
  - You are about to drop the column `author` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `createdDbAt` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `deliveredToAvito` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `deliveryError` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `key` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `processedByBotAt` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `readByManagerAt` on the `Message` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[chatId,avitoMessageId]` on the table `Message` will be added. If there are existing duplicate values, this will fail.
  - Made the column `raw` on table `Chat` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `avitoMessageId` to the `Message` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sentAt` to the `Message` table without a default value. This is not possible if the table is not empty.
  - Made the column `raw` on table `Message` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "Message_chatId_createdAt_idx";

-- DropIndex
DROP INDEX "Message_key_key";

-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "unreadCount" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "raw" SET NOT NULL,
ALTER COLUMN "raw" SET DEFAULT '{}';

-- AlterTable
ALTER TABLE "IntegrationState" DROP COLUMN "avitoAccessToken",
DROP COLUMN "avitoAccessTokenExpiresAt",
DROP COLUMN "createdAt",
DROP COLUMN "lastSyncAt",
ADD COLUMN     "accessToken" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "refreshToken" TEXT;

-- AlterTable
ALTER TABLE "Message" DROP COLUMN "author",
DROP COLUMN "createdDbAt",
DROP COLUMN "deliveredToAvito",
DROP COLUMN "deliveryError",
DROP COLUMN "key",
DROP COLUMN "processedByBotAt",
DROP COLUMN "readByManagerAt",
ADD COLUMN     "avitoMessageId" TEXT NOT NULL,
ADD COLUMN     "isRead" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sentAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "raw" SET NOT NULL,
ALTER COLUMN "raw" SET DEFAULT '{}';

-- DropEnum
DROP TYPE "MessageAuthor";

-- CreateIndex
CREATE INDEX "Message_chatId_sentAt_idx" ON "Message"("chatId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_chatId_avitoMessageId_key" ON "Message"("chatId", "avitoMessageId");
