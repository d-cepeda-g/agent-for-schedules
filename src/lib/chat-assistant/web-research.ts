import {
  createJsonCompletion,
  createWebSearchTextCompletionWithMetadata,
  hasOpenAiApiKey,
} from "@/lib/openai";
import { isLikelyPhoneNumber, toCallablePhoneNumber } from "@/lib/validation";
import type {
  OnlinePlaceResearch,
  OnlineWebsiteLead,
  OnlineResearchDiagnostics,
  OnlineResearchResult,
  SuggestionContext,
} from "./types";
import { toRecord, normalizeText, normalizePhone } from "./parsing";
import { toWebSearchUserLocation } from "./intent";
import { buildAdHocSuggestion, dedupeSuggestions, MAX_SUGGESTIONS } from "./suggestions";

const MAX_ONLINE_RESEARCH_RESULTS = 6;
const MAX_WEB_RESEARCH_TEXT_CHARS = 12000;
const MAX_WEB_SOURCE_URLS_IN_NOTE = 3;
const MAX_PHONE_RECOVERY_LEADS = 4;

export function createEmptyDiagnostics(): OnlineResearchDiagnostics {
  return {
    parsedEntries: 0, acceptedCallable: 0, missingAddress: 0, missingName: 0,
    missingPhone: 0, invalidPhone: 0, recoveredPhone: 0, websiteOnlyLeads: 0,
    duplicateWithContacts: 0, locationFilteredOut: 0, finalSuggestions: 0,
    usedWebSearch: false, sourceUrlCount: 0,
  };
}

function extractOnlineResearchCandidates(raw: unknown): {
  callablePlaces: OnlinePlaceResearch[];
  websiteLeads: OnlineWebsiteLead[];
  diagnostics: OnlineResearchDiagnostics;
} {
  const diagnostics = createEmptyDiagnostics();
  const record = toRecord(raw);
  if (!record) return { callablePlaces: [], websiteLeads: [], diagnostics };

  const entries = Array.isArray(record.places) ? record.places : [];
  diagnostics.parsedEntries = entries.length;
  const callablePlaces: OnlinePlaceResearch[] = [];
  const websiteLeads: OnlineWebsiteLead[] = [];

  for (const item of entries) {
    const pr = toRecord(item);
    if (!pr) continue;
    const name = normalizeText(pr.name);
    if (!name) { diagnostics.missingName += 1; continue; }
    const address = normalizeText(pr.address);
    const city = normalizeText(pr.city);
    const reason = normalizeText(pr.reason, "Online match for this request.");
    const websiteRaw = normalizeText(pr.website);
    const website = websiteRaw || null;
    const rawPhone = normalizeText(pr.phone);
    if (!rawPhone) {
      diagnostics.missingPhone += 1;
      if (website) { websiteLeads.push({ name, website, city, reason }); diagnostics.websiteOnlyLeads += 1; }
      continue;
    }
    let phone = rawPhone;
    if (!isLikelyPhoneNumber(phone)) {
      const norm = toCallablePhoneNumber(phone);
      if (norm && isLikelyPhoneNumber(norm)) { phone = norm; diagnostics.recoveredPhone += 1; }
      else {
        diagnostics.invalidPhone += 1;
        if (website) { websiteLeads.push({ name, website, city, reason }); diagnostics.websiteOnlyLeads += 1; }
        continue;
      }
    }
    callablePlaces.push({ name, phone, address, city, reason, website });
  }

  diagnostics.acceptedCallable = callablePlaces.length;
  return { callablePlaces, websiteLeads, diagnostics };
}

