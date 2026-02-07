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

const LIKELY_PHONE_REGEX = /^\+?[0-9()\-\s]{7,20}$/;

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
