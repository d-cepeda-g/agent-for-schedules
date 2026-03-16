import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const call = await db.inboundCall.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      actionItems: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!call) {
    return NextResponse.json({ error: "Inbound call not found" }, { status: 404 });
  }

  return NextResponse.json(call);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const existing = await db.inboundCall.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Inbound call not found" }, { status: 404 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  if (typeof body.followUpNeeded === "boolean") data.followUpNeeded = body.followUpNeeded;
  if (typeof body.followUpNotes === "string") data.followUpNotes = body.followUpNotes;
  if (typeof body.customerId === "string") data.customerId = body.customerId || null;
  if (typeof body.intent === "string") data.intent = body.intent;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const updated = await db.inboundCall.update({
    where: { id },
    data,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      actionItems: true,
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const existing = await db.inboundCall.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Inbound call not found" }, { status: 404 });
  }

  await db.inboundCall.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
