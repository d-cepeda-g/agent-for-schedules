export type BusyWindow = {
  start: Date;
  end: Date;
  source: "calendar" | "scheduled_call";
  label: string;
};

export type CalendarConflict = {
  source: BusyWindow["source"];
  label: string;
  start: string;
  end: string;
};

export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return isValidDate(parsed) ? parsed : null;
}

export function parsePositiveMinutes(value: unknown, fallback: number): number {
  if (typeof value !== "number") return fallback;
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.round(value);
}

export function parseBusyWindowsInput(input: unknown): BusyWindow[] {
  if (!Array.isArray(input)) return [];

  const windows: BusyWindow[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const start = parseIsoDate(record.start);
    const end = parseIsoDate(record.end);
    if (!start || !end || end <= start) continue;

    const label =
      typeof record.label === "string" && record.label.trim().length > 0
        ? record.label.trim()
        : "Calendar event";

    windows.push({
      start,
      end,
      source: "calendar",
      label,
    });
  }

  return windows;
}

export function windowsOverlap(
  leftStart: Date,
  leftEnd: Date,
  rightStart: Date,
  rightEnd: Date
): boolean {
  return leftStart < rightEnd && leftEnd > rightStart;
}

export function collectConflicts(
  requestedStart: Date,
  requestedEnd: Date,
  busyWindows: BusyWindow[]
): CalendarConflict[] {
  return busyWindows
    .filter((window) =>
      windowsOverlap(requestedStart, requestedEnd, window.start, window.end)
    )
    .map((window) => ({
      source: window.source,
      label: window.label,
      start: window.start.toISOString(),
      end: window.end.toISOString(),
    }))
    .sort((left, right) => left.start.localeCompare(right.start));
}

export function findNextAvailableStart(
  startAt: Date,
  durationMinutes: number,
  busyWindows: BusyWindow[]
): Date | null {
  const stepMinutes = 15;
  const maxAttempts = 7 * 24 * (60 / stepMinutes);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidateStart = new Date(startAt.getTime() + attempt * stepMinutes * 60_000);
    const candidateEnd = new Date(candidateStart.getTime() + durationMinutes * 60_000);
    const conflicts = collectConflicts(candidateStart, candidateEnd, busyWindows);
    if (conflicts.length === 0) {
      return candidateStart;
    }
  }

  return null;
}
