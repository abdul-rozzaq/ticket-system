-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'WAITING_CLIENT', 'CLOSED');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "SystemType" AS ENUM ('AMOCRM', 'BITRIX24', 'PBX', 'OTHER');

-- CreateEnum
CREATE TYPE "AssignmentStrategy" AS ENUM ('MANUAL', 'FIXED_OWNER', 'ROUND_ROBIN', 'LEAST_LOADED', 'ON_DUTY');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "KbStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "onDuty" BOOLEAN NOT NULL DEFAULT false,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "workingHours" JSONB,
    "telegramUserId" BIGINT,
    "telegramLinkHash" TEXT,
    "telegramLinkExpiry" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" UUID,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "ip" TEXT,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPolicy" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "firstResponseMinutes" INTEGER NOT NULL DEFAULT 30,
    "resolutionMinutes" INTEGER NOT NULL DEFAULT 480,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientGroup" (
    "id" UUID NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "systemType" "SystemType" NOT NULL DEFAULT 'OTHER',
    "language" TEXT NOT NULL DEFAULT 'uz',
    "defaultOwnerId" UUID,
    "slaPolicyId" UUID,
    "assignmentStrategy" "AssignmentStrategy",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "clientGroupId" UUID NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'NEW',
    "assigneeId" UUID,
    "urgency" "Urgency" NOT NULL DEFAULT 'NORMAL',
    "category" TEXT NOT NULL DEFAULT 'other',
    "systemType" "SystemType" NOT NULL DEFAULT 'OTHER',
    "summary" TEXT NOT NULL DEFAULT '',
    "aiConfidence" DOUBLE PRECISION,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstResponseAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" UUID,
    "solutionNote" TEXT,
    "slaDeadline" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousTicketId" UUID,
    "mergedIntoId" UUID,
    "createdFromFilteredId" UUID,
    "cardChatId" TEXT,
    "cardMessageId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketMessage" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "chatId" TEXT NOT NULL,
    "telegramMessageId" BIGINT,
    "senderTelegramId" BIGINT,
    "senderName" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "text" TEXT NOT NULL,
    "mediaMeta" JSONB,
    "isInternalNote" BOOLEAN NOT NULL DEFAULT false,
    "answeredById" UUID,
    "answeredConfidence" DOUBLE PRECISION,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketEvent" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Funnel" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Funnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunnelStage" (
    "id" UUID NOT NULL,
    "funnelId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "userId" UUID,
    "position" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FunnelStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyUz" TEXT NOT NULL,
    "bodyRu" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KbArticle" (
    "id" UUID NOT NULL,
    "status" "KbStatus" NOT NULL DEFAULT 'DRAFT',
    "lang" TEXT NOT NULL DEFAULT 'uz',
    "systemType" "SystemType" NOT NULL DEFAULT 'OTHER',
    "category" TEXT NOT NULL DEFAULT 'other',
    "problem" TEXT NOT NULL,
    "solution" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceTicketId" UUID,
    "createdById" UUID,
    "approvedById" UUID,
    "sentUnchanged" INTEGER NOT NULL DEFAULT 0,
    "sentEdited" INTEGER NOT NULL DEFAULT 0,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KbArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KbChunk" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),

    CONSTRAINT "KbChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProvider" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiKeyEnc" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "providerId" UUID,
    "classifyModel" TEXT NOT NULL DEFAULT '',
    "draftModel" TEXT NOT NULL DEFAULT '',
    "embeddingModel" TEXT NOT NULL DEFAULT '',
    "summaryModel" TEXT NOT NULL DEFAULT '',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "maxTokens" INTEGER NOT NULL DEFAULT 1024,
    "prompts" JSONB NOT NULL DEFAULT '{}',
    "monthlyBudgetUsd" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "hardStop" BOOLEAN NOT NULL DEFAULT true,
    "maskPolicy" TEXT NOT NULL DEFAULT 'ALWAYS',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageLog" (
    "id" UUID NOT NULL,
    "task" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "ticketId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilteredMessage" (
    "id" UUID NOT NULL,
    "clientGroupId" UUID NOT NULL,
    "telegramMessageId" BIGINT,
    "senderName" TEXT,
    "text" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "aiVerdict" JSONB,
    "createdTicketId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FilteredMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramFolderState" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "telegramFilterId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "chatCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramFolderState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserbotSession" (
    "id" UUID NOT NULL,
    "phone" TEXT,
    "sessionEnc" TEXT,
    "status" TEXT NOT NULL DEFAULT 'LOGGED_OUT',
    "lastActivityAt" TIMESTAMP(3),
    "info" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserbotSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" UUID NOT NULL,
    "ticketId" UUID,
    "userId" UUID,
    "kind" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffActivity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "chatId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramUserId_key" ON "User"("telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "LoginAttempt_username_createdAt_idx" ON "LoginAttempt"("username", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ip_createdAt_idx" ON "LoginAttempt"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE UNIQUE INDEX "ClientGroup_telegramChatId_key" ON "ClientGroup"("telegramChatId");

-- CreateIndex
CREATE INDEX "ClientGroup_isActive_idx" ON "ClientGroup"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_number_key" ON "Ticket"("number");

-- CreateIndex
CREATE INDEX "Ticket_status_assigneeId_idx" ON "Ticket"("status", "assigneeId");

-- CreateIndex
CREATE INDEX "Ticket_clientGroupId_status_idx" ON "Ticket"("clientGroupId", "status");

-- CreateIndex
CREATE INDEX "Ticket_openedAt_idx" ON "Ticket"("openedAt");

-- CreateIndex
CREATE INDEX "Ticket_closedAt_idx" ON "Ticket"("closedAt");

-- CreateIndex
CREATE INDEX "Ticket_slaDeadline_idx" ON "Ticket"("slaDeadline");

-- CreateIndex
CREATE INDEX "TicketMessage_ticketId_sentAt_idx" ON "TicketMessage"("ticketId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "TicketMessage_chatId_telegramMessageId_key" ON "TicketMessage"("chatId", "telegramMessageId");

-- CreateIndex
CREATE INDEX "TicketEvent_ticketId_createdAt_idx" ON "TicketEvent"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "FunnelStage_funnelId_position_idx" ON "FunnelStage"("funnelId", "position");

-- CreateIndex
CREATE INDEX "Template_category_idx" ON "Template"("category");

-- CreateIndex
CREATE INDEX "KbArticle_status_idx" ON "KbArticle"("status");

-- CreateIndex
CREATE INDEX "KbChunk_articleId_idx" ON "KbChunk"("articleId");

-- CreateIndex
CREATE INDEX "AiUsageLog_createdAt_idx" ON "AiUsageLog"("createdAt");

-- CreateIndex
CREATE INDEX "AiUsageLog_task_createdAt_idx" ON "AiUsageLog"("task", "createdAt");

-- CreateIndex
CREATE INDEX "FilteredMessage_clientGroupId_createdAt_idx" ON "FilteredMessage"("clientGroupId", "createdAt");

-- CreateIndex
CREATE INDEX "FilteredMessage_createdAt_idx" ON "FilteredMessage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramFolderState_key_key" ON "TelegramFolderState"("key");

-- CreateIndex
CREATE INDEX "Reminder_dueAt_sentAt_idx" ON "Reminder"("dueAt", "sentAt");

-- CreateIndex
CREATE INDEX "StaffActivity_chatId_ts_idx" ON "StaffActivity"("chatId", "ts");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientGroup" ADD CONSTRAINT "ClientGroup_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "SlaPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_clientGroupId_fkey" FOREIGN KEY ("clientGroupId") REFERENCES "ClientGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelStage" ADD CONSTRAINT "FunnelStage_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "Funnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbChunk" ADD CONSTRAINT "KbChunk_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KbArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilteredMessage" ADD CONSTRAINT "FilteredMessage_clientGroupId_fkey" FOREIGN KEY ("clientGroupId") REFERENCES "ClientGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffActivity" ADD CONSTRAINT "StaffActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (not expressible in schema.prisma)
-- ---------------------------------------------------------------------------

-- One open ticket per client group. The DB arbitrates races between the intake worker, the API and manual creation.
CREATE UNIQUE INDEX "Ticket_one_open_per_group" ON "Ticket"("clientGroupId") WHERE "status" <> 'CLOSED';

-- A closed ticket must have closedAt; an open one must not.
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_closed_consistency"
  CHECK (("status" = 'CLOSED') = ("closedAt" IS NOT NULL));

-- Vector similarity index (cosine). Works with NULL embeddings (articles without an embedding model use full-text).
CREATE INDEX "KbChunk_embedding_idx" ON "KbChunk" USING hnsw ("embedding" vector_cosine_ops);

-- Full-text search fallback for the knowledge base (simple dictionary: uz/ru have no built-in stemmers).
CREATE INDEX "KbArticle_fts_idx" ON "KbArticle"
  USING gin (to_tsvector('simple', coalesce("problem", '') || ' ' || coalesce("solution", '')));

-- Singleton row for AI settings.
INSERT INTO "AiSettings" ("id", "updatedAt") VALUES (1, now()) ON CONFLICT DO NOTHING;
