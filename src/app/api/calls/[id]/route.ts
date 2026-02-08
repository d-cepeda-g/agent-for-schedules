import { NextRequest, NextResponse } from "next/server";
import { createCallLogSafe } from "@/lib/call-logs";
import { db } from "@/lib/db";
import { isPrismaNotFoundError } from "@/lib/prisma-errors";
import {
  isCallStatus,
  normalizeOptionalString,
  normalizeRequiredString,
  parseDateInput,
} from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const call = await db.scheduledCall.findUnique({
    where: { id },
    include: {
      customer: true,
      evaluation: true,
      actionItems: {
        orderBy: { createdAt: "desc" },
      },
      logs: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!call) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  return NextResponse.json(call);
}

export async function PATCH(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await _request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};

  if (body.status !== undefined) {
    if (!isCallStatus(body.status)) {
      return NextResponse.json({ error: "Invalid call status" }, { status: 400 });
    }
    data.status = body.status;
  }

  if (body.scheduledAt !== undefined) {
    const scheduledAt = parseDateInput(body.scheduledAt);
    if (!scheduledAt) {
      return NextResponse.json({ error: "Invalid scheduledAt date" }, { status: 400 });
    }
    data.scheduledAt = scheduledAt;
  }

  if (body.notes !== undefined) {
    const notes = normalizeOptionalString(body.notes);
    if (notes === null) {
      return NextResponse.json({ error: "Notes must be a string" }, { status: 400 });
    }
    data.notes = notes;
  }

  if (body.callReason !== undefined) {
    const callReason = normalizeOptionalString(body.callReason);
    if (callReason === null) {
      return NextResponse.json(
        { error: "callReason must be a string" },
        { status: 400 }
      );
    }
    data.callReason = callReason;
  }

  if (body.callPurpose !== undefined) {
    const callPurpose = normalizeOptionalString(body.callPurpose);
    if (callPurpose === null) {
      return NextResponse.json(
        { error: "callPurpose must be a string" },
        { status: 400 }
      );
    }
    data.callPurpose = callPurpose;
  }

  if (body.preferredLanguage !== undefined) {
    const preferredLanguage = normalizeOptionalString(body.preferredLanguage);
    if (preferredLanguage === null) {
      return NextResponse.json(
        { error: "preferredLanguage must be a string" },
        { status: 400 }
      );
    }
    data.preferredLanguage = preferredLanguage;
  }

  if (body.customerId !== undefined) {
    const customerId = normalizeRequiredString(body.customerId);
    if (!customerId) {
      return NextResponse.json(
        { error: "customerId must be a non-empty string" },
        { status: 400 }
      );
    }

    const customer = await db.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    data.customerId = customerId;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No valid fields provided to update" },
      { status: 400 }
    );
  }

  try {
    const call = await db.scheduledCall.update({
      where: { id },
      data,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
      },
    });

    const updatedFields = Object.keys(data).filter((field) => field !== "status");

    if (updatedFields.length > 0) {
      await createCallLogSafe({
        scheduledCallId: id,
        event: "call_updated",
        message: "Call details updated",
        details: {
          fields: updatedFields,
          customerId: call.customer.id,
          customerName: call.customer.name,
          scheduledAt:
            data.scheduledAt instanceof Date
              ? data.scheduledAt.toISOString()
              : undefined,
        },
      });
    }

    if (typeof data.status === "string") {
      await createCallLogSafe({
        scheduledCallId: id,
        event: "status_updated",
        message: `Call status set to ${data.status}`,
      });
    }

    return NextResponse.json(call);
  } catch (error) {
    if (isPrismaNotFoundError(error)) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await db.scheduledCall.update({
      where: { id },
      data: { status: "cancelled" },
    });
    await createCallLogSafe({
      scheduledCallId: id,
      event: "status_updated",
      message: "Call cancelled",
      level: "warn",
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (isPrismaNotFoundError(error)) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }
    throw error;
  }
}
