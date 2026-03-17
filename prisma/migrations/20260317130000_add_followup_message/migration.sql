-- AlterTable: add followupMessage to User (per-user custom bot follow-up text)
ALTER TABLE "User" ADD COLUMN "followupMessage" TEXT;
