import type { WebSearchApproximateLocation } from "@/lib/openai";

export type ChatSuggestion = {
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

export type AssistantResponse = {
  reply: string;
  suggestions: ChatSuggestion[];
  source: "openai" | "fallback";
  sourceReason: string | null;
};

export type Contact = {
  id: string;
  name: string;
  phone: string;
  notes: string;
  preferredLanguage: string;
};

export type SuggestionContext = {
  callReason: string;
  callPurpose: string;
  preferredLanguage: string;
  scheduledDate: string;
  scheduledTime: string;
};

export type ChatHistoryItem = {
  role: "assistant" | "user";
  text: string;
};

export type Plan = {
  reply: string;
  suggestions: ChatSuggestion[];
  source: "openai" | "fallback";
  sourceReason: string | null;
  serviceType: string;
  location: string;
  context: SuggestionContext;
};

export type OnlinePlaceResearch = {
  name: string;
  phone: string;
  address: string;
  city: string;
  reason: string;
  website: string | null;
};

export type OnlineWebsiteLead = {
  name: string;
  website: string;
  city: string;
  reason: string;
};

export type OnlineResearchDiagnostics = {
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

export type OnlineResearchResult = {
  suggestions: ChatSuggestion[];
  websiteLeads: OnlineWebsiteLead[];
  diagnostics: OnlineResearchDiagnostics;
  sourceUrls: string[];
};

export { type WebSearchApproximateLocation };
