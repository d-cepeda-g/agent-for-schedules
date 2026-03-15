import { isLikelyPhoneNumber } from "@/lib/validation";
import type { ProviderRecord } from "@/lib/provider-directory";
import type { ChatSuggestion, Contact, SuggestionContext } from "./types";
import { normalizePhone } from "./parsing";

export const MAX_SUGGESTIONS = 3;

export function buildSuggestionFromContact(
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

export function buildSuggestionFromProvider(
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

export function buildAdHocSuggestion(
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

export function dedupeSuggestions(suggestions: ChatSuggestion[]): ChatSuggestion[] {
  const seen = new Set<string>();
  const deduped: ChatSuggestion[] = [];
  for (const s of suggestions) {
    if (!isLikelyPhoneNumber(s.phone)) continue;
    const phoneKey = normalizePhone(s.phone);
    const nameKey = s.name.trim().toLowerCase();
    const key = phoneKey || nameKey;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
  }
  return deduped;
}

function isLiveWebSuggestion(s: ChatSuggestion): boolean {
  return s.notes.toLowerCase().includes("source: live web research");
}

export function rankSuggestions(
  suggestions: ChatSuggestion[],
  preferPlaces: boolean
): ChatSuggestion[] {
  const deduped = dedupeSuggestions(suggestions);
  if (!preferPlaces) return deduped.slice(0, MAX_SUGGESTIONS);
  const ranked = [...deduped].sort((a, b) => {
    const score = (item: ChatSuggestion): number => {
      let v = 0;
      if (isLiveWebSuggestion(item)) v += 100;
      if (item.source === "researched_provider") v += 10;
      if (item.source === "existing_contact") v += 1;
      return v;
    };
    return score(b) - score(a);
  });
  return ranked.slice(0, MAX_SUGGESTIONS);
}

export function scoreContact(
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
  if (nameLower.length > 0 && messageLower.includes(nameLower)) score += 12;
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

export function buildCallReason(message: string, serviceType: string): string {
  if (serviceType) {
    const pretty = serviceType.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    return `${pretty} request follow-up`;
  }
  if (message.length > 0) return "Event and action request follow-up";
  return "Follow-up request";
}

export function buildCallPurpose(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  const summary = compact.length > 220 ? `${compact.slice(0, 217).trimEnd()}...` : compact;
  return summary ? `Understand details and execute this request: "${summary}".` : "Confirm details and execute next steps.";
}

export function buildReplyForSuggestionCount(
  count: number,
  preferPlaces: boolean,
  location: string
): string {
  const base = preferPlaces
    ? count > 0
      ? `I found ${count} place${count > 1 ? "s" : ""} you can call for this request.`
      : "I could not identify callable venues from the current data."
    : count > 0
      ? `I found ${count} contact${count > 1 ? "s" : ""} to call for this request.`
      : "I could not identify a reliable contact from the current data.";
  return ensureLocationMention(base, location, preferPlaces);
}

export function ensureLocationMention(reply: string, location: string, preferPlaces: boolean): string {
  if (!preferPlaces || !location.trim()) return reply;
  if (reply.toLowerCase().includes(location.toLowerCase())) return reply;
  return `${reply.trim()} Search location: ${location}.`;
}

export function findContactByName(contacts: Contact[], name: string): Contact | null {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  const exact = contacts.find((c) => c.name.toLowerCase() === normalized);
  if (exact) return exact;
  return contacts.find(
    (c) => c.name.toLowerCase().includes(normalized) || normalized.includes(c.name.toLowerCase())
  ) || null;
}

export function findProviderByName(providers: ProviderRecord[], name: string): ProviderRecord | null {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  const exact = providers.find((p) => p.name.toLowerCase() === normalized);
  if (exact) return exact;
  return providers.find(
    (p) => p.name.toLowerCase().includes(normalized) || normalized.includes(p.name.toLowerCase())
  ) || null;
}

export function isExplicitSuggestionMentioned(contextMessage: string, name: string): boolean {
  const messageLower = contextMessage.toLowerCase();
  const nameLower = name.trim().toLowerCase();
  if (!nameLower) return false;
  return messageLower.includes(nameLower);
}

export function pickLegacyContactForPlaceMode(
  contextMessage: string,
  suggestions: ChatSuggestion[]
): ChatSuggestion | null {
  const legacy = suggestions.filter((s) => s.source === "existing_contact");
  if (legacy.length === 0) return null;
  return legacy.find((s) => isExplicitSuggestionMentioned(contextMessage, s.name)) || legacy[0];
}
