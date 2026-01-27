-- CreateEnum
CREATE TYPE "ChatStatus" AS ENUM ('BOT', 'MANAGER');

-- CreateEnum
CREATE TYPE "MessageAuthor" AS ENUM ('CUSTOMER', 'BOT', 'MANAGER');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "IntegrationState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "avitoAccessToken" TEXT,
    "avitoAccessTokenExpiresAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL,
    "avitoChatId" TEXT NOT NULL,
    "accountId" INTEGER NOT NULL,
    "status" "ChatStatus" NOT NULL DEFAULT 'BOT',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "customerName" TEXT,
    "itemTitle" TEXT,
    "price" INTEGER,
    "adUrl" TEXT,
    "chatUrl" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessageText" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "author" "MessageAuthor" NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "readByManagerAt" TIMESTAMP(3),
    "processedByBotAt" TIMESTAMP(3),
    "deliveredToAvito" BOOLEAN NOT NULL DEFAULT false,
    "deliveryError" TEXT,
    "raw" JSONB,
    "createdDbAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Chat_avitoChatId_key" ON "Chat"("avitoChatId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_key_key" ON "Message"("key");

-- CreateIndex
CREATE INDEX "Message_chatId_createdAt_idx" ON "Message"("chatId", "createdAt");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
