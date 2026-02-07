import { NextRequest, NextResponse } from "next/server";
import { createCallLogSafe } from "@/lib/call-logs";
import { dispatchScheduledCall } from "@/lib/calls";
import { db } from "@/lib/db";
import { normalizeOptionalString } from "@/lib/validation";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const callReason =
    normalizeOptionalString(body?.callReason) ||
    "Reminder for clinic appointment at Kaulbachstraße on July 25";
  const callPurpose =
    normalizeOptionalString(body?.callPurpose) ||
    "Remind David to set up his clinic appointment at Kaulbachstraße for July 25 and confirm availability at that time";
  const preferredLanguage =
    normalizeOptionalString(body?.preferredLanguage) || "English";
  const notes =
    normalizeOptionalString(body?.notes) ||
    "Please remind David Cepeda to book his appointment at the Kaulbachstraße clinic for July 25 and confirm if that time works for him.";

  const customer = await db.customer.findFirst({
    where: {
      name: { contains: "David Cepeda", mode: "insensitive" },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!customer) {
    return NextResponse.json(
      {
        error:
          "Customer 'David Cepeda' not found. Create the customer first in /customers.",
      },
      { status: 404 }
    );
  }

  const call = await db.scheduledCall.create({
    data: {
      customerId: customer.id,
      scheduledAt: new Date(),
      notes,
      callReason,
      callPurpose,
      preferredLanguage,
      agentId: process.env.ELEVENLABS_AGENT_ID || "",
    },
  });

  await createCallLogSafe({
    scheduledCallId: call.id,
    event: "quick_call_requested",
    message: "Quick call requested from dashboard",
    details: { customerId: customer.id, customerName: customer.name },
  });

  const dispatchResult = await dispatchScheduledCall(call.id, {
    force: true,
    allowedStatuses: ["pending"],
  });

  if (!dispatchResult.ok) {
    return NextResponse.json({ error: dispatchResult.error }, { status: dispatchResult.status });
  }

  return NextResponse.json(
    {
      call: dispatchResult.call,
      elevenlabs: dispatchResult.elevenlabs,
    },
    { status: 201 }
  );
}