function buildOnlineResearchPrompt(
  message: string, serviceType: string, location: string, preferPlaces: boolean
): { systemPrompt: string; userPrompt: string } {
  const todayIso = new Date().toISOString().slice(0, 10);
  const inferredService = serviceType || "requested event/location";
  const inferredLocation = location || "the location implied by the request";
  const systemPrompt = [
    "You are Lumi, researching real businesses on the public web.",
    "Use web search deeply to find currently operating businesses that match the request.",
    "Focus on venues and bars/restaurants where applicable.",
    "CRITICAL: Every result MUST include a callable phone number. This is the highest priority.",
    "Search specifically on Google Maps, Yelp, TripAdvisor, Yellow Pages, and official business pages to find phone numbers.",
    "If an event-listing site does not show a phone, search the venue name + city + 'phone number' or 'Telefon' separately.",
    "For German venues, look for 'Impressum' or 'Kontakt' pages which usually contain phone numbers.",
    preferPlaces ? "Return venues/business places only. Do not return individual personal contacts." : "Prefer venues/business places when the request mentions location, reservation, bars, restaurants, or events.",
    "If the target city is provided, exclude places outside that city.",
    "Do not fabricate names, phones, websites, or addresses.",
    "Return concise place research notes including name, phone, city, address, website, and one short reason.",
    `Return at most ${MAX_ONLINE_RESEARCH_RESULTS} places and prefer official business listings.`,
  ].join("\n");
  const userPrompt = [
    `Today is ${todayIso}.`, `User request: ${message}`, `Service intent: ${inferredService}`,
    `Target location: ${inferredLocation}`, `Place-first mode: ${preferPlaces ? "yes" : "no"}`,
    `Use this location for venue search: ${inferredLocation}.`,
    "Required fields: name, full address, city, callable phone number, and reason.",
    "IMPORTANT: For EACH venue, do a separate search for its phone number if not immediately found.",
  ].join("\n");
  return { systemPrompt, userPrompt };
}

function buildDeepVenueResearchPrompt(
  message: string, serviceType: string, location: string
): { systemPrompt: string; userPrompt: string } {
  const inferredService = serviceType || "bars, restaurants, or event venues";
  const inferredLocation = location || "Munich";
  const systemPrompt = [
    "You are a venue researcher specializing in finding business contact information.",
    "Use web search deeply and run multiple query variants before answering.",
    "Primary goal: return real venues with BOTH full address and callable phone number.",
    "PHONE NUMBER STRATEGY:",
    "1. Search Google Maps for the venue.", "2. Search '<venue name> <city> phone'.",
    "3. Check the venue's own website, especially Impressum/Kontakt pages.",
    "4. Try Yelp, TripAdvisor, or Yellow Pages.",
    "Focus on bars, clubs, restaurants, and event venues in the target city.",
    "Do not return people/personal contacts.", "Do not fabricate names, addresses, phones, or websites.",
    `Return at most ${MAX_ONLINE_RESEARCH_RESULTS} places.`,
  ].join("\n");
  const userPrompt = [
    `Original request: ${message}`, `Service intent: ${inferredService}`, `Target location: ${inferredLocation}`,
    "Required per place: name, full address, city, callable phone number, short reason, website if available.",
    "Only return venues where you found a real phone number.",
  ].join("\n");
  return { systemPrompt, userPrompt };
}

function buildWebResearchNormalizationPrompt(input: {
  rawWebText: string; serviceType: string; location: string; preferPlaces: boolean;
}): { systemPrompt: string; userPrompt: string } {
  const inferredService = input.serviceType || "requested event/location";
  const inferredLocation = input.location || "the location implied by the request";
  const rawText = input.rawWebText.length > MAX_WEB_RESEARCH_TEXT_CHARS
    ? input.rawWebText.slice(0, MAX_WEB_RESEARCH_TEXT_CHARS)
    : input.rawWebText;
  const systemPrompt = [
    "You normalize web research notes into strict JSON.",
    "Use only places that are explicitly present in the source text.",
    "Never invent businesses, phones, websites, addresses, or cities.",
    "PHONE EXTRACTION RULES:",
    "- Extract phone numbers in ANY format.", "- Look for patterns like 'Tel:', 'Telefon:', 'Phone:'.",
    "- German numbers may start with +49, 0049, or local area codes.",
    "- Preserve the full phone number including country code when available.",
    "If phone is truly not present, set phone to an empty string.",
    input.preferPlaces ? "Only include venue-like businesses." : "Prefer venue-like businesses when possible.",
    input.location ? "If a place is clearly outside the target location, exclude it." : "If location is uncertain, keep only clearly relevant entries.",
    'Return strict JSON: { "places": [{ "name": string, "phone": string, "address": string, "city": string, "reason": string, "website": string }] }',
  ].join("\n");
  const userPrompt = [
    `Service intent: ${inferredService}`, `Target location: ${inferredLocation}`,
    `Place-first mode: ${input.preferPlaces ? "yes" : "no"}`, "Source web research text:", rawText,
  ].join("\n");
  return { systemPrompt, userPrompt };
}

