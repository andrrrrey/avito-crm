-- Add followupEnabled flag to AiAssistant settings
-- Allows disabling the follow-up ("дожим") feature from the AI settings page

-- AlterTable
ALTER TABLE "AiAssistant" ADD COLUMN "followupEnabled" BOOLEAN NOT NULL DEFAULT true;
