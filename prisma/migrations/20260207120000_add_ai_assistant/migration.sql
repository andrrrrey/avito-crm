-- CreateTable
CREATE TABLE "AiAssistant" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "apiKey" TEXT,
    "assistantId" TEXT,
    "vectorStoreId" TEXT,
    "instructions" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAssistant_pkey" PRIMARY KEY ("id")
);
