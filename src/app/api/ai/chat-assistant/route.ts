import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createJsonCompletion, hasOpenAiApiKey } from "@/lib/openai";
import { type ProviderRecord, getProviderDirectory, searchProviders } from "@/lib/provider-directory";
import { isLikelyPhoneNumber } from "@/lib/validation";

import type {
  AssistantResponse,
  ChatHistoryItem,
  ChatSuggestion,
  Contact,
  Plan,
  SuggestionContext,
} from "@/lib/chat-assistant/types";

import {
  toRecord,
  normalizeText,
  normalizePhone,
  parseHistory,
  buildContextMessage,
  isDateOnly,
  isTimeOnly,
  formatDateOnly,
  parseDateOnly,
  parseEventDateFromText,
} from "@/lib/chat-assistant/parsing";

import {
  detectPreferredLanguage,
  detectServiceType,
  isVenueLikeRequest,
  resolveSearchLocation,
  tokenizeMessage,
  deriveSoonOutreachSlot,
} from "@/lib/chat-assistant/intent";

import {
  MAX_SUGGESTIONS,
  buildSuggestionFromContact,
  buildSuggestionFromProvider,
  buildAdHocSuggestion,
  dedupeSuggestions,
  rankSuggestions,
  scoreContact,
  buildCallReason,
  buildCallPurpose,
  buildReplyForSuggestionCount,
  ensureLocationMention,
  findContactByName,
  findProviderByName,
  pickLegacyContactForPlaceMode,
} from "@/lib/chat-assistant/suggestions";