async function recoverPhonesForLeads(
  leads: OnlineWebsiteLead[], location: string
): Promise<OnlinePlaceResearch[]> {
  if (leads.length === 0) return [];
  const venueList = leads.map((l, i) => `${i + 1}. ${l.name} (${l.website})`).join("\n");
  const systemPrompt = [
    "You are a phone number researcher. Your ONLY job is to find callable phone numbers for the listed venues.",
    "Search Google Maps, Yelp, TripAdvisor, Yellow Pages, and each venue's own website.",
    'Return strict JSON: { "results": [{ "name": string, "phone": string, "address": string }] }',
    "Do not fabricate phone numbers.",
  ].join("\n");
  const userPrompt = [
    `Find phone numbers for these venues in ${location || "the relevant city"}:`, venueList,
    "Return only venues where you found a real phone number.",
  ].join("\n");

  try {
    const result = await createWebSearchTextCompletionWithMetadata({
      systemPrompt, userPrompt, temperature: 0, maxTokens: 5000,
      searchContextSize: "high", userLocation: toWebSearchUserLocation(location), includeSources: false,
    });
    const jsonPayload = await createJsonCompletion({
      systemPrompt: 'Extract the JSON from the text. Return strict JSON: { "results": [{ "name": string, "phone": string, "address": string }] }. Never invent data.',
      userPrompt: result.text, temperature: 0, maxTokens: 5000,
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
        const norm = toCallablePhoneNumber(phone);
        if (!norm || !isLikelyPhoneNumber(norm)) continue;
        phone = norm;
      }
      const matchedLead = leads.find((l) => l.name.toLowerCase() === name.toLowerCase())
        || leads.find((l) => l.name.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(l.name.toLowerCase()));
      recovered.push({
        name, phone, address: normalizeText(rec.address) || matchedLead?.city || "",
        city: matchedLead?.city || "", reason: matchedLead?.reason || "Phone recovered via targeted search.",
        website: matchedLead?.website || null,
      });
    }
    return recovered;
  } catch {
    return [];
  }
}

