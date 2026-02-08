import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  createJsonCompletion,
  createWebSearchTextCompletionWithMetadata,
  hasOpenAiApiKey,
  type WebSearchApproximateLocation,
} from "@/lib/openai";
import {
  type ProviderRecord,
  getProviderDirectory,
  searchProviders,
} from "@/lib/provider-directory";
import { isLikelyPhoneNumber, toCallablePhoneNumber } from "@/lib/validation";

const MAX_SUGGESTIONS = 3;
const MAX_ONLINE_RESEARCH_RESULTS = 6;
const MAX_WEB_RESEARCH_TEXT_CHARS = 12000;
const MAX_WEB_SOURCE_URLS_IN_NOTE = 3;
const MAX_PHONE_RECOVERY_LEADS = 4;
const DEFAULT_LANGUAGE = "English";

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "have",
  "need",
  "want",
  "will",
  "just",
  "about",
  "please",
  "into",
  "onto",
  "their",
  "there",
  "then",
  "when",
  "where",
  "your",
  "our",
  "after",
  "before",
  "next",
  "today",
  "tomorrow",
  "call",
  "calls",
  "schedule",
  "research",
  "find",
]);

const SERVICE_PATTERNS: Array<{ serviceType: string; keywords: string[] }> = [
  {
    serviceType: "event venue",
    keywords: [
      "venue",
      "event space",
      "party",
      "birthday",
      "celebration",
      "offsite",
      "on-site",
      "onsite",
    ],
  },
  {
    serviceType: "bar",
    keywords: [
      "bar",
      "rooftop",
      "cocktail",
      "lounge",
      "nightlife",
      "latin bar",
      "pub",
      "club",
      "speakeasy",
    ],
  },
  {
    serviceType: "restaurant",
    keywords: [
      "restaurant",
      "resto",
      "dinner",
      "lunch",
      "brunch",
      "reservation",
      "book a table",
      "table",
      "food",
      "cuisine",
      "eat",
      "cafe",
      "bistro",
    ],
  },
  { serviceType: "dentist", keywords: ["dentist", "dental", "teeth", "tooth"] },
  {
    serviceType: "auto repair",
    keywords: ["auto", "car", "mechanic", "repair", "garage", "brake", "tire"],
  },
  { serviceType: "hairdresser", keywords: ["hair", "salon", "barber", "stylist"] },
  {
    serviceType: "physical therapy",
    keywords: ["physio", "therapy", "physical", "rehab"],
  },
  {
    serviceType: "optometrist",
    keywords: ["vision", "optometrist", "eye", "glasses"],
  },
  {
    serviceType: "pediatrician",
    keywords: ["pediatrician", "pediatric", "child", "kids"],
  },
];

const SERVICE_PRIORITY: Record<string, number> = {
  restaurant: 4,
  bar: 4,
  "event venue": 3,
  dentist: 2,
  "auto repair": 2,
  hairdresser: 2,
  "physical therapy": 2,
  optometrist: 2,
  pediatrician: 2,
};

const MONTH_INDEX_BY_NAME: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

type ChatSuggestion = {
  id: string;
  source: "existing_contact" | "researched_provider";
  name: string;
  phone: string;
  reason: string;
  customerId: string | null;
  callReason: string;
  callPurpose: string;
  notes: string;
  preferredLanguage: string;
  scheduledDate: string;
  scheduledTime: string;
};

type AssistantResponse = {
  reply: string;
  suggestions: ChatSuggestion[];
  source: "openai" | "fallback";
  sourceReason: string | null;
};

type Contact = {
  id: string;
  name: string;
  phone: string;
  notes: string;
  preferredLanguage: string;
};

type SuggestionContext = {
  callReason: string;
  callPurpose: string;
  preferredLanguage: string;
  scheduledDate: string;
  scheduledTime: string;
};

type ChatHistoryItem = {
  role: "assistant" | "user";
  text: string;
};

type Plan = {
  reply: string;
  suggestions: ChatSuggestion[];
  source: "openai" | "fallback";
  sourceReason: string | null;
  serviceType: string;
  location: string;
  context: SuggestionContext;
};

type OnlinePlaceResearch = {
  name: string;
  phone: string;
  address: string;
  city: string;
  reason: string;
  website: string | null;
};

type OnlineWebsiteLead = {
  name: string;
  website: string;
  city: string;
  reason: string;
};

type OnlineResearchDiagnostics = {
  parsedEntries: number;
  acceptedCallable: number;
  missingAddress: number;
  missingName: number;
  missingPhone: number;
  invalidPhone: number;
  recoveredPhone: number;
  websiteOnlyLeads: number;
  duplicateWithContacts: number;
  locationFilteredOut: number;
  finalSuggestions: number;
  usedWebSearch: boolean;
  sourceUrlCount: number;
};