import {
  createEmptyDiagnostics,
  researchPlacesOnline,
  buildResearchGapNote,
  buildWebSourceNote,
  buildWebsiteLeadsNote,
  logOnlineResearchDiagnostics,
} from "@/lib/chat-assistant/web-research";

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
    .map((c) => ({ contact: c, score: scoreContact(c, messageLower, terms, digits) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((e) => buildSuggestionFromContact(e.contact, context, "Existing contact likely related to this request."));

  const phoneToCustomer = new Map(contacts.map((c) => [normalizePhone(c.phone), c.id]));
  const shouldResearchProviders = !preferPlaces && (Boolean(serviceType) || Boolean(location) || contactSuggestions.length === 0);
  const providerSuggestions = shouldResearchProviders
    ? searchProviders({ serviceType: serviceType || undefined, locationQuery: location || undefined, minRating: 4.2, maxResults: MAX_SUGGESTIONS })
        .map((p) => buildSuggestionFromProvider(p, context, phoneToCustomer.get(normalizePhone(p.phone)) || null, `Strong match in ${p.city} (${p.rating.toFixed(1)} stars).`))
    : [];

  let suggestions = dedupeSuggestions([...contactSuggestions, ...providerSuggestions]).slice(0, MAX_SUGGESTIONS);
  if (!preferPlaces && suggestions.length === 0 && contacts.length > 0) {
    suggestions = [buildSuggestionFromContact(contacts[0], context, "Most recent contact available to call right away.")];
  }

  return {
    reply: buildReplyForSuggestionCount(suggestions.length, preferPlaces, location),
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
  const phoneToContact = new Map(contacts.map((c) => [normalizePhone(c.phone), c]));
  const phoneToProvider = new Map(providers.map((p) => [normalizePhone(p.phone), p]));

  const systemPrompt = [
    "You are Lumi, an operations scheduler assistant.",
    "Choose the best people or businesses to contact based on the user request.",
    preferPlaces
      ? "This request is place/venue-oriented. Include at least 2 place suggestions with callable phone numbers."
      : "If this request is place/venue-oriented, include at least 2 place suggestions.",
    "Outreach calls must be scheduled ASAP and before the event date.",
    'Return strict JSON: { "reply": string, "call_reason": string, "call_purpose": string, "preferred_language": string, "scheduled_date": "YYYY-MM-DD", "scheduled_time": "HH:mm", "service_type": string, "location": string, "suggestions": [{ "name": string, "phone": string, "reason": string, "source": "existing_contact" | "researched_provider", "customer_id": string }] }',
    `Limit suggestions to ${MAX_SUGGESTIONS}.`,
  ].join("\n");

  const historyBlock = history.length > 0
    ? history.map((e) => `${e.role === "user" ? "User" : "Assistant"}: ${e.text}`).join("\n")
    : "No previous turns.";

  const userPrompt = [
    "Conversation history:", historyBlock, "",
    `Latest user request: ${message}`, `Prefer place-first suggestions: ${preferPlaces ? "yes" : "no"}`, "",
    `Default scheduled date: ${fallback.context.scheduledDate}`,
    `Default scheduled time: ${fallback.context.scheduledTime}`,
    `Default language: ${fallback.context.preferredLanguage}`, "",
    "Existing contacts JSON:",
    JSON.stringify(contacts.slice(0, 40).map((c) => ({ id: c.id, name: c.name, phone: c.phone, notes: c.notes, preferredLanguage: c.preferredLanguage }))),
    "", "Provider directory JSON:",
    JSON.stringify(providersForPrompt.map((p) => ({ id: p.id, name: p.name, phone: p.phone, city: p.city, address: p.address, rating: p.rating, reviewCount: p.reviewCount, serviceTypes: p.serviceTypes }))),
  ].join("\n");

  const completion = await createJsonCompletion({ systemPrompt, userPrompt, temperature: 0.2, maxTokens: 900 });
  const payload = toRecord(completion);
  if (!payload) throw new Error("OpenAI did not return a JSON object");

  const callReason = normalizeText(payload.call_reason, fallback.context.callReason);
  const callPurpose = normalizeText(payload.call_purpose, fallback.context.callPurpose);
  const preferredLanguage = normalizeText(payload.preferred_language, fallback.context.preferredLanguage);

  const modelDateRaw = normalizeText(payload.scheduled_date, fallback.context.scheduledDate);
  const modelTimeRaw = normalizeText(payload.scheduled_time, fallback.context.scheduledTime);
  const modelDate = isDateOnly(modelDateRaw) ? parseDateOnly(modelDateRaw) : null;
  const modelTime = isTimeOnly(modelTimeRaw) ? modelTimeRaw : null;

  const combinedSource = [contextMessage, callReason, callPurpose, modelDate ? formatDateOnly(modelDate) : "", modelTime || ""].filter(Boolean).join("\n");
  const finalEventDate = eventDate || parseEventDateFromText(combinedSource);
  const scheduleSlot = deriveSoonOutreachSlot(finalEventDate);

  const context: SuggestionContext = { callReason, callPurpose, preferredLanguage, scheduledDate: scheduleSlot.scheduledDate, scheduledTime: scheduleSlot.scheduledTime };
  const serviceType = normalizeText(payload.service_type, fallback.serviceType);
  const location = normalizeText(payload.location, fallback.location);

  const suggestionsRaw = Array.isArray(payload.suggestions) ? payload.suggestions : [];
  const openAiSuggestions: ChatSuggestion[] = [];

  for (const candidate of suggestionsRaw) {
    const record = toRecord(candidate);
    if (!record) continue;
    const name = normalizeText(record.name);
    const phone = normalizeText(record.phone);
    const reason = normalizeText(record.reason, "High-confidence contact match.");
    const explicitCustId = normalizeText(record.customer_id) || null;

    let matched: Contact | null = null;
    if (explicitCustId) matched = contacts.find((c) => c.id === explicitCustId) || null;
    if (!matched && phone) matched = phoneToContact.get(normalizePhone(phone)) || null;
    if (!matched && name) matched = findContactByName(contacts, name);
    if (matched) { openAiSuggestions.push(buildSuggestionFromContact(matched, context, reason)); continue; }

    let matchedProvider: ProviderRecord | null = null;
    if (!preferPlaces) {
      if (phone) matchedProvider = phoneToProvider.get(normalizePhone(phone)) || null;
      if (!matchedProvider && name) matchedProvider = findProviderByName(providers, name);
    }
    if (matchedProvider) {
      const custId = phoneToContact.get(normalizePhone(matchedProvider.phone))?.id || null;
      openAiSuggestions.push(buildSuggestionFromProvider(matchedProvider, context, custId, reason));
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
      const researched = searchProviders({ serviceType: serviceType || undefined, locationQuery: location || undefined, minRating: 4.2, maxResults: MAX_SUGGESTIONS })
        .map((p) => { const cid = phoneToContact.get(normalizePhone(p.phone))?.id || null; return buildSuggestionFromProvider(p, context, cid, `Good match in ${p.city}.`); });
      suggestions = rankSuggestions([...researched, ...fallback.suggestions], false);
    }
  }

  return {
    reply: ensureLocationMention(normalizeText(payload.reply, fallback.reply), fallback.location, preferPlaces),
    suggestions, source: "openai", sourceReason: null, serviceType, location, context,
  };
}

function toAssistantResponse(plan: Plan): AssistantResponse {
  return { reply: plan.reply, suggestions: plan.suggestions, source: plan.source, sourceReason: plan.sourceReason };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "Unknown error";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const message = normalizeText(body.message);
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

  const history = parseHistory(body.history);
  const contextMessage = buildContextMessage(message, history);
  const eventDate = parseEventDateFromText(message) || parseEventDateFromText(contextMessage);
  const preferPlaces = isVenueLikeRequest(contextMessage);
  const searchLocation = resolveSearchLocation(message, contextMessage, preferPlaces);

  const contactRows = await db.customer.findMany({
    orderBy: { updatedAt: "desc" }, take: 120,
    select: { id: true, name: true, phone: true, notes: true, preferredLanguage: true },
  });
  const contacts: Contact[] = contactRows.map((c) => ({
    id: c.id, name: c.name, phone: c.phone, notes: c.notes || "", preferredLanguage: c.preferredLanguage || "English",
  }));

  const fallbackPlanBase = buildFallbackPlan(message, contextMessage, eventDate, preferPlaces, searchLocation, contacts);
  const contactPhones = new Set<string>(contacts.map((c: Contact) => normalizePhone(c.phone)).filter(Boolean));

  let onlineResult = { suggestions: [] as ChatSuggestion[], websiteLeads: [] as { name: string; website: string; city: string; reason: string }[], diagnostics: createEmptyDiagnostics(), sourceUrls: [] as string[] };
  let onlineError: string | null = null;

  if (hasOpenAiApiKey()) {
    try {
      onlineResult = await researchPlacesOnline({
        message: contextMessage, serviceType: fallbackPlanBase.serviceType,
        location: fallbackPlanBase.location, preferPlaces,
        context: fallbackPlanBase.context, existingPhones: contactPhones,
      });
    } catch (error) {
      onlineResult = { suggestions: [], websiteLeads: [], diagnostics: createEmptyDiagnostics(), sourceUrls: [] };
      onlineError = toErrorMessage(error);
    }
  }

  const onlineSuggestions = onlineResult.suggestions;
  const webSourceNote = buildWebSourceNote(onlineResult.sourceUrls);
  const websiteLeadsNote = onlineSuggestions.length === 0 ? buildWebsiteLeadsNote(onlineResult.websiteLeads) : null;

  logOnlineResearchDiagnostics({
    preferPlaces, location: fallbackPlanBase.location,
    diagnostics: onlineResult.diagnostics, sourceUrls: onlineResult.sourceUrls, error: onlineError,
  });

  const legacyContact = pickLegacyContactForPlaceMode(contextMessage, fallbackPlanBase.suggestions);
  const fallbackCandidates = preferPlaces
    ? onlineSuggestions.length > 0
      ? [...onlineSuggestions.slice(0, Math.max(1, MAX_SUGGESTIONS - (legacyContact ? 1 : 0))), ...(legacyContact ? [legacyContact] : [])]
      : legacyContact ? [legacyContact] : []
    : [...fallbackPlanBase.suggestions, ...onlineSuggestions];
  const fallbackSuggestions = rankSuggestions(fallbackCandidates, preferPlaces);

  const fallbackPlan: Plan = {
    ...fallbackPlanBase,
    reply: buildReplyForSuggestionCount(fallbackSuggestions.length, preferPlaces, fallbackPlanBase.location),
    suggestions: fallbackSuggestions,
    sourceReason: preferPlaces && onlineSuggestions.length === 0
      ? onlineError
        ? [`Live web place research failed (${onlineError}). Showing best available options.`, webSourceNote].filter(Boolean).join(" ")
        : ["Live web place research returned no callable venues.", buildResearchGapNote(onlineResult.diagnostics), websiteLeadsNote, webSourceNote].filter(Boolean).join(" ")
      : onlineError
        ? [`Live web place research failed (${onlineError}).`, webSourceNote].filter(Boolean).join(" ")
        : null,
  };

  if (!hasOpenAiApiKey()) {
    return NextResponse.json(toAssistantResponse({ ...fallbackPlan, source: "fallback", sourceReason: "OpenAI API key not configured" }));
  }

  if (preferPlaces) {
    return NextResponse.json(toAssistantResponse({ ...fallbackPlan, source: onlineSuggestions.length > 0 ? "openai" : "fallback" }));
  }

  try {
    const openAiPlan = await buildOpenAiPlan(message, history, contextMessage, eventDate, preferPlaces, contacts, fallbackPlan);
    const merged = rankSuggestions([...openAiPlan.suggestions, ...fallbackPlan.suggestions], false);
    return NextResponse.json(toAssistantResponse({ ...openAiPlan, suggestions: merged, source: "openai", sourceReason: fallbackPlan.sourceReason }));
  } catch (error) {
    const reason = error instanceof Error
      ? `OpenAI request failed. Using fallback. (${error.message})`
      : "OpenAI request failed. Using fallback.";
    return NextResponse.json(toAssistantResponse({ ...fallbackPlan, source: "fallback", sourceReason: reason }));
  }
}
