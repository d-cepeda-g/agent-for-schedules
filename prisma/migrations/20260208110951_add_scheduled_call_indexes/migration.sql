-- Add indexes for hot ScheduledCall query paths.
CREATE INDEX IF NOT EXISTS "ScheduledCall_customerId_idx" ON "ScheduledCall"("customerId");
CREATE INDEX IF NOT EXISTS "ScheduledCall_status_idx" ON "ScheduledCall"("status");
CREATE INDEX IF NOT EXISTS "ScheduledCall_scheduledAt_idx" ON "ScheduledCall"("scheduledAt");
CREATE INDEX IF NOT EXISTS "ScheduledCall_batchId_idx" ON "ScheduledCall"("batchId");
CREATE INDEX IF NOT EXISTS "ScheduledCall_conversationId_idx" ON "ScheduledCall"("conversationId");
