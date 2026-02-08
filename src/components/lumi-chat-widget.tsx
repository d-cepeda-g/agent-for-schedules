"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  Bot,
  Loader2,
  MessageCircle,
  RefreshCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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

type AssistantApiResponse = {
  reply?: string;
  suggestions?: ChatSuggestion[];
  source?: "openai" | "fallback";
  sourceReason?: string | null;
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  suggestions?: ChatSuggestion[];
};

type CustomerLookup = {
  id: string;
  phone: string;
};

type ChatHistoryItem = {
  role: "assistant" | "user";
  text: string;
};

const INITIAL_MESSAGE: ChatMessage = {
  id: "assistant-welcome",
  role: "assistant",
  text:
    "Tell me the event or request and I will research the best contact to call. I can schedule the call for you immediately.",
};
const MAX_CONTEXT_HISTORY = 10;

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D+/g, "");
}

function toScheduledIso(dateOnly: string, timeOnly: string): string {
  const dateMatch = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeOnly.match(/^([01]\d|2[0-3]):([0-5]\d)$/);

  if (!dateMatch || !timeMatch) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 1);
    fallback.setHours(10, 0, 0, 0);
    return fallback.toISOString();
  }

  const [, yearText, monthText, dayText] = dateMatch;
  const [, hourText, minuteText] = timeMatch;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);

  const scheduled = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(scheduled.getTime())) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 1);
    fallback.setHours(10, 0, 0, 0);
    return fallback.toISOString();
  }

  return scheduled.toISOString();
}

function buildPrefillHref(suggestion: ChatSuggestion): string {
  const params = new URLSearchParams({
    callReason: suggestion.callReason,
    callPurpose: suggestion.callPurpose,
    notes: suggestion.notes,
    preferredLanguage: suggestion.preferredLanguage,
    date: suggestion.scheduledDate,
    time: suggestion.scheduledTime,
  });

  if (suggestion.customerId) {
    params.set("customerId", suggestion.customerId);
  }

  return `/schedule?${params.toString()}`;
}

function readErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "Unknown error";
  const record = payload as Record<string, unknown>;
  return typeof record.error === "string" && record.error
    ? record.error
    : "Unknown error";
}

