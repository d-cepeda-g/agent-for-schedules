import { getProviderDirectory } from "@/lib/provider-directory";
import type { WebSearchApproximateLocation } from "./types";
import { formatDateOnly, formatTimeOnly } from "./parsing";

const DEFAULT_LANGUAGE = "English";

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "need", "want",
  "will", "just", "about", "please", "into", "onto", "their", "there", "then",
  "when", "where", "your", "our", "after", "before", "next", "today", "tomorrow",
  "call", "calls", "schedule", "research", "find",
]);

const SERVICE_PATTERNS: Array<{ serviceType: string; keywords: string[] }> = [
  { serviceType: "event venue", keywords: ["venue", "event space", "party", "birthday", "celebration", "offsite", "on-site", "onsite"] },
  { serviceType: "bar", keywords: ["bar", "rooftop", "cocktail", "lounge", "nightlife", "latin bar", "pub", "club", "speakeasy"] },
  { serviceType: "restaurant", keywords: ["restaurant", "resto", "dinner", "lunch", "brunch", "reservation", "book a table", "table", "food", "cuisine", "eat", "cafe", "bistro"] },
  { serviceType: "dentist", keywords: ["dentist", "dental", "teeth", "tooth"] },
  { serviceType: "auto repair", keywords: ["auto", "car", "mechanic", "repair", "garage", "brake", "tire"] },
  { serviceType: "hairdresser", keywords: ["hair", "salon", "barber", "stylist"] },
  { serviceType: "physical therapy", keywords: ["physio", "therapy", "physical", "rehab"] },
  { serviceType: "optometrist", keywords: ["vision", "optometrist", "eye", "glasses"] },
  { serviceType: "pediatrician", keywords: ["pediatrician", "pediatric", "child", "kids"] },
];

const SERVICE_PRIORITY: Record<string, number> = {
  restaurant: 4, bar: 4, "event venue": 3, dentist: 2, "auto repair": 2,
  hairdresser: 2, "physical therapy": 2, optometrist: 2, pediatrician: 2,
};

const NON_LOCATION_START_WORDS = new Set(["a", "an", "the", "my", "our", "this", "that"]);
const NON_LOCATION_TERMS = new Set([
  "bar", "restaurant", "cafe", "bistro", "club", "party", "event",
  "birthday", "reservation", "table", "dinner", "lunch", "brunch", "rooftop",
]);

export function detectPreferredLanguage(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("spanish")) return "Spanish";
  if (normalized.includes("german")) return "German";
  if (normalized.includes("french")) return "French";
  if (normalized.includes("turkish")) return "Turkish";
  return DEFAULT_LANGUAGE;
}

export function detectServiceType(message: string): string {
  const normalized = message.toLowerCase();
  let bestServiceType = "";
  let bestScore = 0;
  for (const pattern of SERVICE_PATTERNS) {
    const matchCount = pattern.keywords.filter((kw) => normalized.includes(kw)).length;
    if (matchCount === 0) continue;
    const score = matchCount * 10 + (SERVICE_PRIORITY[pattern.serviceType] ?? 1);
    if (score > bestScore) {
      bestScore = score;
      bestServiceType = pattern.serviceType;
    }
  }
  return bestServiceType;
}

export function isVenueLikeRequest(message: string): boolean {
  const normalized = message.toLowerCase();
  return [
    "venue", "event space", "party", "birthday", "bar", "rooftop",
    "restaurant", "resto", "reservation", "dinner", "lunch", "brunch",
    "cafe", "bistro", "food", "cuisine", "book a table", "wedding",
    "celebration", "offsite", "on-site", "onsite",
  ].some((kw) => normalized.includes(kw));
}

export function detectLocation(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("sf")) return "San Francisco";
  if (normalized.includes("san francisco")) return "San Francisco";
  if (normalized.includes("munich")) return "Munich";
  const cities = Array.from(new Set(getProviderDirectory().map((p) => p.city)));
  for (const city of cities) {
    if (normalized.includes(city.toLowerCase())) return city;
  }
  return "";
}

