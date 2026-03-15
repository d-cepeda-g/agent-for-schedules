import type { ChatHistoryItem } from "./types";

const MONTH_INDEX_BY_NAME: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

export function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normalizeText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D+/g, "");
}

export function parseHistory(value: unknown): ChatHistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const record = toRecord(entry);
      if (!record) return null;
      const role = record.role;
      const text = normalizeText(record.text);
      if ((role !== "assistant" && role !== "user") || !text) return null;
      return {
        role,
        text: text.length > 600 ? `${text.slice(0, 597)}...` : text,
      } as ChatHistoryItem;
    })
    .filter((entry): entry is ChatHistoryItem => Boolean(entry))
    .slice(-10);
}

export function buildContextMessage(message: string, history: ChatHistoryItem[]): string {
  if (history.length === 0) return message;
  const turns = history.map(
    (entry) => `${entry.role === "user" ? "User" : "Assistant"}: ${entry.text}`
  );
  turns.push(`User: ${message}`);
  return turns.join("\n");
}

export function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isTimeOnly(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatTimeOnly(date: Date): string {
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${hour}:${minute}`;
}

export function parseDateOnly(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function normalizeToStartOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function inferYearForMonthDay(
  monthIndex: number,
  day: number,
  explicitYear: number | null,
  today: Date
): number {
  if (explicitYear) return explicitYear;
  const currentYear = today.getFullYear();
  const candidate = new Date(currentYear, monthIndex, day, 0, 0, 0, 0);
  const todayStart = normalizeToStartOfDay(today);
  return candidate.getTime() < todayStart.getTime() ? currentYear + 1 : currentYear;
}

export function parseEventDateFromText(message: string, today: Date = new Date()): Date | null {
  const candidates: Date[] = [];

  const isoMatches = message.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g);
  for (const match of isoMatches) {
    const parsed = parseDateOnly(`${match[1]}-${match[2]}-${match[3]}`);
    if (parsed) candidates.push(parsed);
  }

  const dotMatches = message.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/g);
  for (const match of dotMatches) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
    if (!Number.isNaN(parsed.getTime())) candidates.push(parsed);
  }

  const monthPattern =
    "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const dayMonthRegex = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(${monthPattern})(?:\\s*,?\\s*(20\\d{2}))?\\b`,
    "gi"
  );
  const monthDayRegex = new RegExp(
    `\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(20\\d{2}))?\\b`,
    "gi"
  );

  for (const match of message.matchAll(dayMonthRegex)) {
    const day = Number(match[1]);
    const monthKey = match[2].toLowerCase();
    const monthIndex = MONTH_INDEX_BY_NAME[monthKey];
    const year = typeof match[3] === "string" ? Number(match[3]) : null;
    if (monthIndex === undefined) continue;
    const resolvedYear = inferYearForMonthDay(monthIndex, day, year, today);
    const parsed = new Date(resolvedYear, monthIndex, day, 0, 0, 0, 0);
    if (!Number.isNaN(parsed.getTime())) candidates.push(parsed);
  }

  for (const match of message.matchAll(monthDayRegex)) {
    const monthKey = match[1].toLowerCase();
    const day = Number(match[2]);
    const monthIndex = MONTH_INDEX_BY_NAME[monthKey];
    const year = typeof match[3] === "string" ? Number(match[3]) : null;
    if (monthIndex === undefined) continue;
    const resolvedYear = inferYearForMonthDay(monthIndex, day, year, today);
    const parsed = new Date(resolvedYear, monthIndex, day, 0, 0, 0, 0);
    if (!Number.isNaN(parsed.getTime())) candidates.push(parsed);
  }

  const normalized = message.toLowerCase();
  if (normalized.includes("today")) candidates.push(normalizeToStartOfDay(today));
  if (normalized.includes("tomorrow")) candidates.push(normalizeToStartOfDay(addDays(today, 1)));
  if (normalized.includes("next week")) candidates.push(normalizeToStartOfDay(addDays(today, 7)));

  if (candidates.length === 0) return null;

  const todayStart = normalizeToStartOfDay(today).getTime();
  const upcoming = candidates
    .filter((d) => d.getTime() >= todayStart)
    .sort((a, b) => a.getTime() - b.getTime());

  return upcoming.length > 0
    ? upcoming[0]
    : candidates.sort((a, b) => b.getTime() - a.getTime())[0];
}
