import type { ProactiveAction, OnsiteLocationSuggestion } from "./types";

export const DISMISSED_ACTIONS_STORAGE_KEY = "dashboard:dismissed_proactive_action_ids";
export const DISMISSED_VALENTINE_PANEL_STORAGE_KEY = "dashboard:dismissed_valentine_panel";

export const COMPANY_ONSITE_DATE_LABEL = "06.03.2026";
export const COMPANY_ONSITE_DATE_ISO = "2026-03-06";
export const ONSITE_BLOCKER_ACTION_ID = "company-onsite-blocker-2026-03-06";
export const ONSITE_SEARCH_DELAY_MS = 1600;

export function isOnsiteDateRelevant(): boolean {
  const onsiteDate = new Date(COMPANY_ONSITE_DATE_ISO + "T23:59:59");
  return onsiteDate.getTime() > Date.now();
}

const ONSITE_VENUES = [
  {
    id: "venue-moc-event-center",
    name: "MOC Event Center Messe München",
    area: "Freimann, Munich",
    address: "Lilienthalallee 40, 80939 Munich",
    phone: "+49 89 32353-0",
    capacity_hint: "Large conference format, flexible multi-room setups.",
  },
  {
    id: "venue-smartvillage-bogenhausen",
    name: "smartvillage Bogenhausen",
    area: "Bogenhausen, Munich",
    address: "Rosenkavalierplatz 13, 81925 Munich",
    phone: "+49 89 24418290",
    capacity_hint: "Modern workshop spaces for medium-sized team on-sites.",
  },
  {
    id: "venue-infinity-conference",
    name: "Infinity Hotel & Conference Resort Munich",
    area: "Unterschleissheim (near Munich)",
    address: "Andreas-Danzer-Weg 1, 85716 Unterschleissheim",
    phone: "+49 89 370530-0",
    capacity_hint: "Hotel + conference option for all-day on-site programs.",
  },
  {
    id: "venue-h4-messe",
    name: "H4 Hotel München Messe",
    area: "Messestadt, Munich",
    address: "Konrad-Zuse-Platz 14, 81829 Munich",
    phone: "+49 89 9400850",
    capacity_hint: "Convenient transit access and business meeting facilities.",
  },
] as const;

export function readDismissedActionIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DISMISSED_ACTIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

export function writeDismissedActionIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  if (ids.length === 0) {
    window.localStorage.removeItem(DISMISSED_ACTIONS_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(DISMISSED_ACTIONS_STORAGE_KEY, JSON.stringify(ids));
}

export function readValentinePanelDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DISMISSED_VALENTINE_PANEL_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeValentinePanelDismissed(value: boolean): void {
  if (typeof window === "undefined") return;
  if (!value) {
    window.localStorage.removeItem(DISMISSED_VALENTINE_PANEL_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(DISMISSED_VALENTINE_PANEL_STORAGE_KEY, "true");
}

export function normalizePhoneForMatch(phone: string): string {
  return phone.replace(/\D+/g, "");
}

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getNextBusinessDayDateOnly(): string {
  const candidate = new Date();
  candidate.setDate(candidate.getDate() + 1);
  candidate.setHours(9, 0, 0, 0);
  return formatDateOnly(candidate);
}

export function buildOnsiteBlockerAction(inquiryDate: string): ProactiveAction {
  return {
    id: ONSITE_BLOCKER_ACTION_ID,
    title: "Blocker: company on-site is in ~1 month",
    description: `Your company on-site is on ${COMPANY_ONSITE_DATE_LABEL}. Start venue availability outreach near Munich now.`,
    customer_id: null,
    call_reason: `Company on-site venue planning for ${COMPANY_ONSITE_DATE_LABEL}`,
    call_purpose:
      "Identify and contact event locations near Munich for on-site availability and fit.",
    notes:
      "Goal: gather venue availability, rough pricing, and room setup options for the company on-site.",
    preferred_language: "English",
    scheduled_date: inquiryDate,
    scheduled_time: "10:00",
    target_name: null,
    target_phone: null,
  };
}

export function buildOnsiteLocationSuggestions(inquiryDate: string): OnsiteLocationSuggestion[] {
  return ONSITE_VENUES.map((venue) => ({
    ...venue,
    call_action: {
      id: `onsite-${venue.id}`,
      title: `Check ${venue.name} availability`,
      description: `Call ${venue.name} to inquire about on-site availability around ${COMPANY_ONSITE_DATE_LABEL}.`,
      customer_id: null,
      call_reason: `Availability inquiry for company on-site (${COMPANY_ONSITE_DATE_LABEL})`,
      call_purpose: `Ask ${venue.name} about availability, capacity fit, and indicative pricing for an on-site on ${COMPANY_ONSITE_DATE_LABEL}.`,
      notes: [
        `Venue: ${venue.name}`,
        `Address: ${venue.address}`,
        `Phone: ${venue.phone}`,
        `On-site date: ${COMPANY_ONSITE_DATE_LABEL}`,
        `Capacity context: ${venue.capacity_hint}`,
        "Ask for: available time windows, room setup options, and next booking steps.",
      ].join("\n"),
      preferred_language: "English",
      scheduled_date: inquiryDate,
      scheduled_time: "10:00",
      target_name: venue.name,
      target_phone: venue.phone,
    },
  }));
}

export function parseIsoFromAction(action: ProactiveAction): string {
  const [year, month, day] = action.scheduled_date.split("-").map(Number);
  const [hour, minute] = action.scheduled_time.split(":").map(Number);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 1);
    fallback.setHours(20, 0, 0, 0);
    return fallback.toISOString();
  }

  const scheduledAt = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(scheduledAt.getTime())) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 1);
    fallback.setHours(20, 0, 0, 0);
    return fallback.toISOString();
  }

  return scheduledAt.toISOString();
}

export function toPrefillUrl(action: ProactiveAction): string {
  const params = new URLSearchParams({
    callReason: action.call_reason,
    callPurpose: action.call_purpose,
    notes: action.notes,
    preferredLanguage: action.preferred_language || "English",
    date: action.scheduled_date,
    time: action.scheduled_time || "20:00",
  });

  if (action.customer_id) {
    params.set("customerId", action.customer_id);
  }

  return `/schedule?${params.toString()}`;
}

export function hasPreviousCallHistory(
  calls: { status: string; evaluation: unknown }[]
): boolean {
  return calls.some(
    (call) => call.status === "completed" || Boolean(call.evaluation)
  );
}