function extractFreeformLocation(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const matches = compact.matchAll(/\b(?:in|at|near)\s+([a-zA-Z][a-zA-Z\s.'-]{1,60})/gi);
  let best = "";
  for (const match of matches) {
    let candidate = (match[1] || "").trim();
    candidate = candidate.split(/(?:\bfor\b|\bon\b|\bwith\b|\bthat\b|\bwhere\b|[,.;!?])/i)[0].trim();
    if (!candidate) continue;
    const tokens = candidate.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || tokens.length > 5) continue;
    if (NON_LOCATION_START_WORDS.has(tokens[0])) continue;
    if (tokens.some((t) => NON_LOCATION_TERMS.has(t))) continue;
    best = candidate;
  }
  if (!best) return "";
  return best.split(/\s+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

export function resolveSearchLocation(
  latestUserMessage: string,
  contextMessage: string,
  preferPlaces: boolean
): string {
  const explicit = detectLocation(latestUserMessage) || extractFreeformLocation(latestUserMessage);
  if (explicit) return explicit;
  if (!preferPlaces) return detectLocation(contextMessage) || extractFreeformLocation(contextMessage);
  return "Munich";
}

export function toWebSearchUserLocation(location: string): WebSearchApproximateLocation | null {
  const normalized = location.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "munich") return { city: "Munich", country: "DE", region: "Bavaria", timezone: "Europe/Berlin" };
  if (normalized === "san francisco") return { city: "San Francisco", country: "US", region: "California", timezone: "America/Los_Angeles" };
  return { city: location.trim() };
}

export function tokenizeMessage(message: string): string[] {
  return message
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

export function getNextBusinessContactSlot(now: Date = new Date()): Date {
  const slot = new Date(now);
  slot.setSeconds(0, 0);
  slot.setMinutes(slot.getMinutes() + 30);
  const roundedMinutes = slot.getMinutes() % 5;
  if (roundedMinutes !== 0) slot.setMinutes(slot.getMinutes() + (5 - roundedMinutes));
  if (slot.getDay() === 0) { slot.setDate(slot.getDate() + 1); slot.setHours(9, 30, 0, 0); }
  if (slot.getDay() === 6) { slot.setDate(slot.getDate() + 2); slot.setHours(9, 30, 0, 0); }
  if (slot.getHours() < 9 || (slot.getHours() === 9 && slot.getMinutes() < 30)) {
    slot.setHours(9, 30, 0, 0);
  } else if (slot.getHours() > 17 || (slot.getHours() === 17 && slot.getMinutes() > 0)) {
    slot.setDate(slot.getDate() + 1);
    slot.setHours(9, 30, 0, 0);
    while (slot.getDay() === 0 || slot.getDay() === 6) slot.setDate(slot.getDate() + 1);
  }
  return slot;
}

function getLatestBusinessSlotBeforeEvent(eventDate: Date): Date {
  const slot = new Date(eventDate);
  slot.setDate(slot.getDate() - 1);
  slot.setHours(16, 30, 0, 0);
  while (slot.getDay() === 0 || slot.getDay() === 6) slot.setDate(slot.getDate() - 1);
  return slot;
}

export function deriveSoonOutreachSlot(
  eventDate: Date | null,
  now: Date = new Date()
): { scheduledDate: string; scheduledTime: string } {
  const soonSlot = getNextBusinessContactSlot(now);
  if (!eventDate) return { scheduledDate: formatDateOnly(soonSlot), scheduledTime: formatTimeOnly(soonSlot) };
  const latestBeforeEvent = getLatestBusinessSlotBeforeEvent(eventDate);
  if (soonSlot.getTime() <= latestBeforeEvent.getTime()) {
    return { scheduledDate: formatDateOnly(soonSlot), scheduledTime: formatTimeOnly(soonSlot) };
  }
  const urgentSlot = new Date(now);
  urgentSlot.setSeconds(0, 0);
  urgentSlot.setMinutes(urgentSlot.getMinutes() + 30);
  const roundedMinutes = urgentSlot.getMinutes() % 5;
  if (roundedMinutes !== 0) urgentSlot.setMinutes(urgentSlot.getMinutes() + (5 - roundedMinutes));
  if (urgentSlot.getTime() <= latestBeforeEvent.getTime()) {
    return { scheduledDate: formatDateOnly(latestBeforeEvent), scheduledTime: formatTimeOnly(latestBeforeEvent) };
  }
  return { scheduledDate: formatDateOnly(urgentSlot), scheduledTime: formatTimeOnly(urgentSlot) };
}
