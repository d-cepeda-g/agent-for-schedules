import { createHmac, timingSafeEqual } from "crypto";

type VerificationResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

function safeCompare(expected: string, candidate: string): boolean {
  if (!expected || !candidate) return false;

  const expectedBuffer = Buffer.from(expected);
  const candidateBuffer = Buffer.from(candidate);
  if (expectedBuffer.length !== candidateBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, candidateBuffer);
}

function normalizeSignature(signature: string): string {
  const trimmed = signature.trim();
  if (!trimmed) return "";

  const equalsIndex = trimmed.indexOf("=");
  if (equalsIndex < 0) return trimmed;
  return trimmed.slice(equalsIndex + 1).trim();
}

function getSignatureParts(headers: Headers): {
  timestamp: string | null;
  signatures: string[];
} {
  const signatures: string[] = [];
  let timestamp: string | null =
    headers.get("x-elevenlabs-timestamp") || headers.get("elevenlabs-timestamp");

  const newSignatureHeader =
    headers.get("x-elevenlabs-signature") || headers.get("elevenlabs-signature");
  if (newSignatureHeader) {
    if (newSignatureHeader.includes("t=") || newSignatureHeader.includes("v0=")) {
      const parts = newSignatureHeader.split(",");
      for (const part of parts) {
        const [key, rawValue] = part.split("=", 2).map((value) => value.trim());
        if (!key || !rawValue) continue;
        if (key === "t") {
          timestamp = rawValue;
        } else if (key === "v0" || key === "v1" || key === "signature") {
          signatures.push(rawValue);
        }
      }
    } else {
      signatures.push(newSignatureHeader);
    }
  }

  const base64Signature = headers.get("x-elevenlabs-signature-base64");
  if (base64Signature) {
    signatures.push(base64Signature);
  }

  return {
    timestamp,
    signatures: signatures.map((value) => normalizeSignature(value)).filter(Boolean),
  };
}

function parseTimestamp(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  // Support seconds and milliseconds.
  return parsed > 1_000_000_000_000 ? parsed : parsed * 1000;
}

export function verifyElevenLabsWebhook(
  rawBody: string,
  headers: Headers
): VerificationResult {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) {
    return {
      ok: false,
      status: 503,
      error: "ELEVENLABS_WEBHOOK_SECRET is not set",
    };
  }

  const { timestamp, signatures } = getSignatureParts(headers);
  if (!timestamp || signatures.length === 0) {
    return {
      ok: false,
      status: 401,
      error: "Missing ElevenLabs webhook signature headers",
    };
  }

  const parsedTimestamp = parseTimestamp(timestamp);
  if (parsedTimestamp === null) {
    return {
      ok: false,
      status: 401,
      error: "Invalid ElevenLabs webhook timestamp",
    };
  }

  const ageMs = Math.abs(Date.now() - parsedTimestamp);
  if (ageMs > SIGNATURE_MAX_AGE_MS) {
    return {
      ok: false,
      status: 401,
      error: "Stale ElevenLabs webhook timestamp",
    };
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedHex = createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");
  const expectedBase64 = createHmac("sha256", secret)
    .update(signedPayload)
    .digest("base64");

  const valid = signatures.some(
    (candidate) =>
      safeCompare(expectedHex, candidate.toLowerCase()) ||
      safeCompare(expectedBase64, candidate)
  );

  if (!valid) {
    return {
      ok: false,
      status: 401,
      error: "Invalid ElevenLabs webhook signature",
    };
  }

  return { ok: true };
}
