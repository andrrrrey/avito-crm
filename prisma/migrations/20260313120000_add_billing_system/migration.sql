-- Migration: add_billing_system
-- Добавляет систему монетизации: конфиг биллинга, балансы пользователей,
-- лог AI-ответов с полным расчётом стоимости, история транзакций.

-- Enum для типов транзакций баланса
CREATE TYPE "TransactionType" AS ENUM ('TOPUP', 'CHARGE', 'REFUND', 'BONUS');

-- Конфиг биллинга (синглтон id=1): наценка, курс, прайсы провайдеров
CREATE TABLE "BillingConfig" (
    "id"                  INTEGER NOT NULL DEFAULT 1,
    "markupMultiplier"    DECIMAL(6,3)  NOT NULL DEFAULT 2.5,
    "usdToRub"            DECIMAL(8,4)  NOT NULL DEFAULT 90,
    "gpt52InputPrice"     DECIMAL(10,4) NOT NULL DEFAULT 15,
    "gpt52OutputPrice"    DECIMAL(10,4) NOT NULL DEFAULT 60,
    "deepseekInputPrice"  DECIMAL(10,4) NOT NULL DEFAULT 0.27,
    "deepseekOutputPrice" DECIMAL(10,4) NOT NULL DEFAULT 1.10,
    "updatedAt"           TIMESTAMP(3)  NOT NULL,

    CONSTRAINT "BillingConfig_pkey" PRIMARY KEY ("id")
);

-- Баланс пользователя (в рублях)
CREATE TABLE "UserBalance" (
    "id"        TEXT         NOT NULL,
    "userId"    TEXT         NOT NULL,
    "balance"   DECIMAL(12,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBalance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserBalance_userId_key" ON "UserBalance"("userId");

-- Детальный лог каждого AI-ответа с полным расчётом
CREATE TABLE "AiMessageBilling" (
    "id"               TEXT         NOT NULL,
    "userId"           TEXT         NOT NULL,
    "chatId"           TEXT         NOT NULL,
    "model"            TEXT         NOT NULL,
    "inputTokens"      INTEGER      NOT NULL,
    "outputTokens"     INTEGER      NOT NULL,
    "inputPriceUsd"    DECIMAL(10,6) NOT NULL,
    "outputPriceUsd"   DECIMAL(10,6) NOT NULL,
    "usdToRub"         DECIMAL(8,4)  NOT NULL,
    "markupMultiplier" DECIMAL(6,3)  NOT NULL,
    "costUsd"          DECIMAL(10,6) NOT NULL,
    "costRub"          DECIMAL(10,4) NOT NULL,
    "chargedRub"       DECIMAL(10,4) NOT NULL,
    "profitRub"        DECIMAL(10,4) NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessageBilling_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiMessageBilling_userId_createdAt_idx" ON "AiMessageBilling"("userId", "createdAt");
CREATE INDEX "AiMessageBilling_createdAt_idx"         ON "AiMessageBilling"("createdAt");

-- Все движения по балансу: пополнения, списания, бонусы, возвраты
CREATE TABLE "BalanceTransaction" (
    "id"           TEXT              NOT NULL,
    "userId"       TEXT              NOT NULL,
    "type"         "TransactionType" NOT NULL,
    "amount"       DECIMAL(12,4)     NOT NULL,
    "balanceAfter" DECIMAL(12,4)     NOT NULL,
    "description"  TEXT,
    "aiMessageId"  TEXT,
    "createdAt"    TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BalanceTransaction_userId_createdAt_idx" ON "BalanceTransaction"("userId", "createdAt");

-- Foreign keys
ALTER TABLE "UserBalance"        ADD CONSTRAINT "UserBalance_userId_fkey"        FOREIGN KEY ("userId")    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiMessageBilling"   ADD CONSTRAINT "AiMessageBilling_userId_fkey"   FOREIGN KEY ("userId")    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BalanceTransaction" ADD CONSTRAINT "BalanceTransaction_userId_fkey" FOREIGN KEY ("userId")    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
