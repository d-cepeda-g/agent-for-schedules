import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  isLikelyPhoneNumber,
  normalizeOptionalString,
  normalizeRequiredString,
} from "@/lib/validation";

function isMissingPreferredLanguageColumnError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2022") {
      const column = (error.meta?.column as string | undefined) || "";
      return column.includes("preferredLanguage");
    }
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("preferredlanguage") &&
      (message.includes("column") ||
        message.includes("does not exist") ||
        message.includes("unknown"))
    );
  }

  return false;
}

function toPublicErrorMessage(error: unknown): string {
  if (isMissingPreferredLanguageColumnError(error)) {
    return "Database schema is missing preferredLanguage. Run prisma migrations (db:migrate/deploy) and try again.";
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return "Database connection failed. Check DATABASE_URL and database availability.";
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return "Invalid database query configuration. Check Prisma schema and environment variables.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unexpected server error";
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q") || "";

  const where = query
    ? {
        OR: [
          { name: { contains: query } },
          { phone: { contains: query } },
          { email: { contains: query } },
        ],
      }
    : undefined;

  try {
    const customers = await db.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { calls: true } } },
    });

    return NextResponse.json(customers);
  } catch (error) {
    if (isMissingPreferredLanguageColumnError(error)) {
      // Backward-compat fallback for environments that missed the preferredLanguage migration.
      const legacyCustomers = await db.customer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { calls: true } },
        },
      });

      return NextResponse.json(
        legacyCustomers.map((customer) => ({
          ...customer,
          preferredLanguage: "English",
        }))
      );
    }

    return NextResponse.json(
      { error: toPublicErrorMessage(error) },
      { status: 500 }
    );
  }

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

  try {
    const customer = await db.customer.create({
      data: { name, phone, email, notes, preferredLanguage },
    });

    return NextResponse.json(customer, { status: 201 });
  } catch (error) {
    if (isMissingPreferredLanguageColumnError(error)) {
      // Backward-compat fallback for environments that missed the preferredLanguage migration.
      const legacyCustomer = await db.customer.create({
        data: { name, phone, email, notes },
      });

      return NextResponse.json(
        {
          ...legacyCustomer,
          preferredLanguage: "English",
          warning:
            "Customer saved, but preferredLanguage could not be stored because DB migration is missing.",
        },
        { status: 201 }
      );
    }

    return NextResponse.json(
      { error: toPublicErrorMessage(error) },
      { status: 500 }
    );
  }
}
