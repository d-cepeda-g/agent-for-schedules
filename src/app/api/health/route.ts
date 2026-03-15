import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const checks: Record<string, "ok" | "error"> = {};
  let healthy = true;

  // Database connectivity check
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "error";
    healthy = false;
  }

  // ElevenLabs configuration check
  checks.elevenlabs =
    process.env.ELEVENLABS_API_KEY &&
    process.env.ELEVENLABS_AGENT_ID &&
    process.env.ELEVENLABS_PHONE_NUMBER_ID
      ? "ok"
      : "error";

  // OpenAI configuration check
  checks.openai = process.env.OPENAI_API_KEY ? "ok" : "error";

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks },
    { status: healthy ? 200 : 503 }
  );
}
