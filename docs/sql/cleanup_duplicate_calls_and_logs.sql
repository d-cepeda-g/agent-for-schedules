-- PostgreSQL cleanup script for duplicate call rows and repeated call logs.
-- Run in a SQL console connected to the production DATABASE_URL.

-- 1) Preview duplicate scheduled calls.
SELECT
  "customerId",
  date_trunc('minute', "scheduledAt") AS scheduled_minute,
  COALESCE("callReason", '') AS call_reason,
  COALESCE("callPurpose", '') AS call_purpose,
  COALESCE("notes", '') AS notes,
  COUNT(*) AS copies
FROM "ScheduledCall"
GROUP BY
  "customerId",
  date_trunc('minute', "scheduledAt"),
  COALESCE("callReason", ''),
  COALESCE("callPurpose", ''),
  COALESCE("notes", '')
HAVING COUNT(*) > 1
ORDER BY copies DESC, scheduled_minute DESC;

-- 2) Delete duplicate scheduled calls, keeping the most useful row in each group.
--    Preference order: row with conversationId, then best status, then most recently updated.
BEGIN;

WITH ranked_calls AS (
  SELECT
    sc.id,
    ROW_NUMBER() OVER (
      PARTITION BY
        sc."customerId",
        date_trunc('minute', sc."scheduledAt"),
        COALESCE(sc."callReason", ''),
        COALESCE(sc."callPurpose", ''),
        COALESCE(sc."notes", '')
      ORDER BY
        CASE WHEN COALESCE(sc."conversationId", '') <> '' THEN 0 ELSE 1 END,
        CASE sc.status
          WHEN 'completed' THEN 0
          WHEN 'dispatched' THEN 1
          WHEN 'dispatching' THEN 2
          WHEN 'pending' THEN 3
          WHEN 'failed' THEN 4
          WHEN 'cancelled' THEN 5
          ELSE 6
        END,
        sc."updatedAt" DESC,
        sc."createdAt" DESC,
        sc.id DESC
    ) AS row_num
  FROM "ScheduledCall" sc
)
DELETE FROM "ScheduledCall" AS sc
USING ranked_calls AS rc
WHERE sc.id = rc.id
  AND rc.row_num > 1;

COMMIT;

-- 3) Optional: remove repeated call log rows (same call/event/message/details in same minute).
--    Uncomment and run only if you want log-level deduplication too.
-- BEGIN;
--
-- WITH ranked_logs AS (
--   SELECT
--     cl.id,
--     ROW_NUMBER() OVER (
--       PARTITION BY
--         cl."scheduledCallId",
--         cl.event,
--         cl.level,
--         cl.message,
--         COALESCE(cl.details, ''),
--         date_trunc('minute', cl."createdAt")
--       ORDER BY cl."createdAt" ASC, cl.id ASC
--     ) AS row_num
--   FROM "CallLog" cl
-- )
-- DELETE FROM "CallLog" AS cl
-- USING ranked_logs AS rl
-- WHERE cl.id = rl.id
--   AND rl.row_num > 1;
--
-- COMMIT;
