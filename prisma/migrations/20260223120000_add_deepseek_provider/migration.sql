-- AlterTable
ALTER TABLE "AiAssistant" ADD COLUMN "provider" TEXT DEFAULT 'openai';
ALTER TABLE "AiAssistant" ADD COLUMN "deepseekApiKey" TEXT;
