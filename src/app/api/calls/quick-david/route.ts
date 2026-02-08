import { NextRequest, NextResponse } from "next/server";
import { createCallLogSafe } from "@/lib/call-logs";
import { dispatchScheduledCall } from "@/lib/calls";
import { db } from "@/lib/db";
import { normalizeOptionalString } from "@/lib/validation";

const QUICK_CALL_DUPLICATE_WINDOW_MS = 60_000;

function isAuthorizedQuickCall(request: NextRequest): boolean {
  const expectedApiKey = process.env.TOOL_API_KEY?.trim();
  if (!expectedApiKey) return process.env.ENABLE_QUICK_DAVID === "true";

  const headerApiKey = request.headers.get("x-tool-api-key")?.trim() || "";
  const authHeader = request.headers.get("authorization")?.trim() || "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  return (
    headerApiKey === expectedApiKey ||
    bearerToken === expectedApiKey ||
    process.env.ENABLE_QUICK_DAVID === "true"
  );
}

function floorToMinute(value: Date): Date {
  const normalized = new Date(value);
  normalized.setSeconds(0, 0);
  return normalized;
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorizedQuickCall(request)) {
      return NextResponse.json(
        { error: "Quick call trigger is disabled or unauthorized" },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const triggerMeta = {
      userAgent: request.headers.get("user-agent"),
      forwardedFor: request.headers.get("x-forwarded-for"),
      referer: request.headers.get("referer"),
    };
    const agentId = process.env.ELEVENLABS_AGENT_ID;
    if (!agentId) {
      return NextResponse.json(
        { error: "ELEVENLABS_AGENT_ID is not configured" },
        { status: 500 }
      );
    }

    const callReason =
      normalizeOptionalString(body?.callReason) ||
      "Reminder for clinic appointment at Kaulbachstraße on July 25";
    const callPurpose =
      normalizeOptionalString(body?.callPurpose) ||
      "Remind David to set up his clinic appointment at Kaulbachstraße for July 25 and confirm availability at that time";
    const notes =
      normalizeOptionalString(body?.notes) ||
      "Please remind David Cepeda to book his appointment at the Kaulbachstraße clinic for July 25 and confirm if that time works for him.";

    const allCustomers = await db.customer.findMany({
      where: { name: { contains: "David Cepeda" } },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    const customer = allCustomers[0] ?? null;

    if (!customer) {
      return NextResponse.json(
        {
          error:
            "Customer 'David Cepeda' not found. Create the customer first in /customers.",
        },
        { status: 404 }
      );
    }

    const scheduledAt = floorToMinute(new Date());
    const duplicate = await db.scheduledCall.findFirst({
      where: {
        customerId: customer.id,
        scheduledAt: {
          gte: new Date(scheduledAt.getTime() - QUICK_CALL_DUPLICATE_WINDOW_MS),
          lte: new Date(scheduledAt.getTime() + QUICK_CALL_DUPLICATE_WINDOW_MS),
        },
        callReason,
        callPurpose,
        notes,
        status: { in: ["pending", "dispatching", "dispatched", "completed", "failed"] },
      },
      orderBy: { createdAt: "desc" },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
      },
    });

    if (duplicate) {
      await createCallLogSafe({
        scheduledCallId: duplicate.id,
        event: "quick_call_deduplicated",
        message: "Duplicate quick-call trigger ignored",
        details: triggerMeta,
      });

      if (["pending", "failed"].includes(duplicate.status)) {
        const dispatchResult = await dispatchScheduledCall(duplicate.id, {
          force: true,
          allowedStatuses: ["pending", "failed"],
        });

        if (!dispatchResult.ok && dispatchResult.status !== 409) {
          return NextResponse.json(
            { error: dispatchResult.error },
            { status: dispatchResult.status }
          );
        }

        if (dispatchResult.ok) {
          return NextResponse.json(
            {
              call: dispatchResult.call,
              elevenlabs: dispatchResult.elevenlabs,
              deduplicated: true,
            },
            { status: 200 }
          );
        }
      }

      return NextResponse.json(
        {
          call: duplicate,
          deduplicated: true,
        },
        { status: 200 }
      );
    }

    const call = await db.scheduledCall.create({
      data: {
        customerId: customer.id,
        scheduledAt,
        notes,
        callReason,
        callPurpose,
        preferredLanguage:
          normalizeOptionalString(body?.preferredLanguage) ||
          customer.preferredLanguage ||
          "English",
        agentId,
      },
    });

    await createCallLogSafe({
      scheduledCallId: call.id,
      event: "quick_call_requested",
      message: "Quick call requested from dashboard",
      details: { customerId: customer.id, customerName: customer.name, ...triggerMeta },
    });

    const dispatchResult = await dispatchScheduledCall(call.id, {
      force: true,
      allowedStatuses: ["pending"],
    });

    if (!dispatchResult.ok) {
      return NextResponse.json(
        { error: dispatchResult.error },
        { status: dispatchResult.status }
      );
    }

    return NextResponse.json(
      {
        call: dispatchResult.call,
        elevenlabs: dispatchResult.elevenlabs,
        deduplicated: false,
      },
      { status: 201 }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected error while triggering quick call";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
