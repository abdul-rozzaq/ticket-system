
-- CreateTable
CREATE TABLE "AiDraft" (
    "id" UUID NOT NULL,
    "clientGroupId" UUID NOT NULL,
    "ticketId" UUID,
    "userId" UUID,
    "sourceMessageId" BIGINT,
    "text" TEXT,
    "notFound" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'extractive',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "AiDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiDraft_clientGroupId_createdAt_idx" ON "AiDraft"("clientGroupId", "createdAt");

-- CreateIndex
CREATE INDEX "AiDraft_createdAt_idx" ON "AiDraft"("createdAt");

