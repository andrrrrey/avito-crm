-- AlterTable: add followupEnabled flag to User (per-user дожим toggle)
ALTER TABLE "User" ADD COLUMN "followupEnabled" BOOLEAN NOT NULL DEFAULT true;
