import { db } from "@/lib/db";

type CallLogLevel = "info" | "warn" | "error";

type CreateCallLogInput = {
  scheduledCallId: string;
  event: string;
  message: string;
  level?: CallLogLevel;
  details?: unknown;
};

function serializeDetails(details: unknown): string {
  if (details === undefined || details === null) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

export async function createCallLog({
  scheduledCallId,
  event,
  message,
  level = "info",
  details,
}: CreateCallLogInput) {
  return db.callLog.create({
    data: {
      scheduledCallId,
      event,
      level,
      message,
      details: serializeDetails(details),
    },
  });
}

export async function createCallLogSafe(input: CreateCallLogInput): Promise<void> {
  try {
    await createCallLog(input);
  } catch {
    // Log writes must never block call flow.
  }
}
