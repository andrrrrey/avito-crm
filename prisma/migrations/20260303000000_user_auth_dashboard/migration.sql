-- AlterTable: make username optional, add email and per-user fields
ALTER TABLE "User" ALTER COLUMN "username" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'USER';
ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "avitoClientId" TEXT;
ALTER TABLE "User" ADD COLUMN "avitoClientSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "avitoAccountId" INTEGER;
ALTER TABLE "User" ADD COLUMN "aiInstructions" TEXT;
ALTER TABLE "User" ADD COLUMN "aiEscalatePrompt" TEXT;

-- CreateIndex: unique email constraint
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AlterTable: add userId to KnowledgeBaseFile
ALTER TABLE "KnowledgeBaseFile" ADD COLUMN "userId" TEXT;

-- CreateIndex: index on userId
CREATE INDEX "KnowledgeBaseFile_userId_idx" ON "KnowledgeBaseFile"("userId");

-- AddForeignKey
ALTER TABLE "KnowledgeBaseFile" ADD CONSTRAINT "KnowledgeBaseFile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
