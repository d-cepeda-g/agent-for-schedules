export const CALL_STATUSES = [
  "pending",
  "dispatching",
  "dispatched",
  "completed",
  "failed",
  "cancelled",
] as const;

export type CallStatus = (typeof CALL_STATUSES)[number];

export const EVALUATION_RESULTS = ["success", "failure", "unknown"] as const;
export type EvaluationResult = (typeof EVALUATION_RESULTS)[number];

const LIKELY_PHONE_REGEX =
  /^\+?[0-9()\-\s./]{7,24}(?:\s*(?:x|ext\.?)\s*\d{1,6})?$/i;

export function isCallStatus(value: unknown): value is CallStatus {
  return typeof value === "string" && CALL_STATUSES.includes(value as CallStatus);
}

export function isEvaluationResult(value: unknown): value is EvaluationResult {
  return (
    typeof value === "string" &&
    EVALUATION_RESULTS.includes(value as EvaluationResult)
  );
}

export function parseDateInput(value: unknown): Date | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  return value.trim();
}

export function isLikelyPhoneNumber(phone: string): boolean {
  return LIKELY_PHONE_REGEX.test(phone);
}

export function toCallablePhoneNumber(phone: string): string | null {
  if (typeof phone !== "string") return null;

  const cleaned = phone
    .trim()
    .replace(/^tel:\s*/i, "")
    .replace(/\s*(?:ext\.?|x)\s*\d{1,6}\s*$/i, "")
    .replace(/[^\d+()\-\s./]/g, "")
    .replace(/[/.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;

  const normalizedPrefix = cleaned.replace(/^00(?=\d)/, "+");
  if (isLikelyPhoneNumber(normalizedPrefix)) {
    return normalizedPrefix;
  }

  const digits = normalizedPrefix.replace(/\D+/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return null;
  }

  return normalizedPrefix.startsWith("+") ? `+${digits}` : digits;
}