export function LumiChatWidget() {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, isSending]);

  function appendAssistantMessage(text: string, suggestions?: ChatSuggestion[]) {
    setMessages((current) => [
      ...current,
      {
        id: makeId("assistant"),
        role: "assistant",
        text,
        suggestions,
      },
    ]);
  }

  function handleNewChat() {
    setRequestError(null);
    setDraft("");
    setMessages([INITIAL_MESSAGE]);
  }

  async function handleSubmit() {
    const trimmed = draft.trim();
    if (!trimmed || isSending) return;

    const history: ChatHistoryItem[] = messages
      .slice(-MAX_CONTEXT_HISTORY)
      .map((message) => ({
        role: message.role,
        text: message.text,
      }));

    setRequestError(null);
    setMessages((current) => [
      ...current,
      {
        id: makeId("user"),
        role: "user",
        text: trimmed,
      },
    ]);
    setDraft("");
    setIsSending(true);

    try {
      const response = await fetch("/api/ai/chat-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history }),
      });

      const payload = (await response.json().catch(() => null)) as
        | AssistantApiResponse
        | null;

      if (!response.ok) {
        throw new Error(readErrorMessage(payload));
      }

      const text =
        typeof payload?.reply === "string" && payload.reply.trim()
          ? payload.reply.trim()
          : "I reviewed your request and found contact options you can call now.";
      const suggestions = Array.isArray(payload?.suggestions)
        ? payload.suggestions
        : [];
      const sourceReason =
        typeof payload?.sourceReason === "string" && payload.sourceReason.trim()
          ? payload.sourceReason.trim()
          : null;

      appendAssistantMessage(
        sourceReason ? `${text}\n\nNote: ${sourceReason}` : text,
        suggestions
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to process request";
      setRequestError(message);
      appendAssistantMessage(
        "I could not complete research right now. You can still open Schedule and create a call manually."
      );
    } finally {
      setIsSending(false);
    }
  }

  async function ensureCustomerId(suggestion: ChatSuggestion): Promise<string> {
    if (suggestion.customerId) return suggestion.customerId;

    const normalizedPhone = normalizePhone(suggestion.phone);
    if (normalizedPhone) {
      const lookupResponse = await fetch(
        `/api/customers?q=${encodeURIComponent(suggestion.phone)}`
      );

      if (lookupResponse.ok) {
        const records = (await lookupResponse.json()) as CustomerLookup[];
        const exact = records.find(
          (customer) => normalizePhone(customer.phone) === normalizedPhone
        );
        if (exact?.id) {
          return exact.id;
        }
      }
    }

    const createResponse = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: suggestion.name,
        phone: suggestion.phone,
        email: "",
        notes: suggestion.notes,
        preferredLanguage: suggestion.preferredLanguage,
      }),
    });

    const createPayload = (await createResponse.json().catch(() => null)) as
      | Record<string, unknown>
      | null;

    if (!createResponse.ok) {
      throw new Error(readErrorMessage(createPayload));
    }

    const createdId =
      createPayload && typeof createPayload.id === "string"
        ? createPayload.id
        : "";

    if (!createdId) {
      throw new Error("Contact was created with an unexpected response");
    }

    return createdId;
  }

  async function handleScheduleSuggestion(suggestion: ChatSuggestion) {
    if (schedulingId) return;

    setRequestError(null);
    setSchedulingId(suggestion.id);

    try {
      const customerId = await ensureCustomerId(suggestion);
      const scheduledAt = toScheduledIso(
        suggestion.scheduledDate,
        suggestion.scheduledTime
      );

      const response = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          scheduledAt,
          callReason: suggestion.callReason,
          callPurpose: suggestion.callPurpose,
          preferredLanguage: suggestion.preferredLanguage,
          notes: suggestion.notes,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | Record<string, unknown>
        | null;

      if (!response.ok) {
        throw new Error(readErrorMessage(payload));
      }

      const createdCallId =
        payload && typeof payload.id === "string" ? payload.id : "";

      appendAssistantMessage(
        `Call scheduled with ${suggestion.name} for ${suggestion.scheduledDate} at ${suggestion.scheduledTime}.`
      );

      if (createdCallId) {
        router.push(`/calls/${createdCallId}`);
      } else {
        router.push(buildPrefillHref(suggestion));
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to schedule call";
      setRequestError(message);
      appendAssistantMessage(
        `I could not schedule ${suggestion.name} automatically. Use manual scheduling for this contact.`
      );
      router.push(buildPrefillHref(suggestion));
    } finally {
      setSchedulingId(null);
    }
  }

  function onComposerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handleSubmit();
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      <section
        className={cn(
          "pointer-events-auto flex h-[min(72vh,38rem)] w-[min(24rem,calc(100vw-1.25rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl transition-all duration-200",
          isOpen
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-4 opacity-0"
        )}
        aria-hidden={!isOpen}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Bot className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Lumi Assistant</p>
              <p className="truncate text-[11px] text-muted-foreground">
                Research contacts and schedule action calls
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={handleNewChat}
              aria-label="Start new chat"
            >
              <RefreshCcw className="h-3 w-3" />
              New chat
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setIsOpen(false)}
              aria-label="Close Lumi assistant"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
          {messages.map((message) => {
            const isUser = message.role === "user";

            return (
              <article
                key={message.id}
                className={cn("flex", isUser ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[88%] rounded-2xl px-3 py-2 text-sm shadow-xs",
                    isUser
                      ? "rounded-br-md bg-primary text-primary-foreground"
                      : "rounded-bl-md bg-secondary text-secondary-foreground"
                  )}
                >
                  <p className="whitespace-pre-wrap">{message.text}</p>

                  {message.suggestions && message.suggestions.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {message.suggestions.map((suggestion) => {
                        const isScheduling = schedulingId === suggestion.id;

                        return (
                          <div
                            key={suggestion.id}
                            className="rounded-lg border border-border/80 bg-background px-2.5 py-2 text-foreground"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-xs font-semibold">
                                {suggestion.name}
                              </p>
                              <Badge variant="outline" className="text-[10px]">
                                {suggestion.source === "existing_contact"
                                  ? "Existing"
                                  : "Research"}
                              </Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              {suggestion.phone}
                            </p>
                            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                              {suggestion.reason}
                            </p>
                            <div className="mt-2 flex items-center gap-1.5">
                              <Button
                                size="xs"
                                disabled={Boolean(schedulingId)}
                                onClick={() =>
                                  void handleScheduleSuggestion(suggestion)
                                }
                              >
                                {isScheduling ? (
                                  <>
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    Scheduling
                                  </>
                                ) : (
                                  "Schedule Call"
                                )}
                              </Button>
                              <Button asChild size="xs" variant="ghost">
                                <Link href={buildPrefillHref(suggestion)}>
                                  Edit
                                </Link>
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}

          {isSending ? (
            <article className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-secondary px-3 py-2 text-sm text-secondary-foreground shadow-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Researching contacts...
              </div>
            </article>
          ) : null}
        </div>

        <form onSubmit={onComposerSubmit} className="border-t border-border p-3">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onComposerKeyDown}
            rows={3}
            placeholder="Describe the event, what action to take, and any timing details..."
            className="min-h-[84px] resize-none"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              Shift+Enter for a new line
            </p>
            <Button type="submit" size="sm" disabled={!draft.trim() || isSending}>
              {isSending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send
                </>
              )}
            </Button>
          </div>
          {requestError ? (
            <p className="mt-2 text-xs text-destructive">{requestError}</p>
          ) : null}
        </form>
      </section>

      <Button
        type="button"
        className={cn(
          "pointer-events-auto h-14 w-14 rounded-full shadow-lg transition-all duration-200",
          isOpen ? "pointer-events-none scale-90 opacity-0" : "scale-100 opacity-100"
        )}
        onClick={() => setIsOpen(true)}
        aria-label="Open Lumi assistant"
      >
        <MessageCircle className="h-5 w-5" />
      </Button>

      {!isOpen ? (
        <div className="pointer-events-none flex items-center gap-1 rounded-full border border-border/80 bg-card px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
          <Sparkles className="h-3 w-3 text-primary" />
          Lumi
        </div>
      ) : null}
    </div>
  );
}
