-- AlterTable
ALTER TABLE "ScheduledCall"
ADD COLUMN "callReason" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ScheduledCall"
ADD COLUMN "callPurpose" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ScheduledCall"
ADD COLUMN "preferredLanguage" TEXT NOT NULL DEFAULT 'English';
