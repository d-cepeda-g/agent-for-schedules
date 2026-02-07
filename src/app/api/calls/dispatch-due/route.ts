import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dispatchScheduledCall } from "@/lib/calls";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

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

  const rawLimit = request.nextUrl.searchParams.get("limit");
  const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : DEFAULT_LIMIT;
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const dueCalls = await db.scheduledCall.findMany({
    where: {
      status: "pending",
      scheduledAt: { lte: new Date() },
    },
    orderBy: { scheduledAt: "asc" },
    take: limit,
    select: { id: true },
  });

  let dispatched = 0;
  let failed = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const dueCall of dueCalls) {
    const result = await dispatchScheduledCall(dueCall.id, {
      allowedStatuses: ["pending"],
    });

    if (result.ok) {
      dispatched += 1;
      continue;
    }

    failed += 1;
    errors.push({ id: dueCall.id, error: result.error });
  }

  return NextResponse.json({
    scanned: dueCalls.length,
    dispatched,
    failed,
    errors,
  });
}