async function runOnlineResearchAttempt(input: {
  message: string; serviceType: string; location: string; preferPlaces: boolean;
  context: SuggestionContext; existingPhones: Set<string>;
  systemPrompt: string; userPrompt: string;
}): Promise<OnlineResearchResult> {
  const webSearchResult = await createWebSearchTextCompletionWithMetadata({
    systemPrompt: input.systemPrompt, userPrompt: input.userPrompt, temperature: 0.1,
    maxTokens: 5000, searchContextSize: "high",
    userLocation: toWebSearchUserLocation(input.location), includeSources: true,
  });

  const { systemPrompt: ns, userPrompt: nu } = buildWebResearchNormalizationPrompt({
    rawWebText: webSearchResult.text, serviceType: input.serviceType,
    location: input.location, preferPlaces: input.preferPlaces,
  });
  const normalizedPayload = await createJsonCompletion({ systemPrompt: ns, userPrompt: nu, temperature: 0, maxTokens: 5000 });
  const normalized = extractOnlineResearchCandidates(normalizedPayload);
  const diagnostics = normalized.diagnostics;
  diagnostics.usedWebSearch = webSearchResult.usedWebSearch;
  diagnostics.sourceUrlCount = webSearchResult.sourceUrls.length;

  if (normalized.callablePlaces.length === 0 && normalized.websiteLeads.length > 0 && input.preferPlaces) {
    const recovered = await recoverPhonesForLeads(normalized.websiteLeads.slice(0, MAX_PHONE_RECOVERY_LEADS), input.location);
    for (const place of recovered) { normalized.callablePlaces.push(place); diagnostics.recoveredPhone += 1; }
  }

  let places = normalized.callablePlaces;
  let websiteLeads = normalized.websiteLeads;
  if (input.preferPlaces) {
    const withAddr = places.filter((p) => Boolean(p.address.trim()));
    diagnostics.missingAddress += Math.max(0, places.length - withAddr.length);
    places = withAddr;
  }
  if (input.preferPlaces && input.location.trim()) {
    const needle = input.location.trim().toLowerCase();
    const match = places.filter((p) => [p.name, p.address, p.city, p.reason].join(" ").toLowerCase().includes(needle));
    if (match.length > 0) { diagnostics.locationFilteredOut += Math.max(0, places.length - match.length); places = match; }
    const matchLeads = websiteLeads.filter((l) => [l.name, l.city, l.reason, l.website].join(" ").toLowerCase().includes(needle));
    if (matchLeads.length > 0) { diagnostics.locationFilteredOut += Math.max(0, websiteLeads.length - matchLeads.length); websiteLeads = matchLeads; }
  }

  const callablePlaces = places.filter((p) => !input.existingPhones.has(normalizePhone(p.phone))).slice(0, MAX_ONLINE_RESEARCH_RESULTS);
  diagnostics.duplicateWithContacts = Math.max(0, places.length - callablePlaces.length);

  const suggestions = callablePlaces.map((p) =>
    buildAdHocSuggestion(p.name, p.phone, input.context, p.reason,
      [p.address ? `Address: ${p.address}` : "", p.city ? `City: ${p.city}` : "", p.website ? `Website: ${p.website}` : "", "Source: live web research"].filter(Boolean).join("\n"))
  );
  const rankedSuggestions = dedupeSuggestions(suggestions).slice(0, MAX_SUGGESTIONS);
  diagnostics.finalSuggestions = rankedSuggestions.length;

  return { suggestions: rankedSuggestions, websiteLeads, diagnostics, sourceUrls: webSearchResult.sourceUrls };
}

function mergeUniqueStrings(values: string[][]): string[] {
  const merged: string[] = [];
  for (const list of values) for (const v of list) { if (!v || merged.includes(v)) continue; merged.push(v); }
  return merged;
}

function mergeDiagnostics(left: OnlineResearchDiagnostics, right: OnlineResearchDiagnostics): OnlineResearchDiagnostics {
  return {
    parsedEntries: left.parsedEntries + right.parsedEntries,
    acceptedCallable: left.acceptedCallable + right.acceptedCallable,
    missingAddress: left.missingAddress + right.missingAddress,
    missingName: left.missingName + right.missingName,
    missingPhone: left.missingPhone + right.missingPhone,
    invalidPhone: left.invalidPhone + right.invalidPhone,
    recoveredPhone: left.recoveredPhone + right.recoveredPhone,
    websiteOnlyLeads: left.websiteOnlyLeads + right.websiteOnlyLeads,
    duplicateWithContacts: left.duplicateWithContacts + right.duplicateWithContacts,
    locationFilteredOut: left.locationFilteredOut + right.locationFilteredOut,
    finalSuggestions: left.finalSuggestions + right.finalSuggestions,
    usedWebSearch: left.usedWebSearch || right.usedWebSearch,
    sourceUrlCount: left.sourceUrlCount + right.sourceUrlCount,
  };
}

