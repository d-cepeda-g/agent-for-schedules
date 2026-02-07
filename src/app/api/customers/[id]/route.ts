import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isPrismaNotFoundError } from "@/lib/prisma-errors";
import {
  isLikelyPhoneNumber,
  normalizeOptionalString,
  normalizeRequiredString,
} from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const customer = await db.customer.findUnique({
    where: { id },
    include: { calls: { orderBy: { scheduledAt: "desc" } } },
  });

  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  return NextResponse.json(customer);
}

export async function PATCH(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await _request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: Record<string, string> = {};

  if (body.name !== undefined) {
    const name = normalizeRequiredString(body.name);
    if (!name) {
      return NextResponse.json(
        { error: "Name cannot be empty" },
        { status: 400 }
      );
    }
    data.name = name;
  }

  if (body.phone !== undefined) {
    const phone = normalizeRequiredString(body.phone);
    if (!phone || !isLikelyPhoneNumber(phone)) {
      return NextResponse.json(
        { error: "Phone must be a valid phone number format" },
        { status: 400 }
      );
    }
    data.phone = phone;
  }

  if (body.email !== undefined) {
    const email = normalizeOptionalString(body.email);
    if (email === null) {
      return NextResponse.json(
        { error: "Email must be a string" },
        { status: 400 }
      );
    }
    data.email = email;
  }

  if (body.notes !== undefined) {
    const notes = normalizeOptionalString(body.notes);
    if (notes === null) {
      return NextResponse.json(
        { error: "Notes must be a string" },
        { status: 400 }
      );
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
    const customer = await db.customer.update({
      where: { id },
      data,
    });

    return NextResponse.json(customer);
  } catch (error) {
    if (isPrismaNotFoundError(error)) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await db.customer.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (isPrismaNotFoundError(error)) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    throw error;
  }
}
