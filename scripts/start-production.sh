#!/usr/bin/env bash
set -euo pipefail

FAILED_MIGRATION="20260208110951_add_scheduled_call_indexes"
APP_PORT="${PORT:-5000}"

echo "Checking Prisma migration state..."
if npx prisma migrate resolve --rolled-back "$FAILED_MIGRATION" >/dev/null 2>&1; then
  echo "Marked failed migration as rolled back: $FAILED_MIGRATION"
else
  echo "No rollback action needed for $FAILED_MIGRATION"
fi

echo "Applying Prisma migrations..."
npx prisma migrate deploy

echo "Starting Next.js on port $APP_PORT..."
exec npx next start -H 0.0.0.0 -p "$APP_PORT"
