-- CreateTable
CREATE TABLE "CallActionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduledCallId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'data_collection',
    "key" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CallActionItem_scheduledCallId_fkey" FOREIGN KEY ("scheduledCallId") REFERENCES "ScheduledCall" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CallActionItem_scheduledCallId_createdAt_idx" ON "CallActionItem"("scheduledCallId", "createdAt");

-- CreateIndex
CREATE INDEX "CallActionItem_conversationId_idx" ON "CallActionItem"("conversationId");
