import { NextRequest, NextResponse } from "next/server";
import { createCallLogSafe } from "@/lib/call-logs";
import { db } from "@/lib/db";
import { isPrismaNotFoundError } from "@/lib/prisma-errors";
import {
  isCallStatus,
  normalizeOptionalString,
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