type OnlineResearchResult = {
  suggestions: ChatSuggestion[];
  websiteLeads: OnlineWebsiteLead[];
  diagnostics: OnlineResearchDiagnostics;
  sourceUrls: string[];
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function parseHistory(value: unknown): ChatHistoryItem[] {
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

function buildContextMessage(message: string, history: ChatHistoryItem[]): string {
  if (history.length === 0) return message;

  const turns = history.map(
    (entry) => `${entry.role === "user" ? "User" : "Assistant"}: ${entry.text}`
  );
  turns.push(`User: ${message}`);
  return turns.join("\n");
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D+/g, "");
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTimeOnly(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function formatTimeOnly(date: Date): string {
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${hour}:${minute}`;
}

function parseDateOnly(value: string): Date | null {
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

function parseEventDateFromText(
  message: string,
  today: Date = new Date()
): Date | null {
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
    if (!Number.isNaN(parsed.getTime())) {
      candidates.push(parsed);
    }
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

  const dayMonthMatches = message.matchAll(dayMonthRegex);
  for (const match of dayMonthMatches) {
    const day = Number(match[1]);
    const monthKey = match[2].toLowerCase();
    const monthIndex = MONTH_INDEX_BY_NAME[monthKey];
    const year =
      typeof match[3] === "string" ? Number(match[3]) : null;

    if (monthIndex === undefined) continue;
    const resolvedYear = inferYearForMonthDay(monthIndex, day, year, today);
    const parsed = new Date(resolvedYear, monthIndex, day, 0, 0, 0, 0);
    if (!Number.isNaN(parsed.getTime())) {
      candidates.push(parsed);
    }
  }

  const monthDayMatches = message.matchAll(monthDayRegex);
  for (const match of monthDayMatches) {
    const monthKey = match[1].toLowerCase();
    const day = Number(match[2]);
    const monthIndex = MONTH_INDEX_BY_NAME[monthKey];
    const year =
      typeof match[3] === "string" ? Number(match[3]) : null;

    if (monthIndex === undefined) continue;
    const resolvedYear = inferYearForMonthDay(monthIndex, day, year, today);
    const parsed = new Date(resolvedYear, monthIndex, day, 0, 0, 0, 0);
    if (!Number.isNaN(parsed.getTime())) {
      candidates.push(parsed);
    }
  }

  const normalized = message.toLowerCase();
  if (normalized.includes("today")) {
    candidates.push(normalizeToStartOfDay(today));
  }
  if (normalized.includes("tomorrow")) {
    candidates.push(normalizeToStartOfDay(addDays(today, 1)));
  }
  if (normalized.includes("next week")) {
    candidates.push(normalizeToStartOfDay(addDays(today, 7)));
  }

  if (candidates.length === 0) return null;

  const todayStart = normalizeToStartOfDay(today).getTime();
  const upcoming = candidates
    .filter((date) => date.getTime() >= todayStart)
    .sort((left, right) => left.getTime() - right.getTime());

  if (upcoming.length > 0) {
    return upcoming[0];
  }

  return candidates.sort((left, right) => right.getTime() - left.getTime())[0];
}

function getNextBusinessContactSlot(now: Date = new Date()): Date {
  const slot = new Date(now);
  slot.setSeconds(0, 0);
  slot.setMinutes(slot.getMinutes() + 30);
  const roundedMinutes = slot.getMinutes() % 5;
  if (roundedMinutes !== 0) {
    slot.setMinutes(slot.getMinutes() + (5 - roundedMinutes));
  }

  if (slot.getDay() === 0) {
    slot.setDate(slot.getDate() + 1);
    slot.setHours(9, 30, 0, 0);
  }
  if (slot.getDay() === 6) {
    slot.setDate(slot.getDate() + 2);
    slot.setHours(9, 30, 0, 0);
  }

  if (slot.getHours() < 9 || (slot.getHours() === 9 && slot.getMinutes() < 30)) {
    slot.setHours(9, 30, 0, 0);
  } else if (slot.getHours() > 17 || (slot.getHours() === 17 && slot.getMinutes() > 0)) {
    slot.setDate(slot.getDate() + 1);
    slot.setHours(9, 30, 0, 0);
    while (slot.getDay() === 0 || slot.getDay() === 6) {
      slot.setDate(slot.getDate() + 1);
    }
  }

  return slot;
}

function getLatestBusinessSlotBeforeEvent(eventDate: Date): Date {
  const slot = new Date(eventDate);
  slot.setDate(slot.getDate() - 1);
  slot.setHours(16, 30, 0, 0);

  while (slot.getDay() === 0 || slot.getDay() === 6) {
    slot.setDate(slot.getDate() - 1);
  }

  return slot;
}

function deriveSoonOutreachSlot(
  eventDate: Date | null,
  now: Date = new Date()
): { scheduledDate: string; scheduledTime: string } {
  const soonSlot = getNextBusinessContactSlot(now);

  if (!eventDate) {
    return {
      scheduledDate: formatDateOnly(soonSlot),
      scheduledTime: formatTimeOnly(soonSlot),
    };
  }

  const latestBeforeEvent = getLatestBusinessSlotBeforeEvent(eventDate);
  if (soonSlot.getTime() <= latestBeforeEvent.getTime()) {
    return {
      scheduledDate: formatDateOnly(soonSlot),
      scheduledTime: formatTimeOnly(soonSlot),
    };
  }

  const urgentSlot = new Date(now);
  urgentSlot.setSeconds(0, 0);
  urgentSlot.setMinutes(urgentSlot.getMinutes() + 30);
  const roundedMinutes = urgentSlot.getMinutes() % 5;
  if (roundedMinutes !== 0) {
    urgentSlot.setMinutes(urgentSlot.getMinutes() + (5 - roundedMinutes));
  }

  if (urgentSlot.getTime() <= latestBeforeEvent.getTime()) {
    return {
      scheduledDate: formatDateOnly(latestBeforeEvent),
      scheduledTime: formatTimeOnly(latestBeforeEvent),
    };
  }

  return {
    scheduledDate: formatDateOnly(urgentSlot),
    scheduledTime: formatTimeOnly(urgentSlot),
  };
}

function detectPreferredLanguage(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("spanish")) return "Spanish";
  if (normalized.includes("german")) return "German";
  if (normalized.includes("french")) return "French";
  if (normalized.includes("turkish")) return "Turkish";
  return DEFAULT_LANGUAGE;
}

function detectServiceType(message: string): string {
  const normalized = message.toLowerCase();
  let bestServiceType = "";
  let bestScore = 0;

  for (const pattern of SERVICE_PATTERNS) {
    const matchCount = pattern.keywords.filter((keyword) =>
      normalized.includes(keyword)
    ).length;
    if (matchCount === 0) continue;

    const score =
      matchCount * 10 + (SERVICE_PRIORITY[pattern.serviceType] ?? 1);
    if (score > bestScore) {
      bestScore = score;
      bestServiceType = pattern.serviceType;
    }
  }

  return bestServiceType;
}

function isVenueLikeRequest(message: string): boolean {
  const normalized = message.toLowerCase();
  return [
    "venue",
    "event space",
    "party",
    "birthday",
    "bar",
    "rooftop",
    "restaurant",
    "resto",
    "reservation",
    "dinner",
    "lunch",
    "brunch",
    "cafe",
    "bistro",
    "food",
    "cuisine",
    "book a table",
    "wedding",
    "celebration",
    "offsite",
    "on-site",
    "onsite",
  ].some((keyword) => normalized.includes(keyword));
}

function detectLocation(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("sf")) return "San Francisco";
  if (normalized.includes("san francisco")) return "San Francisco";
  if (normalized.includes("munich")) return "Munich";

  const cities = Array.from(new Set(getProviderDirectory().map((provider) => provider.city)));
  for (const city of cities) {
    if (normalized.includes(city.toLowerCase())) {
      return city;
    }
  }

  return "";
}

const NON_LOCATION_START_WORDS = new Set(["a", "an", "the", "my", "our", "this", "that"]);
const NON_LOCATION_TERMS = new Set([
  "bar",
  "restaurant",
  "cafe",
  "bistro",
  "club",
  "party",
  "event",
  "birthday",
  "reservation",
  "table",
  "dinner",
  "lunch",
  "brunch",
  "rooftop",
]);

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
    if (tokens.some((token) => NON_LOCATION_TERMS.has(token))) continue;

    best = candidate;
  }

  if (!best) return "";

  return best
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveSearchLocation(
  latestUserMessage: string,
  contextMessage: string,
  preferPlaces: boolean
): string {
  const explicitFromUser = detectLocation(latestUserMessage) || extractFreeformLocation(latestUserMessage);
  if (explicitFromUser) return explicitFromUser;

  if (!preferPlaces) {
    return detectLocation(contextMessage) || extractFreeformLocation(contextMessage);
  }

  return "Munich";
}

function toWebSearchUserLocation(
  location: string
): WebSearchApproximateLocation | null {
  const normalized = location.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === "munich") {
    return {
      city: "Munich",
      country: "DE",
      region: "Bavaria",
      timezone: "Europe/Berlin",
    };
  }

  if (normalized === "san francisco") {
    return {
      city: "San Francisco",
      country: "US",
      region: "California",
      timezone: "America/Los_Angeles",
    };
  }

  return {
    city: location.trim(),
  };
}

function tokenizeMessage(message: string): string[] {
  return message
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function scoreContact(
  contact: Contact,
  messageLower: string,
  messageTerms: string[],
  messageDigits: string
): number {
  const nameLower = contact.name.toLowerCase();
  const notesLower = contact.notes.toLowerCase();
  const contactDigits = normalizePhone(contact.phone);
  const contactTail = contactDigits.length >= 7 ? contactDigits.slice(-7) : contactDigits;

  let score = 0;
  if (nameLower.length > 0 && messageLower.includes(nameLower)) {
    score += 12;
  }

  for (const term of messageTerms) {
    if (nameLower.includes(term)) score += 3;
    if (notesLower.includes(term)) score += 1;
  }

  if (messageDigits.length >= 7 && contactTail) {
    if (messageDigits.includes(contactTail)) score += 7;
    if (contactDigits.includes(messageDigits.slice(-7))) score += 4;
  }

  return score;
}

function buildCallReason(message: string, serviceType: string): string {
  if (serviceType) {
    const prettyService = serviceType
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
    return `${prettyService} request follow-up`;
  }

  if (message.length > 0) {
    return "Event and action request follow-up";
  }

  return "Follow-up request";
}

function buildCallPurpose(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  const summary =
    compact.length > 220 ? `${compact.slice(0, 217).trimEnd()}...` : compact;
  return summary
    ? `Understand details and execute this request: "${summary}".`
    : "Confirm details and execute next steps.";
}

function buildSuggestionFromContact(
  contact: Contact,
  context: SuggestionContext,
  reason: string
): ChatSuggestion {
  return {
    id: `contact-${contact.id}`,
    source: "existing_contact",
    name: contact.name,
    phone: contact.phone,
    reason,
    customerId: contact.id,
    callReason: context.callReason,
    callPurpose: context.callPurpose,
    notes: context.callPurpose,
    preferredLanguage: contact.preferredLanguage || context.preferredLanguage,
    scheduledDate: context.scheduledDate,
    scheduledTime: context.scheduledTime,
  };
}

function buildSuggestionFromProvider(
  provider: ProviderRecord,
  context: SuggestionContext,
  customerId: string | null,
  reason: string
): ChatSuggestion {
  return {
    id: `provider-${provider.id}`,
    source: "researched_provider",
    name: provider.name,
    phone: provider.phone,
    reason,
    customerId,
    callReason: context.callReason,
    callPurpose: context.callPurpose,
    notes: [
      context.callPurpose,
      `Provider: ${provider.name}`,
      `Address: ${provider.address}, ${provider.city}`,
      `Rating: ${provider.rating.toFixed(1)} (${provider.reviewCount} reviews)`,
      `Service types: ${provider.serviceTypes.join(", ")}`,
    ].join("\n"),
    preferredLanguage: context.preferredLanguage,
    scheduledDate: context.scheduledDate,
    scheduledTime: context.scheduledTime,
  };
}

function buildAdHocSuggestion(
  name: string,
  phone: string,
  context: SuggestionContext,
  reason: string,
  details?: string
): ChatSuggestion {
  return {
    id: `lead-${normalizePhone(phone) || name.toLowerCase().replace(/\s+/g, "-")}`,
    source: "researched_provider",
    name,
    phone,
    reason,
    customerId: null,
    callReason: context.callReason,
    callPurpose: context.callPurpose,
    notes: details ? `${context.callPurpose}\n${details}` : context.callPurpose,
    preferredLanguage: context.preferredLanguage,
    scheduledDate: context.scheduledDate,
    scheduledTime: context.scheduledTime,
  };
}

function createEmptyDiagnostics(): OnlineResearchDiagnostics {
  return {
    parsedEntries: 0,
    acceptedCallable: 0,
    missingAddress: 0,
    missingName: 0,
    missingPhone: 0,
    invalidPhone: 0,
    recoveredPhone: 0,
    websiteOnlyLeads: 0,
    duplicateWithContacts: 0,
    locationFilteredOut: 0,
    finalSuggestions: 0,
    usedWebSearch: false,
    sourceUrlCount: 0,
  };
}

function extractOnlineResearchCandidates(raw: unknown): {
  callablePlaces: OnlinePlaceResearch[];
  websiteLeads: OnlineWebsiteLead[];
  diagnostics: OnlineResearchDiagnostics;
} {
  const diagnostics = createEmptyDiagnostics();
  const record = toRecord(raw);
  if (!record) {
    return { callablePlaces: [], websiteLeads: [], diagnostics };
  }

  const entries = Array.isArray(record.places) ? record.places : [];
  diagnostics.parsedEntries = entries.length;

  const callablePlaces: OnlinePlaceResearch[] = [];
  const websiteLeads: OnlineWebsiteLead[] = [];
  for (const item of entries) {
    const placeRecord = toRecord(item);
    if (!placeRecord) continue;

    const name = normalizeText(placeRecord.name);
    if (!name) {
      diagnostics.missingName += 1;
      continue;
    }

    const address = normalizeText(placeRecord.address);
    const city = normalizeText(placeRecord.city);
    const reason = normalizeText(
      placeRecord.reason,
      "Online match for this request."
    );
    const websiteRaw = normalizeText(placeRecord.website);
    const website = websiteRaw || null;

    const rawPhone = normalizeText(placeRecord.phone);
    if (!rawPhone) {
      diagnostics.missingPhone += 1;
      if (website) {
        websiteLeads.push({ name, website, city, reason });
        diagnostics.websiteOnlyLeads += 1;
      }
      continue;
    }

    let phone = rawPhone;
    if (!isLikelyPhoneNumber(phone)) {
      const normalizedPhone = toCallablePhoneNumber(phone);
      if (normalizedPhone && isLikelyPhoneNumber(normalizedPhone)) {
        phone = normalizedPhone;
        diagnostics.recoveredPhone += 1;
      } else {
        diagnostics.invalidPhone += 1;
        if (website) {
          websiteLeads.push({ name, website, city, reason });
          diagnostics.websiteOnlyLeads += 1;
        }
        continue;
      }
    }

    callablePlaces.push({
      name,
      phone,
      address,
      city,
      reason,
      website,
    });
  }

  diagnostics.acceptedCallable = callablePlaces.length;

  return {
    callablePlaces,
    websiteLeads,
    diagnostics,
  };
}

function buildOnlineResearchPrompt(
  message: string,
  serviceType: string,
  location: string,
  preferPlaces: boolean
): { systemPrompt: string; userPrompt: string } {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const inferredService = serviceType || "requested event/location";
  const inferredLocation = location || "the location implied by the request";

  const systemPrompt = [
    "You are Lumi, researching real businesses on the public web.",
    "Use web search deeply to find currently operating businesses that match the request.",
    "Focus on venues and bars/restaurants where applicable.",
    "CRITICAL: Every result MUST include a callable phone number. This is the highest priority.",
    "Search specifically on Google Maps, Yelp, TripAdvisor, Yellow Pages, and official business pages to find phone numbers.",
    "If an event-listing site (e.g. rausgegangen.de, eventbrite, evepla) does not show a phone, search the venue name + city + 'phone number' or 'Telefon' or 'contact' separately.",
    "For German venues, look for 'Impressum' or 'Kontakt' pages which usually contain phone numbers.",
    "If a result is missing phone, keep searching other sources until you find it.",
    preferPlaces
      ? "Return venues/business places only (bars, clubs, restaurants, event spaces). Do not return individual personal contacts."
      : "Prefer venues/business places when the request mentions location, reservation, bars, restaurants, or events.",
    "If the target city is provided, exclude places outside that city.",
    "Do not fabricate names, phones, websites, or addresses.",
    "Return concise place research notes including name, phone, city, address (if available), website (if available), and one short reason.",
    `Return at most ${MAX_ONLINE_RESEARCH_RESULTS} places and prefer official business listings.`,
  ].join("\n");

  const userPrompt = [
    `Today is ${todayIso}.`,
    `User request: ${message}`,
    `Service intent: ${inferredService}`,
    `Target location: ${inferredLocation}`,
    `Place-first mode: ${preferPlaces ? "yes" : "no"}`,
    `Use this location for venue search unless the user explicitly requests a different city: ${inferredLocation}.`,
    "Required fields for each place: name, full address, city, callable phone number, and reason.",
    "IMPORTANT: For EACH venue, do a separate search for its phone number if not immediately found.",
    "Try queries like: '<venue name> <city> phone number', '<venue name> <city> Telefon kontakt', '<venue name> Google Maps'.",
    "Only include venues where you successfully found a phone number.",
  ].join("\n");

  return { systemPrompt, userPrompt };
}

function buildDeepVenueResearchPrompt(
  message: string,
  serviceType: string,
  location: string
): { systemPrompt: string; userPrompt: string } {
  const inferredService = serviceType || "bars, restaurants, or event venues";
  const inferredLocation = location || "Munich";

  const systemPrompt = [
    "You are a venue researcher specializing in finding business contact information.",
    "Use web search deeply and run multiple query variants before answering.",
    "Primary goal: return real venues with BOTH full address and callable phone number.",
    "PHONE NUMBER STRATEGY:",
    "1. Search Google Maps for the venue — it almost always has the phone number.",
    "2. Search '<venue name> <city> phone' or '<venue name> <city> Telefon'.",
    "3. Check the venue's own website, especially Impressum/Kontakt/Contact pages.",
    "4. Try Yelp, TripAdvisor, or Yellow Pages (Gelbe Seiten for Germany).",
    "Focus on bars, clubs, restaurants, and event venues in the target city.",
    "Do not return people/personal contacts.",
    "Do not fabricate names, addresses, phones, or websites.",
    `Return at most ${MAX_ONLINE_RESEARCH_RESULTS} places.`,
  ].join("\n");

  const userPrompt = [
    `Original request: ${message}`,
    `Service intent: ${inferredService}`,
    `Target location: ${inferredLocation}`,
    `Search these query variants:`,
    `1. "${inferredService} ${inferredLocation} phone number contact"`,
    `2. "${inferredService} ${inferredLocation} Google Maps"`,
    `3. "<specific venue name> ${inferredLocation} Telefon" for each venue found`,
    "Required per place: name, full address, city, callable phone number, short reason, website if available.",
    "Only return venues where you found a real phone number.",
  ].join("\n");

  return { systemPrompt, userPrompt };
}

function buildWebResearchNormalizationPrompt(input: {
  rawWebText: string;
  serviceType: string;
  location: string;
  preferPlaces: boolean;
}): { systemPrompt: string; userPrompt: string } {
  const inferredService = input.serviceType || "requested event/location";
  const inferredLocation = input.location || "the location implied by the request";
  const rawText =
    input.rawWebText.length > MAX_WEB_RESEARCH_TEXT_CHARS
      ? input.rawWebText.slice(0, MAX_WEB_RESEARCH_TEXT_CHARS)
      : input.rawWebText;

  const systemPrompt = [
    "You normalize web research notes into strict JSON.",
    "Use only places that are explicitly present in the source text.",
    "Never invent businesses, phones, websites, addresses, or cities.",
    "PHONE EXTRACTION RULES:",
    "- Extract phone numbers in ANY format: international (+49...), local (089...), with dashes, dots, spaces, or parentheses.",
    "- Look for patterns like 'Tel:', 'Telefon:', 'Phone:', 'Fon:', 'Call:', followed by digits.",
    "- German numbers may start with +49, 0049, or local area codes (089 for Munich, 030 for Berlin, etc.).",
    "- If a number appears anywhere near a venue name in the text, associate it with that venue.",
    "- Preserve the full phone number including country code when available.",
    "If phone is truly not present anywhere in the text for a venue, set phone to an empty string.",
    "If address is unavailable, set address to an empty string.",
    input.preferPlaces
      ? "Only include venue-like businesses (bars, restaurants, clubs, event spaces). Exclude people and non-venue services."
      : "Prefer venue-like businesses when possible.",
    input.location
      ? "If a place is clearly outside the target location, exclude it."
      : "If location is uncertain, keep only clearly relevant entries.",
    "Return strict JSON with this shape:",
    "{",
    '  "places": [',
    "    {",
    '      "name": string,',
    '      "phone": string,',
    '      "address": string,',
    '      "city": string,',
    '      "reason": string,',
    '      "website": string',
    "    }",
    "  ]",
    "}",
  ].join("\n");

  const userPrompt = [
    `Service intent: ${inferredService}`,
    `Target location: ${inferredLocation}`,
    `Place-first mode: ${input.preferPlaces ? "yes" : "no"}`,
    "Source web research text:",
    rawText,
  ].join("\n");

  return { systemPrompt, userPrompt };
}

function mergeUniqueStrings(values: string[][]): string[] {
  const merged: string[] = [];
  for (const list of values) {
    for (const value of list) {
      if (!value || merged.includes(value)) continue;
      merged.push(value);
    }
  }

  return merged;
}

function mergeDiagnostics(
  left: OnlineResearchDiagnostics,
  right: OnlineResearchDiagnostics
): OnlineResearchDiagnostics {
  return {
    parsedEntries: left.parsedEntries + right.parsedEntries,
    acceptedCallable: left.acceptedCallable + right.acceptedCallable,
    missingAddress: left.missingAddress + right.missingAddress,
    missingName: left.missingName + right.missingName,
    missingPhone: left.missingPhone + right.missingPhone,
    invalidPhone: left.invalidPhone + right.invalidPhone,
    recoveredPhone: left.recoveredPhone + right.recoveredPhone,
    websiteOnlyLeads: left.websiteOnlyLeads + right.websiteOnlyLeads,
    duplicateWithContacts:
      left.duplicateWithContacts + right.duplicateWithContacts,
    locationFilteredOut: left.locationFilteredOut + right.locationFilteredOut,
    finalSuggestions: left.finalSuggestions + right.finalSuggestions,
    usedWebSearch: left.usedWebSearch || right.usedWebSearch,
    sourceUrlCount: left.sourceUrlCount + right.sourceUrlCount,
  };
}

function buildResearchGapNote(diagnostics: OnlineResearchDiagnostics): string {
  const parts: string[] = [];

  if (diagnostics.parsedEntries > 0 && diagnostics.acceptedCallable === 0) {
    parts.push(
      `Found ${diagnostics.parsedEntries} venue${diagnostics.parsedEntries > 1 ? "s" : ""} but none had a reachable phone number.`
    );
  } else if (diagnostics.parsedEntries > 0) {
    parts.push(
      `Found ${diagnostics.parsedEntries} venue${diagnostics.parsedEntries > 1 ? "s" : ""}, ${diagnostics.acceptedCallable} with phone numbers.`
    );
  }

  if (diagnostics.recoveredPhone > 0) {
    parts.push(`Recovered ${diagnostics.recoveredPhone} phone number${diagnostics.recoveredPhone > 1 ? "s" : ""} via targeted search.`);
  }

  return parts.join(" ") || "No venues found in web search.";
}

async function recoverPhonesForLeads(
  leads: OnlineWebsiteLead[],
  location: string
): Promise<OnlinePlaceResearch[]> {
  if (leads.length === 0) return [];

  const venueList = leads
    .map((lead, index) => `${index + 1}. ${lead.name} (${lead.website})`)
    .join("\n");

  const systemPrompt = [
    "You are a phone number researcher. Your ONLY job is to find callable phone numbers for the listed venues.",
    "Search Google Maps, Yelp, TripAdvisor, Yellow Pages, and each venue's own website (especially Impressum/Kontakt/Contact pages).",
    "For German venues, try '<venue name> Telefon' or '<venue name> Impressum'.",
    "Return strict JSON: { \"results\": [{ \"name\": string, \"phone\": string, \"address\": string }] }",
    "phone must be a real callable number. If you truly cannot find a phone for a venue, omit that venue entirely.",
    "Do not fabricate phone numbers.",
  ].join("\n");

  const userPrompt = [
    `Find phone numbers for these venues in ${location || "the relevant city"}:`,
    venueList,
    "Search multiple sources per venue. Return only venues where you found a real phone number.",
  ].join("\n");

  try {
    const result = await createWebSearchTextCompletionWithMetadata({
      systemPrompt,
      userPrompt,
      temperature: 0,
      maxTokens: 5000,
      searchContextSize: "high",
      userLocation: toWebSearchUserLocation(location),
      includeSources: false,
    });

    const jsonPayload = await createJsonCompletion({
      systemPrompt: "Extract the JSON from the text. Return strict JSON: { \"results\": [{ \"name\": string, \"phone\": string, \"address\": string }] }. Never invent data.",
      userPrompt: result.text,
      temperature: 0,
      maxTokens: 5000,
    });

    const record = toRecord(jsonPayload);
    if (!record) return [];

    const entries = Array.isArray(record.results) ? record.results : [];
    const recovered: OnlinePlaceResearch[] = [];

    for (const entry of entries) {
      const rec = toRecord(entry);
      if (!rec) continue;
      const name = normalizeText(rec.name);
      const rawPhone = normalizeText(rec.phone);
      if (!name || !rawPhone) continue;

      let phone = rawPhone;
      if (!isLikelyPhoneNumber(phone)) {
        const normalized = toCallablePhoneNumber(phone);
        if (!normalized || !isLikelyPhoneNumber(normalized)) continue;
        phone = normalized;
      }

      const matchedLead = leads.find(
        (lead) => lead.name.toLowerCase() === name.toLowerCase()
      ) || leads.find(
        (lead) =>
          lead.name.toLowerCase().includes(name.toLowerCase()) ||
          name.toLowerCase().includes(lead.name.toLowerCase())
      );

      recovered.push({
        name,
        phone,
        address: normalizeText(rec.address) || matchedLead?.city || "",
        city: matchedLead?.city || "",
        reason: matchedLead?.reason || "Phone recovered via targeted search.",
        website: matchedLead?.website || null,
      });
    }

    return recovered;
  } catch {
    return [];
  }
}

async function runOnlineResearchAttempt(input: {
  message: string;
  serviceType: string;
  location: string;
  preferPlaces: boolean;
  context: SuggestionContext;
  existingPhones: Set<string>;
  systemPrompt: string;
  userPrompt: string;
}): Promise<OnlineResearchResult> {
  const webSearchResult = await createWebSearchTextCompletionWithMetadata({
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    temperature: 0.1,
    maxTokens: 5000,
    searchContextSize: "high",
    userLocation: toWebSearchUserLocation(input.location),
    includeSources: true,
  });
  const rawWebText = webSearchResult.text;

  const { systemPrompt: normalizeSystemPrompt, userPrompt: normalizeUserPrompt } =
    buildWebResearchNormalizationPrompt({
      rawWebText,
      serviceType: input.serviceType,
      location: input.location,
      preferPlaces: input.preferPlaces,
    });

  const normalizedPayload = await createJsonCompletion({
    systemPrompt: normalizeSystemPrompt,
    userPrompt: normalizeUserPrompt,
    temperature: 0,
    maxTokens: 5000,
  });

  const normalized = extractOnlineResearchCandidates(normalizedPayload);
  const diagnostics = normalized.diagnostics;
  diagnostics.usedWebSearch = webSearchResult.usedWebSearch;
  diagnostics.sourceUrlCount = webSearchResult.sourceUrls.length;

  if (
    normalized.callablePlaces.length === 0 &&
    normalized.websiteLeads.length > 0 &&
    input.preferPlaces
  ) {
    const recovered = await recoverPhonesForLeads(
      normalized.websiteLeads.slice(0, MAX_PHONE_RECOVERY_LEADS),
      input.location
    );
    for (const place of recovered) {
      normalized.callablePlaces.push(place);
      diagnostics.recoveredPhone += 1;
    }
  }

  let places = normalized.callablePlaces;
  let websiteLeads = normalized.websiteLeads;
  if (input.preferPlaces) {
    const placesWithAddress = places.filter((place) => Boolean(place.address.trim()));
    diagnostics.missingAddress += Math.max(0, places.length - placesWithAddress.length);
    places = placesWithAddress;
  }

  if (input.preferPlaces && input.location.trim()) {
    const locationNeedle = input.location.trim().toLowerCase();
    const matchingPlaces = places.filter((place) =>
      [place.name, place.address, place.city, place.reason]
        .join(" ")
        .toLowerCase()
        .includes(locationNeedle)
    );
    if (matchingPlaces.length > 0) {
      diagnostics.locationFilteredOut += Math.max(
        0,
        places.length - matchingPlaces.length
      );
      places = matchingPlaces;
    }

    const matchingWebsiteLeads = websiteLeads.filter((lead) =>
      [lead.name, lead.city, lead.reason, lead.website]
        .join(" ")
        .toLowerCase()
        .includes(locationNeedle)
    );
    if (matchingWebsiteLeads.length > 0) {
      diagnostics.locationFilteredOut += Math.max(
        0,
        websiteLeads.length - matchingWebsiteLeads.length
      );
      websiteLeads = matchingWebsiteLeads;
    }
  }

  const callablePlaces = places
    .filter((place) => !input.existingPhones.has(normalizePhone(place.phone)))
    .slice(0, MAX_ONLINE_RESEARCH_RESULTS);
  diagnostics.duplicateWithContacts = Math.max(
    0,
    places.length - callablePlaces.length
  );

  const suggestions = callablePlaces.map((place) =>
    buildAdHocSuggestion(
      place.name,
      place.phone,
      input.context,
      place.reason,
      [
        place.address ? `Address: ${place.address}` : "",
        place.city ? `City: ${place.city}` : "",
        place.website ? `Website: ${place.website}` : "",
        "Source: live web research",
      ]
        .filter(Boolean)
        .join("\n")
    )
  );

  const rankedSuggestions = dedupeSuggestions(suggestions).slice(
    0,
    MAX_SUGGESTIONS
  );
  diagnostics.finalSuggestions = rankedSuggestions.length;

  return {
    suggestions: rankedSuggestions,
    websiteLeads,
    diagnostics,
    sourceUrls: webSearchResult.sourceUrls,
  };
}

async function researchPlacesOnline(input: {
  message: string;
  serviceType: string;
  location: string;
  preferPlaces: boolean;
  context: SuggestionContext;
  existingPhones: Set<string>;
}): Promise<OnlineResearchResult> {
  if (!hasOpenAiApiKey()) {
    return {
      suggestions: [],
      websiteLeads: [],
      diagnostics: createEmptyDiagnostics(),
      sourceUrls: [],
    };
  }

  const basePrompt = buildOnlineResearchPrompt(
    input.message,
    input.serviceType,
    input.location,
    input.preferPlaces
  );
  const firstAttempt = await runOnlineResearchAttempt({
    ...input,
    systemPrompt: basePrompt.systemPrompt,
    userPrompt: basePrompt.userPrompt,
  });

  if (!input.preferPlaces || firstAttempt.suggestions.length >= 2) {
    return firstAttempt;
  }

  const deepPrompt = buildDeepVenueResearchPrompt(
    input.message,
    input.serviceType,
    input.location
  );
  const secondAttempt = await runOnlineResearchAttempt({
    ...input,
    systemPrompt: deepPrompt.systemPrompt,
    userPrompt: deepPrompt.userPrompt,
  });

  const mergedSuggestions = dedupeSuggestions([
    ...firstAttempt.suggestions,
    ...secondAttempt.suggestions,
  ]).slice(0, MAX_SUGGESTIONS);

  return {
    suggestions: mergedSuggestions,
    websiteLeads: [...firstAttempt.websiteLeads, ...secondAttempt.websiteLeads],
    diagnostics: {
      ...mergeDiagnostics(firstAttempt.diagnostics, secondAttempt.diagnostics),
      finalSuggestions: mergedSuggestions.length,
      sourceUrlCount: mergeUniqueStrings([
        firstAttempt.sourceUrls,
        secondAttempt.sourceUrls,
      ]).length,
    },
    sourceUrls: mergeUniqueStrings([
      firstAttempt.sourceUrls,
      secondAttempt.sourceUrls,
    ]),
  };
}

function isLiveWebSuggestion(suggestion: ChatSuggestion): boolean {
  return suggestion.notes.toLowerCase().includes("source: live web research");
}

function rankSuggestions(
  suggestions: ChatSuggestion[],
  preferPlaces: boolean
): ChatSuggestion[] {
  const deduped = dedupeSuggestions(suggestions);
  if (!preferPlaces) return deduped.slice(0, MAX_SUGGESTIONS);

  const ranked = [...deduped].sort((left, right) => {
    const score = (item: ChatSuggestion): number => {
      let value = 0;
      if (isLiveWebSuggestion(item)) value += 100;
      if (item.source === "researched_provider") value += 10;
      if (item.source === "existing_contact") value += 1;
      return value;
    };
    return score(right) - score(left);
  });

  return ranked.slice(0, MAX_SUGGESTIONS);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "Unknown error";
}

function ensureLocationMention(
  reply: string,
  location: string,
  preferPlaces: boolean
): string {
  if (!preferPlaces || !location.trim()) return reply;
  if (reply.toLowerCase().includes(location.toLowerCase())) return reply;
  return `${reply.trim()} Search location: ${location}.`;
}

function buildReplyForSuggestionCount(
  suggestionCount: number,
  preferPlaces: boolean,
  location: string
): string {
  const replyBase = preferPlaces
    ? suggestionCount > 0
      ? `I found ${suggestionCount} place${
          suggestionCount > 1 ? "s" : ""
        } you can call for this request.`
      : "I could not identify callable venues from the current data."
    : suggestionCount > 0
      ? `I found ${suggestionCount} contact${
          suggestionCount > 1 ? "s" : ""
        } to call for this request.`
      : "I could not identify a reliable contact from the current data.";

  return ensureLocationMention(replyBase, location, preferPlaces);
}

function isExplicitSuggestionMentioned(
  contextMessage: string,
  suggestionName: string
): boolean {
  const messageLower = contextMessage.toLowerCase();
  const nameLower = suggestionName.trim().toLowerCase();
  if (!nameLower) return false;
  return messageLower.includes(nameLower);
}

function pickLegacyContactForPlaceMode(
  contextMessage: string,
  suggestions: ChatSuggestion[]
): ChatSuggestion | null {
  const legacyContacts = suggestions.filter(
    (suggestion) => suggestion.source === "existing_contact"
  );
  if (legacyContacts.length === 0) return null;

  return (
    legacyContacts.find((suggestion) =>
      isExplicitSuggestionMentioned(contextMessage, suggestion.name)
    ) || legacyContacts[0]
  );
}

function dedupeSuggestions(suggestions: ChatSuggestion[]): ChatSuggestion[] {
  const seen = new Set<string>();
  const deduped: ChatSuggestion[] = [];

  for (const suggestion of suggestions) {
    if (!isLikelyPhoneNumber(suggestion.phone)) continue;
    const phoneKey = normalizePhone(suggestion.phone);
    const nameKey = suggestion.name.trim().toLowerCase();
    const key = phoneKey || nameKey;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(suggestion);
  }

  return deduped;
}

function findContactByName(contacts: Contact[], candidateName: string): Contact | null {
  const normalized = candidateName.trim().toLowerCase();
  if (!normalized) return null;

  const exact = contacts.find((contact) => contact.name.toLowerCase() === normalized);
  if (exact) return exact;

  return (
    contacts.find(
      (contact) =>
        contact.name.toLowerCase().includes(normalized) ||
        normalized.includes(contact.name.toLowerCase())
    ) || null
  );
}

function findProviderByName(
  providers: ProviderRecord[],
  candidateName: string
): ProviderRecord | null {
  const normalized = candidateName.trim().toLowerCase();
  if (!normalized) return null;

  const exact = providers.find((provider) => provider.name.toLowerCase() === normalized);
  if (exact) return exact;

  return (
    providers.find(
      (provider) =>
        provider.name.toLowerCase().includes(normalized) ||
        normalized.includes(provider.name.toLowerCase())
    ) || null
  );
}

function buildFallbackPlan(
  message: string,
  contextMessage: string,
  eventDate: Date | null,
  preferPlaces: boolean,
  searchLocation: string,
  contacts: Contact[]
): Plan {
  const scheduleSlot = deriveSoonOutreachSlot(eventDate);
  const preferredLanguage = detectPreferredLanguage(contextMessage);
  const serviceType = detectServiceType(message) || detectServiceType(contextMessage);
  const location = searchLocation;

  const context: SuggestionContext = {
    callReason: buildCallReason(contextMessage, serviceType),
    callPurpose: buildCallPurpose(message || contextMessage),
    preferredLanguage,
    scheduledDate: scheduleSlot.scheduledDate,
    scheduledTime: scheduleSlot.scheduledTime,
  };

  const messageLower = contextMessage.toLowerCase();
  const terms = tokenizeMessage(contextMessage);
  const digits = normalizePhone(contextMessage);

  const contactSuggestions = contacts
    .map((contact) => ({
      contact,
      score: scoreContact(contact, messageLower, terms, digits),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map((entry) =>
      buildSuggestionFromContact(
        entry.contact,
        context,
        "Existing contact likely related to this request."
      )
    );

  const phoneToCustomer = new Map(
    contacts.map((contact) => [normalizePhone(contact.phone), contact.id])
  );

  const shouldResearchProviders =
    !preferPlaces &&
    (Boolean(serviceType) || Boolean(location) || contactSuggestions.length === 0);
  const providerSuggestions = shouldResearchProviders
    ? searchProviders({
        serviceType: serviceType || undefined,
        locationQuery: location || undefined,
        minRating: 4.2,
        maxResults: MAX_SUGGESTIONS,
      }).map((provider) =>
        buildSuggestionFromProvider(
          provider,
          context,
          phoneToCustomer.get(normalizePhone(provider.phone)) || null,
          `Strong match for this request in ${provider.city} (${provider.rating.toFixed(
            1
          )} stars).`
        )
      )
    : [];

  let suggestions = dedupeSuggestions([
    ...contactSuggestions,
    ...providerSuggestions,
  ]).slice(0, MAX_SUGGESTIONS);

  if (!preferPlaces && suggestions.length === 0 && contacts.length > 0) {
    suggestions = [
      buildSuggestionFromContact(
        contacts[0],
        context,
        "Most recent contact available to call right away."
      ),
    ];
  }

  const reply = buildReplyForSuggestionCount(
    suggestions.length,
    preferPlaces,
    location
  );

  return {
    reply,
    suggestions,
    source: "fallback",
    sourceReason: null,
    serviceType,
    location,
    context,
  };
}

async function buildOpenAiPlan(
  message: string,
  history: ChatHistoryItem[],
  contextMessage: string,
  eventDate: Date | null,
  preferPlaces: boolean,
  contacts: Contact[],
  fallback: Plan
): Promise<Plan> {
  const providers = getProviderDirectory();
  const providersForPrompt = preferPlaces ? [] : providers;
  const phoneToContact = new Map(
    contacts.map((contact) => [normalizePhone(contact.phone), contact])
  );
  const phoneToProvider = new Map(
    providers.map((provider) => [normalizePhone(provider.phone), provider])
  );

  const systemPrompt = [
    "You are Lumi, an operations scheduler assistant.",
    "Choose the best people or businesses to contact based on the user request.",
    "Prefer exact existing contacts when available, otherwise pick researched providers.",
    "Prefer web-researched places with real phone numbers when available.",
    preferPlaces
      ? "This request is place/venue-oriented. Include at least 2 place suggestions with callable phone numbers. Contacts can be additional, not the only options."
      : "If this request is place/venue-oriented, include at least 2 place suggestions with callable phone numbers.",
    "Outreach calls must be scheduled as soon as possible and before the event date.",
    "Return strict JSON with this shape:",
    "{",
    '  "reply": string,',
    '  "call_reason": string,',
    '  "call_purpose": string,',
    '  "preferred_language": string,',
    '  "scheduled_date": "YYYY-MM-DD",',
    '  "scheduled_time": "HH:mm",',
    '  "service_type": string,',
    '  "location": string,',
    '  "suggestions": [',
    "    {",
    '      "name": string,',
    '      "phone": string,',
    '      "reason": string,',
    '      "source": "existing_contact" | "researched_provider",',
    '      "customer_id": string (optional)',
    "    }",
    "  ]",
    "}",
    "Only include suggestions that are likely callable now.",
    `Limit suggestions to ${MAX_SUGGESTIONS}.`,
  ].join("\n");

  const historyBlock =
    history.length > 0
      ? history
          .map(
            (entry) =>
              `${entry.role === "user" ? "User" : "Assistant"}: ${entry.text}`
          )
          .join("\n")
      : "No previous turns.";

  const userPrompt = [
    "Conversation history:",
    historyBlock,
    "",
    `Latest user request: ${message}`,
    `Prefer place-first suggestions: ${preferPlaces ? "yes" : "no"}`,
    "",
    `Default scheduled date: ${fallback.context.scheduledDate}`,
    `Default scheduled time: ${fallback.context.scheduledTime}`,
    `Default language: ${fallback.context.preferredLanguage}`,
    "",
    "Existing contacts JSON:",
    JSON.stringify(
      contacts.slice(0, 40).map((contact) => ({
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        notes: contact.notes,
        preferredLanguage: contact.preferredLanguage,
      }))
    ),
    "",
    "Provider directory JSON:",
    JSON.stringify(
      providersForPrompt.map((provider) => ({
        id: provider.id,
        name: provider.name,
        phone: provider.phone,
        city: provider.city,
        address: provider.address,
        rating: provider.rating,
        reviewCount: provider.reviewCount,
        serviceTypes: provider.serviceTypes,
      }))
    ),
  ].join("\n");

  const completion = await createJsonCompletion({
    systemPrompt,
    userPrompt,
    temperature: 0.2,
    maxTokens: 900,
  });
  const payload = toRecord(completion);
  if (!payload) {
    throw new Error("OpenAI did not return a JSON object");
  }

  const callReason = normalizeText(payload.call_reason, fallback.context.callReason);
  const callPurpose = normalizeText(payload.call_purpose, fallback.context.callPurpose);
  const preferredLanguage = normalizeText(
    payload.preferred_language,
    fallback.context.preferredLanguage
  );

  const modelScheduledDateRaw = normalizeText(
    payload.scheduled_date,
    fallback.context.scheduledDate
  );
  const modelScheduledTimeRaw = normalizeText(
    payload.scheduled_time,
    fallback.context.scheduledTime
  );
  const modelScheduleDate = isDateOnly(modelScheduledDateRaw)
    ? parseDateOnly(modelScheduledDateRaw)
    : null;
  const modelScheduleTime = isTimeOnly(modelScheduledTimeRaw)
    ? modelScheduledTimeRaw
    : null;

  const combinedScheduleSource = [
    contextMessage,
    callReason,
    callPurpose,
    modelScheduleDate ? formatDateOnly(modelScheduleDate) : "",
    modelScheduleTime || "",
  ]
    .filter(Boolean)
    .join("\n");

  const finalEventDate = eventDate || parseEventDateFromText(combinedScheduleSource);
  const scheduleSlot = deriveSoonOutreachSlot(finalEventDate);

  const context: SuggestionContext = {
    callReason,
    callPurpose,
    preferredLanguage,
    scheduledDate: scheduleSlot.scheduledDate,
    scheduledTime: scheduleSlot.scheduledTime,
  };

  const serviceType = normalizeText(payload.service_type, fallback.serviceType);
  const location = normalizeText(payload.location, fallback.location);

  const suggestionsRaw = Array.isArray(payload.suggestions) ? payload.suggestions : [];
  const openAiSuggestions: ChatSuggestion[] = [];

  for (const candidate of suggestionsRaw) {
    const record = toRecord(candidate);
    if (!record) continue;

    const name = normalizeText(record.name);
    const phone = normalizeText(record.phone);
    const reason = normalizeText(
      record.reason,
      "High-confidence contact match for this request."
    );
    const explicitCustomerId = normalizeText(record.customer_id) || null;

    let matchedContact: Contact | null = null;
    if (explicitCustomerId) {
      matchedContact =
        contacts.find((contact) => contact.id === explicitCustomerId) || null;
    }
    if (!matchedContact && phone) {
      matchedContact = phoneToContact.get(normalizePhone(phone)) || null;
    }
    if (!matchedContact && name) {
      matchedContact = findContactByName(contacts, name);
    }

    if (matchedContact) {
      openAiSuggestions.push(buildSuggestionFromContact(matchedContact, context, reason));
      continue;
    }

    let matchedProvider: ProviderRecord | null = null;
    if (!preferPlaces) {
      if (phone) {
        matchedProvider = phoneToProvider.get(normalizePhone(phone)) || null;
      }
      if (!matchedProvider && name) {
        matchedProvider = findProviderByName(providers, name);
      }
    }

    if (matchedProvider) {
      const mappedCustomerId =
        phoneToContact.get(normalizePhone(matchedProvider.phone))?.id || null;
      openAiSuggestions.push(
        buildSuggestionFromProvider(matchedProvider, context, mappedCustomerId, reason)
      );
      continue;
    }

    if (!preferPlaces && name && phone && isLikelyPhoneNumber(phone)) {
      openAiSuggestions.push(buildAdHocSuggestion(name, phone, context, reason));
    }
  }

  let suggestions = rankSuggestions(openAiSuggestions, preferPlaces);
  if (suggestions.length === 0) {
    if (preferPlaces) {
      suggestions = rankSuggestions(fallback.suggestions, true);
    } else {
      const researchedProviders = searchProviders({
        serviceType: serviceType || undefined,
        locationQuery: location || undefined,
        minRating: 4.2,
        maxResults: MAX_SUGGESTIONS,
      }).map((provider) => {
        const mappedCustomerId =
          phoneToContact.get(normalizePhone(provider.phone))?.id || null;
        return buildSuggestionFromProvider(
          provider,
          context,
          mappedCustomerId,
          `Good match for this request in ${provider.city}.`
        );
      });

      suggestions = rankSuggestions([
        ...researchedProviders,
        ...fallback.suggestions,
      ], false);
    }
  }

  const reply = ensureLocationMention(
    normalizeText(payload.reply, fallback.reply),
    fallback.location,
    preferPlaces
  );

  return {
    reply,
    suggestions,
    source: "openai",
    sourceReason: null,
    serviceType,
    location,
    context,
  };
}

function toAssistantResponse(plan: Plan): AssistantResponse {
  return {
    reply: plan.reply,
    suggestions: plan.suggestions,
    source: plan.source,
    sourceReason: plan.sourceReason,
  };
}

function toWebSourceHosts(sourceUrls: string[]): string[] {
  const hosts: string[] = [];
  for (const rawUrl of sourceUrls) {
    try {
      const host = new URL(rawUrl).host;
      if (!host || hosts.includes(host)) continue;
      hosts.push(host);
    } catch {
      continue;
    }
  }

  return hosts.slice(0, MAX_WEB_SOURCE_URLS_IN_NOTE);
}

function buildWebSourceNote(sourceUrls: string[]): string | null {
  const hosts = toWebSourceHosts(sourceUrls);
  if (hosts.length === 0) return null;
  return `Web sources checked: ${hosts.join(", ")}.`;
}

function buildWebsiteLeadsNote(leads: OnlineWebsiteLead[]): string | null {
  if (leads.length === 0) return null;

  if (leads.length === 1) {
    const lead = leads[0];
    const citySegment = lead.city ? ` in ${lead.city}` : "";
    return `No callable phone was found, but one lead${citySegment}: ${lead.name} (${lead.website}).`;
  }

  const leadLines = leads
    .slice(0, 5)
    .map((lead) => {
      const citySegment = lead.city ? ` in ${lead.city}` : "";
      return `${lead.name}${citySegment} (${lead.website})`;
    });
  return `No callable phones found, but ${leads.length} website leads: ${leadLines.join("; ")}.`;
}

function logOnlineResearchDiagnostics(input: {
  preferPlaces: boolean;
  location: string;
  diagnostics: OnlineResearchDiagnostics;
  sourceUrls: string[];
  error: string | null;
}): void {
  console.info("[lumi:web-place-research]", {
    preferPlaces: input.preferPlaces,
    location: input.location,
    diagnostics: input.diagnostics,
    sourceUrls: input.sourceUrls.slice(0, 10),
    error: input.error,
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = normalizeText(body.message);
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  const history = parseHistory(body.history);
  const contextMessage = buildContextMessage(message, history);
  const eventDate =
    parseEventDateFromText(message) || parseEventDateFromText(contextMessage);
  const preferPlaces = isVenueLikeRequest(contextMessage);
  const searchLocation = resolveSearchLocation(
    message,
    contextMessage,
    preferPlaces
  );

  const contacts = await db.customer.findMany({
    orderBy: { updatedAt: "desc" },
    take: 120,
    select: {
      id: true,
      name: true,
      phone: true,
      notes: true,
      preferredLanguage: true,
    },
  });

  const fallbackPlanBase = buildFallbackPlan(
    message,
    contextMessage,
    eventDate,
    preferPlaces,
    searchLocation,
    contacts
  );
  const contactPhones = new Set(
    contacts.map((contact) => normalizePhone(contact.phone)).filter(Boolean)
  );

  let onlineResearchResult: OnlineResearchResult = {
    suggestions: [],
    websiteLeads: [],
    diagnostics: createEmptyDiagnostics(),
    sourceUrls: [],
  };
  let onlineResearchError: string | null = null;
  if (hasOpenAiApiKey()) {
    try {
      onlineResearchResult = await researchPlacesOnline({
        message: contextMessage,
        serviceType: fallbackPlanBase.serviceType,
        location: fallbackPlanBase.location,
        preferPlaces,
        context: fallbackPlanBase.context,
        existingPhones: contactPhones,
      });
    } catch (error) {
      onlineResearchResult = {
        suggestions: [],
        websiteLeads: [],
        diagnostics: createEmptyDiagnostics(),
        sourceUrls: [],
      };
      onlineResearchError = toErrorMessage(error);
    }
  }
  const onlineSuggestions = onlineResearchResult.suggestions;
  const webSourceNote = buildWebSourceNote(onlineResearchResult.sourceUrls);
  const websiteLeadsNote =
    onlineSuggestions.length === 0
      ? buildWebsiteLeadsNote(onlineResearchResult.websiteLeads)
      : null;

  logOnlineResearchDiagnostics({
    preferPlaces,
    location: fallbackPlanBase.location,
    diagnostics: onlineResearchResult.diagnostics,
    sourceUrls: onlineResearchResult.sourceUrls,
    error: onlineResearchError,
  });

  const legacyContactForPlaceMode = pickLegacyContactForPlaceMode(
    contextMessage,
    fallbackPlanBase.suggestions
  );
  const fallbackCandidates = preferPlaces
    ? onlineSuggestions.length > 0
      ? [
          ...onlineSuggestions.slice(
            0,
            Math.max(
              1,
              MAX_SUGGESTIONS - (legacyContactForPlaceMode ? 1 : 0)
            )
          ),
          ...(legacyContactForPlaceMode ? [legacyContactForPlaceMode] : []),
        ]
      : legacyContactForPlaceMode
        ? [legacyContactForPlaceMode]
        : []
    : [...fallbackPlanBase.suggestions, ...onlineSuggestions];
  const fallbackSuggestions = rankSuggestions(fallbackCandidates, preferPlaces);

  const fallbackPlan: Plan = {
    ...fallbackPlanBase,
    reply: buildReplyForSuggestionCount(
      fallbackSuggestions.length,
      preferPlaces,
      fallbackPlanBase.location
    ),
    suggestions: fallbackSuggestions,
    sourceReason:
      preferPlaces && onlineSuggestions.length === 0
        ? onlineResearchError
          ? [
              `Live web place research failed (${onlineResearchError}). Showing best available options.`,
              webSourceNote,
            ]
              .filter(Boolean)
              .join(" ")
          : [
              "Live web place research returned no callable venues. Showing best available options.",
              buildResearchGapNote(onlineResearchResult.diagnostics),
              websiteLeadsNote,
              webSourceNote,
            ]
              .filter(Boolean)
              .join(" ")
        : onlineResearchError
          ? [
              `Live web place research failed (${onlineResearchError}).`,
              webSourceNote,
            ]
              .filter(Boolean)
              .join(" ")
          : null,
  };

  if (!hasOpenAiApiKey()) {
    return NextResponse.json(
      toAssistantResponse({
        ...fallbackPlan,
        source: "fallback",
        sourceReason: "OpenAI API key not configured",
      })
    );
  }

  if (preferPlaces) {
    return NextResponse.json(
      toAssistantResponse({
        ...fallbackPlan,
        source: onlineSuggestions.length > 0 ? "openai" : "fallback",
      })
    );
  }

  try {
    const openAiPlan = await buildOpenAiPlan(
      message,
      history,
      contextMessage,
      eventDate,
      preferPlaces,
      contacts,
      fallbackPlan
    );
    const merged = rankSuggestions(
      [...openAiPlan.suggestions, ...fallbackPlan.suggestions],
      false
    );

    return NextResponse.json(
      toAssistantResponse({
        ...openAiPlan,
        suggestions: merged,
        source: "openai",
        sourceReason: fallbackPlan.sourceReason,
      })
    );
  } catch (error) {
    const reason =
      error instanceof Error
        ? `OpenAI request failed. Using fallback. (${error.message})`
        : "OpenAI request failed. Using fallback.";

    return NextResponse.json(
      toAssistantResponse({
        ...fallbackPlan,
        source: "fallback",
        sourceReason: reason,
      })
    );
  }
}
