
-- CreateTable
CREATE TABLE "FolderOperation" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FolderOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FolderOperation_createdAt_idx" ON "FolderOperation"("createdAt");

-- CreateIndex
CREATE INDEX "FolderOperation_runId_idx" ON "FolderOperation"("runId");

