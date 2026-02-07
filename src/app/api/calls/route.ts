import { NextRequest, NextResponse } from "next/server";
import { createCallLogSafe } from "@/lib/call-logs";
import { db } from "@/lib/db";
import {
  isCallStatus,
  normalizeOptionalString,
  normalizeRequiredString,
  parseDateInput,
} from "@/lib/validation";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get("status");
  const customerId = searchParams.get("customerId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Record<string, unknown> = {};
  if (status) {
    if (!isCallStatus(status)) {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
    }
    where.status = status;
  }

  if (customerId) where.customerId = customerId;

  if (from || to) {
    const fromDate = from ? parseDateInput(from) : null;
    const toDate = to ? parseDateInput(to) : null;

    if (from && !fromDate) {
      return NextResponse.json({ error: "Invalid from date" }, { status: 400 });
    }
    if (to && !toDate) {
      return NextResponse.json({ error: "Invalid to date" }, { status: 400 });
    }

    where.scheduledAt = {
      ...(fromDate && { gte: fromDate }),
      ...(toDate && { lte: toDate }),
    };
  }

  const calls = await db.scheduledCall.findMany({
    where,
    orderBy: { scheduledAt: "desc" },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      evaluation: { select: { id: true, result: true } },
    },
  });

  return NextResponse.json(calls);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const customerId = normalizeRequiredString(body.customerId);
  const scheduledAt = parseDateInput(body.scheduledAt);
  const notes = normalizeOptionalString(body.notes) ?? "";

  if (!customerId || !scheduledAt) {
    return NextResponse.json(
      { error: "customerId and scheduledAt are required" },
      { status: 400 }
    );
  }

  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const call = await db.scheduledCall.create({
    data: {
      customerId,
      scheduledAt,
      notes,
      agentId: process.env.ELEVENLABS_AGENT_ID || "",
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
    },
  });

  await createCallLogSafe({
    scheduledCallId: call.id,
    event: "scheduled",
    message: `Call scheduled for ${call.customer.name}`,
    details: {
      customerId: call.customer.id,
      scheduledAt: call.scheduledAt.toISOString(),
    },
  });

  return NextResponse.json(call, { status: 201 });
}
