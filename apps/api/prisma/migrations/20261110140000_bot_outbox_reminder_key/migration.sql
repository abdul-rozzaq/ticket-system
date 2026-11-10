-- AlterTable
ALTER TABLE "Reminder" ADD COLUMN     "key" TEXT;

-- CreateTable
CREATE TABLE "BotOutbox" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "BotOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotOutbox_status_createdAt_idx" ON "BotOutbox"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_key_key" ON "Reminder"("key");

