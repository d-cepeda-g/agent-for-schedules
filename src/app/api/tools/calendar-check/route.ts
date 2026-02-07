import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  type BusyWindow,
  collectConflicts,
  findNextAvailableStart,
  parseIsoDate,
  parseBusyWindowsInput,
  parsePositiveMinutes,
} from "@/lib/tool-calendar";
import { requireToolApiKey } from "@/lib/tool-auth";

type CalendarCheckBody = {
  proposed_start?: unknown;
  duration_minutes?: unknown;
  busy_windows?: unknown;
  customer_id?: unknown;
};

async function getScheduledCallWindows(
  customerId: string,
  durationMinutes: number
): Promise<BusyWindow[]> {
  const calls = await db.scheduledCall.findMany({
    where: {
      customerId,
      status: { notIn: ["cancelled", "failed"] },
    },
    select: {
      id: true,
      scheduledAt: true,
      status: true,
    },
    orderBy: { scheduledAt: "asc" },
    take: 200,
  });

  return calls.map((call) => {
    const end = new Date(call.scheduledAt.getTime() + durationMinutes * 60_000);
    return {
      start: call.scheduledAt,
      end,
      source: "scheduled_call",
      label: `Existing call (${call.status}) #${call.id}`,
    };
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = requireToolApiKey(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json().catch(() => null)) as CalendarCheckBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const proposedStart = parseIsoDate(body.proposed_start);
  if (!proposedStart) {
    return NextResponse.json(
      { error: "proposed_start must be a valid ISO date string" },
      { status: 400 }
    );
  }

  const durationMinutes = parsePositiveMinutes(body.duration_minutes, 60);
  const proposedEnd = new Date(proposedStart.getTime() + durationMinutes * 60_000);

  const busyWindows = parseBusyWindowsInput(body.busy_windows);
  if (typeof body.customer_id === "string" && body.customer_id.trim().length > 0) {
    const scheduledCallWindows = await getScheduledCallWindows(
      body.customer_id.trim(),
      durationMinutes
    );
    busyWindows.push(...scheduledCallWindows);
  }

  const conflicts = collectConflicts(proposedStart, proposedEnd, busyWindows);
  const nextAvailableStart =
    conflicts.length === 0
      ? proposedStart
      : findNextAvailableStart(proposedStart, durationMinutes, busyWindows);

  return NextResponse.json({
    available: conflicts.length === 0,
    proposed_start: proposedStart.toISOString(),
    proposed_end: proposedEnd.toISOString(),
    duration_minutes: durationMinutes,
    conflicts,
    next_available_start: nextAvailableStart?.toISOString() ?? null,
  });
}