export async function researchPlacesOnline(input: {
  message: string; serviceType: string; location: string; preferPlaces: boolean;
  context: SuggestionContext; existingPhones: Set<string>;
}): Promise<OnlineResearchResult> {
  if (!hasOpenAiApiKey()) return { suggestions: [], websiteLeads: [], diagnostics: createEmptyDiagnostics(), sourceUrls: [] };

  const basePrompt = buildOnlineResearchPrompt(input.message, input.serviceType, input.location, input.preferPlaces);
  const firstAttempt = await runOnlineResearchAttempt({ ...input, systemPrompt: basePrompt.systemPrompt, userPrompt: basePrompt.userPrompt });
  if (!input.preferPlaces || firstAttempt.suggestions.length >= 2) return firstAttempt;

  const deepPrompt = buildDeepVenueResearchPrompt(input.message, input.serviceType, input.location);
  const secondAttempt = await runOnlineResearchAttempt({ ...input, systemPrompt: deepPrompt.systemPrompt, userPrompt: deepPrompt.userPrompt });
  const mergedSuggestions = dedupeSuggestions([...firstAttempt.suggestions, ...secondAttempt.suggestions]).slice(0, MAX_SUGGESTIONS);

  return {
    suggestions: mergedSuggestions,
    websiteLeads: [...firstAttempt.websiteLeads, ...secondAttempt.websiteLeads],
    diagnostics: { ...mergeDiagnostics(firstAttempt.diagnostics, secondAttempt.diagnostics), finalSuggestions: mergedSuggestions.length, sourceUrlCount: mergeUniqueStrings([firstAttempt.sourceUrls, secondAttempt.sourceUrls]).length },
    sourceUrls: mergeUniqueStrings([firstAttempt.sourceUrls, secondAttempt.sourceUrls]),
  };
}

export function buildResearchGapNote(diagnostics: OnlineResearchDiagnostics): string {
  const parts: string[] = [];
  if (diagnostics.parsedEntries > 0 && diagnostics.acceptedCallable === 0) {
    parts.push(`Found ${diagnostics.parsedEntries} venue${diagnostics.parsedEntries > 1 ? "s" : ""} but none had a reachable phone number.`);
  } else if (diagnostics.parsedEntries > 0) {
    parts.push(`Found ${diagnostics.parsedEntries} venue${diagnostics.parsedEntries > 1 ? "s" : ""}, ${diagnostics.acceptedCallable} with phone numbers.`);
  }
  if (diagnostics.recoveredPhone > 0) {
    parts.push(`Recovered ${diagnostics.recoveredPhone} phone number${diagnostics.recoveredPhone > 1 ? "s" : ""} via targeted search.`);
  }
  return parts.join(" ") || "No venues found in web search.";
}

export function buildWebSourceNote(sourceUrls: string[]): string | null {
  const hosts: string[] = [];
  for (const url of sourceUrls) {
    try { const host = new URL(url).host; if (!host || hosts.includes(host)) continue; hosts.push(host); } catch { continue; }
  }
  const limited = hosts.slice(0, MAX_WEB_SOURCE_URLS_IN_NOTE);
  if (limited.length === 0) return null;
  return `Web sources checked: ${limited.join(", ")}.`;
}

export function buildWebsiteLeadsNote(leads: OnlineWebsiteLead[]): string | null {
  if (leads.length === 0) return null;
  if (leads.length === 1) {
    const lead = leads[0];
    const city = lead.city ? ` in ${lead.city}` : "";
    return `No callable phone was found, but one lead${city}: ${lead.name} (${lead.website}).`;
  }
  const lines = leads.slice(0, 5).map((l) => { const c = l.city ? ` in ${l.city}` : ""; return `${l.name}${c} (${l.website})`; });
  return `No callable phones found, but ${leads.length} website leads: ${lines.join("; ")}.`;
}

export function logOnlineResearchDiagnostics(input: {
  preferPlaces: boolean; location: string; diagnostics: OnlineResearchDiagnostics;
  sourceUrls: string[]; error: string | null;
}): void {
  console.info("[lumi:web-place-research]", {
    preferPlaces: input.preferPlaces, location: input.location,
    diagnostics: input.diagnostics, sourceUrls: input.sourceUrls.slice(0, 10), error: input.error,
  });
}
