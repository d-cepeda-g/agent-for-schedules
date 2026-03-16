-- CreateTable
CREATE TABLE "InboundCall" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "callerPhone" TEXT NOT NULL,
    "customerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "intent" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "transcript" TEXT NOT NULL DEFAULT '',
    "duration" INTEGER NOT NULL DEFAULT 0,
    "sentiment" TEXT NOT NULL DEFAULT 'neutral',
    "followUpNeeded" BOOLEAN NOT NULL DEFAULT false,
    "followUpNotes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundCallActionItem" (
    "id" TEXT NOT NULL,
    "inboundCallId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundCallActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundCall_conversationId_key" ON "InboundCall"("conversationId");

-- CreateIndex
CREATE INDEX "InboundCall_customerId_idx" ON "InboundCall"("customerId");

-- CreateIndex
CREATE INDEX "InboundCall_callerPhone_idx" ON "InboundCall"("callerPhone");

-- CreateIndex
CREATE INDEX "InboundCall_status_idx" ON "InboundCall"("status");

-- CreateIndex
CREATE INDEX "InboundCall_createdAt_idx" ON "InboundCall"("createdAt");

-- CreateIndex
CREATE INDEX "InboundCallActionItem_inboundCallId_createdAt_idx" ON "InboundCallActionItem"("inboundCallId", "createdAt");

-- AddForeignKey
ALTER TABLE "InboundCall" ADD CONSTRAINT "InboundCall_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundCallActionItem" ADD CONSTRAINT "InboundCallActionItem_inboundCallId_fkey" FOREIGN KEY ("inboundCallId") REFERENCES "InboundCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;
