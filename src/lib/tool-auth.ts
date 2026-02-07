import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

function safeEqual(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function readToolApiKey(request: NextRequest): string | null {
  const headerKey = request.headers.get("x-tool-api-key")?.trim();
  if (headerKey) return headerKey;

  const authHeader = request.headers.get("authorization")?.trim();
  if (!authHeader) return null;
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;

  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
}

export function requireToolApiKey(request: NextRequest): NextResponse | null {
  const expectedKey = process.env.TOOL_API_KEY?.trim();
  if (!expectedKey) {
    return NextResponse.json(
      { error: "TOOL_API_KEY is not configured" },
      { status: 503 }
    );
  }

  const providedKey = readToolApiKey(request);
  if (!providedKey || !safeEqual(expectedKey, providedKey)) {
    return NextResponse.json({ error: "Unauthorized tool request" }, { status: 401 });
  }

  return null;
}
