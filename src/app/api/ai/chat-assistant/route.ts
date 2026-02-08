import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createJsonCompletion, hasOpenAiApiKey } from "@/lib/openai";
import {
  type ProviderRecord,
  getProviderDirectory,
  searchProviders,
} from "@/lib/provider-directory";
import { isLikelyPhoneNumber } from "@/lib/validation";

const MAX_SUGGESTIONS = 3;
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

function getDefaultScheduledDate(): string {
  const nextDay = addDays(new Date(), 1);
  nextDay.setHours(0, 0, 0, 0);
  return formatDateOnly(nextDay);
}

function getDefaultScheduledTime(): string {
  return "10:00";
}

function extractDateFromMessage(message: string, fallback: string): string {
  const isoMatch = message.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const parsed = new Date(
      Number(isoMatch[1]),
      Number(isoMatch[2]) - 1,
      Number(isoMatch[3]),
      0,
      0,
      0,
      0
    );
    if (!Number.isNaN(parsed.getTime())) {
      return formatDateOnly(parsed);
    }
  }

  const normalized = message.toLowerCase();
  if (normalized.includes("today")) return formatDateOnly(new Date());
  if (normalized.includes("tomorrow")) return formatDateOnly(addDays(new Date(), 1));
  if (normalized.includes("next week")) return formatDateOnly(addDays(new Date(), 7));

  return fallback;
}

function extractTimeFromMessage(message: string, fallback: string): string {
  const hhmm = message.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (hhmm) {
    const hour = Number(hhmm[1]);
    const minute = Number(hhmm[2]);
    if (Number.isFinite(hour) && Number.isFinite(minute)) {
      return `${`${hour}`.padStart(2, "0")}:${`${minute}`.padStart(2, "0")}`;
    }
  }

  const ampm = message.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i);
  if (ampm) {
    let hour = Number(ampm[1]) % 12;
    const minute = Number(ampm[2] || "0");
    const meridiem = ampm[3].toLowerCase();
    if (meridiem === "pm") hour += 12;
    return `${`${hour}`.padStart(2, "0")}:${`${minute}`.padStart(2, "0")}`;
  }

  const normalized = message.toLowerCase();
  if (normalized.includes("morning")) return "09:00";
  if (normalized.includes("afternoon")) return "14:00";
  if (normalized.includes("evening") || normalized.includes("tonight")) return "19:00";

  return fallback;
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

  for (const pattern of SERVICE_PATTERNS) {
    if (pattern.keywords.some((keyword) => normalized.includes(keyword))) {
      return pattern.serviceType;
    }
  }

  return "";
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
  reason: string
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
    notes: context.callPurpose,
    preferredLanguage: context.preferredLanguage,
    scheduledDate: context.scheduledDate,
    scheduledTime: context.scheduledTime,
  };
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
  contacts: Contact[]
): Plan {
  const defaultDate = getDefaultScheduledDate();
  const defaultTime = getDefaultScheduledTime();

  const scheduledDate = extractDateFromMessage(contextMessage, defaultDate);
  const scheduledTime = extractTimeFromMessage(contextMessage, defaultTime);
  const preferredLanguage = detectPreferredLanguage(contextMessage);
  const serviceType = detectServiceType(contextMessage);
  const location = detectLocation(contextMessage);

  const context: SuggestionContext = {
    callReason: buildCallReason(contextMessage, serviceType),
    callPurpose: buildCallPurpose(message || contextMessage),
    preferredLanguage,
    scheduledDate,
    scheduledTime,
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
    Boolean(serviceType) || Boolean(location) || contactSuggestions.length === 0;
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

  if (suggestions.length === 0 && contacts.length > 0) {
    suggestions = [
      buildSuggestionFromContact(
        contacts[0],
        context,
        "Most recent contact available to call right away."
      ),
    ];
  }

  const reply =
    suggestions.length > 0
      ? `I found ${suggestions.length} contact${
          suggestions.length > 1 ? "s" : ""
        } to call for this request.`
      : "I could not identify a reliable contact from the current data.";

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
  contacts: Contact[],
  fallback: Plan
): Promise<Plan> {
  const providers = getProviderDirectory();
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
      providers.map((provider) => ({
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

  const scheduledDateRaw = normalizeText(payload.scheduled_date, fallback.context.scheduledDate);
  const scheduledDate = isDateOnly(scheduledDateRaw)
    ? scheduledDateRaw
    : fallback.context.scheduledDate;

  const scheduledTimeRaw = normalizeText(payload.scheduled_time, fallback.context.scheduledTime);
  const scheduledTime = isTimeOnly(scheduledTimeRaw)
    ? scheduledTimeRaw
    : fallback.context.scheduledTime;

  const context: SuggestionContext = {
    callReason,
    callPurpose,
    preferredLanguage,
    scheduledDate,
    scheduledTime,
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
    if (phone) {
      matchedProvider = phoneToProvider.get(normalizePhone(phone)) || null;
    }
    if (!matchedProvider && name) {
      matchedProvider = findProviderByName(providers, name);
    }

    if (matchedProvider) {
      const mappedCustomerId =
        phoneToContact.get(normalizePhone(matchedProvider.phone))?.id || null;
      openAiSuggestions.push(
        buildSuggestionFromProvider(matchedProvider, context, mappedCustomerId, reason)
      );
      continue;
    }

    if (name && phone && isLikelyPhoneNumber(phone)) {
      openAiSuggestions.push(buildAdHocSuggestion(name, phone, context, reason));
    }
  }

  let suggestions = dedupeSuggestions(openAiSuggestions).slice(0, MAX_SUGGESTIONS);
  if (suggestions.length === 0) {
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

    suggestions = dedupeSuggestions([
      ...researchedProviders,
      ...fallback.suggestions,
    ]).slice(0, MAX_SUGGESTIONS);
  }

  const reply = normalizeText(payload.reply, fallback.reply);

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

  const fallbackPlan = buildFallbackPlan(message, contextMessage, contacts);

  if (!hasOpenAiApiKey()) {
    return NextResponse.json(
      toAssistantResponse({
        ...fallbackPlan,
        source: "fallback",
        sourceReason: "OpenAI API key not configured",
      })
    );
  }

  try {
    const openAiPlan = await buildOpenAiPlan(
      message,
      history,
      contacts,
      fallbackPlan
    );
    const merged = dedupeSuggestions([
      ...openAiPlan.suggestions,
      ...fallbackPlan.suggestions,
    ]).slice(0, MAX_SUGGESTIONS);

    return NextResponse.json(
      toAssistantResponse({
        ...openAiPlan,
        suggestions: merged,
        source: "openai",
        sourceReason: null,
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
