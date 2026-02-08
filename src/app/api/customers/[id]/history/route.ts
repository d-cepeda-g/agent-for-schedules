import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const customer = await db.customer.findUnique({
      where: { id },
      include: {
        calls: {
          orderBy: { scheduledAt: "desc" },
          include: {
            evaluation: true,
            actionItems: { orderBy: { createdAt: "desc" } },
            logs: { orderBy: { createdAt: "desc" } },
          },
        },
      },
    });

    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    return NextResponse.json(customer);
  } catch (error) {
    console.error("[customer-history:GET]", error);
    return NextResponse.json({ error: "Failed to fetch customer history" }, { status: 500 });
  }
}
