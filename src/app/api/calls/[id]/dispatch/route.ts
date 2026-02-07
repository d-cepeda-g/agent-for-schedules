import { NextRequest, NextResponse } from "next/server";
import { dispatchScheduledCall } from "@/lib/calls";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  let force = false;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    force = body.force === true;
  } catch {
    force = false;
  }

  const result = await dispatchScheduledCall(id, { force });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    call: result.call,
    elevenlabs: result.elevenlabs,
  });
}
