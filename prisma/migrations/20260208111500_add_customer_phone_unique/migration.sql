-- Repoint scheduled calls to a canonical customer when duplicate phones exist.
WITH ranked_customers AS (
  SELECT
    "id",
    "phone",
    FIRST_VALUE("id") OVER (
      PARTITION BY "phone"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY "phone"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS row_num
  FROM "Customer"
), duplicate_customers AS (
  SELECT "id", keep_id
  FROM ranked_customers
  WHERE row_num > 1
)
UPDATE "ScheduledCall" AS sc
SET "customerId" = dc.keep_id
FROM duplicate_customers AS dc
WHERE sc."customerId" = dc."id";

-- Remove duplicate customer rows after references are updated.
DELETE FROM "Customer" AS c
USING (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "phone"
        ORDER BY "createdAt" ASC, "id" ASC
      ) AS row_num
    FROM "Customer"
  ) AS ranked
  WHERE ranked.row_num > 1
) AS duplicate_rows
WHERE c."id" = duplicate_rows."id";

-- Enforce uniqueness at the database level.
CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer"("phone");
