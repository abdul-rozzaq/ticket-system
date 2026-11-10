-- NOTE: "KbChunk_embedding_idx" (hnsw) is hand-written in the init migration; Prisma cannot see it, so the
-- DROP INDEX that `migrate diff` suggested was removed on purpose.

-- CreateTable
CREATE TABLE "IntakeBuffer" (
    "id" UUID NOT NULL,
    "clientGroupId" UUID NOT NULL,
    "chatId" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeBuffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserbotCommand" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "UserbotCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntakeBuffer_clientGroupId_key" ON "IntakeBuffer"("clientGroupId");

-- CreateIndex
CREATE INDEX "IntakeBuffer_lastAt_idx" ON "IntakeBuffer"("lastAt");

-- CreateIndex
CREATE INDEX "UserbotCommand_status_createdAt_idx" ON "UserbotCommand"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FilteredMessage_clientGroupId_telegramMessageId_key" ON "FilteredMessage"("clientGroupId", "telegramMessageId");

