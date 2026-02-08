import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const evaluations = await db.callEvaluation.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        scheduledCall: {
          include: {
            customer: { select: { id: true, name: true, phone: true } },
          },
        },
      },
    });

    return NextResponse.json(evaluations);
  } catch (error) {
    console.error("[evaluations:GET]", error);
    return NextResponse.json({ error: "Failed to fetch evaluations" }, { status: 500 });
  }
}
