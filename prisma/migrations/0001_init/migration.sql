-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledCall" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "agentId" TEXT NOT NULL DEFAULT '',
    "conversationId" TEXT NOT NULL DEFAULT '',
    "batchId" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallEvaluation" (
    "id" TEXT NOT NULL,
    "scheduledCallId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "result" TEXT NOT NULL DEFAULT 'unknown',
    "rationale" TEXT NOT NULL DEFAULT '',
    "transcript" TEXT NOT NULL DEFAULT '',
    "duration" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallActionItem" (
    "id" TEXT NOT NULL,
    "scheduledCallId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'data_collection',
    "key" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallEvaluation_scheduledCallId_key" ON "CallEvaluation"("scheduledCallId");

-- CreateIndex
CREATE INDEX "CallActionItem_scheduledCallId_createdAt_idx" ON "CallActionItem"("scheduledCallId", "createdAt");

-- CreateIndex
CREATE INDEX "CallActionItem_conversationId_idx" ON "CallActionItem"("conversationId");

-- AddForeignKey
ALTER TABLE "ScheduledCall" ADD CONSTRAINT "ScheduledCall_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallEvaluation" ADD CONSTRAINT "CallEvaluation_scheduledCallId_fkey" FOREIGN KEY ("scheduledCallId") REFERENCES "ScheduledCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallActionItem" ADD CONSTRAINT "CallActionItem_scheduledCallId_fkey" FOREIGN KEY ("scheduledCallId") REFERENCES "ScheduledCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

