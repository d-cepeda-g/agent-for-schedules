-- CreateTable
CREATE TABLE "CallLog" (
    "id" TEXT NOT NULL,
    "scheduledCallId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallLog_scheduledCallId_createdAt_idx" ON "CallLog"("scheduledCallId", "createdAt");

-- CreateIndex
CREATE INDEX "CallLog_event_idx" ON "CallLog"("event");

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_scheduledCallId_fkey" FOREIGN KEY ("scheduledCallId") REFERENCES "ScheduledCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;
