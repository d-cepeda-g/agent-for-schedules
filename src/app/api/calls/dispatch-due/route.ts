import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runWithConcurrency } from "@/lib/async-concurrency";
import { dispatchScheduledCall } from "@/lib/calls";

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;
const DEFAULT_CONCURRENCY = 15;
const MAX_CONCURRENCY = 15;

function parseBoundedInt(
  value: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export async function POST(request: NextRequest) {
  if (
    !process.env.ELEVENLABS_API_KEY ||
    !process.env.ELEVENLABS_AGENT_ID ||
    !process.env.ELEVENLABS_PHONE_NUMBER_ID
  ) {
    return NextResponse.json({
      scanned: 0,
      dispatched: 0,
      failed: 0,
      errors: [
        {
          id: "configuration",
          error: "ElevenLabs environment variables are not configured",
        },
      ],
    });
  }

  const searchParams = request.nextUrl.searchParams;
  const limit = parseBoundedInt(searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const concurrency = parseBoundedInt(
    searchParams.get("concurrency") || process.env.CALLPILOT_DISPATCH_CONCURRENCY || null,
    DEFAULT_CONCURRENCY,
    1,
    Math.min(MAX_CONCURRENCY, limit)
  );

  const dueCalls = await db.scheduledCall.findMany({
    where: {
      status: "pending",
      scheduledAt: { lte: new Date() },
    },
    orderBy: { scheduledAt: "asc" },
    take: limit,
    select: { id: true },
  });

  const attempts = await runWithConcurrency(dueCalls, concurrency, async (dueCall) => {
    const result = await dispatchScheduledCall(dueCall.id, {
      allowedStatuses: ["pending"],
    });

    if (result.ok) {
      return {
        id: dueCall.id,
        ok: true as const,
      };
    }

    return {
      id: dueCall.id,
      ok: false as const,
      error: result.error,
    };
  });

  const dispatched = attempts.filter((attempt) => attempt.ok).length;
  const failures = attempts.filter((attempt) => !attempt.ok);
  const failed = failures.length;
  const errors = failures.map((attempt) => ({
    id: attempt.id,
    error: attempt.error,
  }));

  return NextResponse.json({
    scanned: dueCalls.length,
    limit,
    concurrency,
    dispatched,
    failed,
    errors,
  });
}
