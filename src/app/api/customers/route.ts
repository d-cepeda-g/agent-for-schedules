import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  isLikelyPhoneNumber,
  normalizeOptionalString,
  normalizeRequiredString,
} from "@/lib/validation";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q") || "";

  const customers = await db.customer.findMany({
    where: query
      ? {
          OR: [
            { name: { contains: query } },
            { phone: { contains: query } },
            { email: { contains: query } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { calls: true } } },
  });

  return NextResponse.json(customers);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = normalizeRequiredString(body.name);
  const phone = normalizeRequiredString(body.phone);
  const email = normalizeOptionalString(body.email) ?? "";
  const notes = normalizeOptionalString(body.notes) ?? "";
  const preferredLanguage =
    normalizeOptionalString(body.preferredLanguage) || "English";

  if (!name || !phone) {
    return NextResponse.json(
      { error: "Name and phone are required" },
      { status: 400 }
    );
  }

  if (!isLikelyPhoneNumber(phone)) {
    return NextResponse.json(
      { error: "Phone must be a valid phone number format" },
      { status: 400 }
    );
  }

  const customer = await db.customer.create({
    data: { name, phone, email, notes, preferredLanguage },
  });

  return NextResponse.json(customer, { status: 201 });
}
