import { NextResponse } from "next/server";
import { createCallLogSafe } from "@/lib/call-logs";
import { db } from "@/lib/db";

const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export async function POST() {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

  const stuckCalls = await db.scheduledCall.findMany({
    where: {
      status: "dispatching",
      updatedAt: { lt: cutoff },
    },
    select: { id: true, updatedAt: true },
  });

  if (stuckCalls.length === 0) {
    return NextResponse.json({ recovered: 0, ids: [] });
  }

  const ids = stuckCalls.map((c) => c.id);

  await db.scheduledCall.updateMany({
    where: { id: { in: ids }, status: "dispatching" },
    data: { status: "pending" },
  });

  for (const call of stuckCalls) {
    await createCallLogSafe({
      scheduledCallId: call.id,
      event: "stuck_recovered",
      message: `Call stuck in dispatching since ${call.updatedAt.toISOString()}, reset to pending`,
    });
  }

  return NextResponse.json({ recovered: ids.length, ids });
}
