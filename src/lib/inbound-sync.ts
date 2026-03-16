import { db } from "@/lib/db";
import type { ConversationDetail } from "@/lib/elevenlabs";

type InboundSyncParams = {
  conversationId: string;
  callerPhone: string;
  detail: ConversationDetail;
};

type ActionItemSeed = {
  title: string;
  detail: string;
};

const NON_ACTIONABLE_VALUES = new Set([
  "n/a",
  "na",
  "none",
  "null",
  "unknown",
  "not provided",
  "not mentioned",
  "not applicable",
]);

function toDisplayLabel(key: string): string {
  return key
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((entry) => stringifyValue(entry)).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("value" in record) return stringifyValue(record.value);
    try {
      return JSON.stringify(record);
    } catch {
      return "";
    }
  }
  return "";
}

function formatTranscript(detail: ConversationDetail): string {
  if (!Array.isArray(detail.transcript)) return "";
  return detail.transcript
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const role = typeof entry.role === "string" ? entry.role : "unknown";
      const message = typeof entry.message === "string" ? entry.message.trim() : "";
      if (!message) return "";
      return `${role}: ${message}`;
    })
    .filter(Boolean)
    .join("\n");
}

function getActionItems(detail: ConversationDetail): ActionItemSeed[] {
  const collected = detail.analysis?.data_collection_results;
  if (!collected || typeof collected !== "object") return [];

  const items: ActionItemSeed[] = [];
  for (const [key, rawValue] of Object.entries(collected)) {
    const normalized = stringifyValue(rawValue).trim();
    if (!normalized || NON_ACTIONABLE_VALUES.has(normalized.toLowerCase())) continue;
    items.push({ title: toDisplayLabel(key), detail: normalized });
  }
  return items;
}

function getEvaluationResult(detail: ConversationDetail): {
  result: string;
  rationale: string;
} {
  const criteria = detail.analysis?.evaluation_criteria_results || {};
  const first = Object.values(criteria)[0] as
    | { result?: unknown; rationale?: unknown }
    | undefined;

  return {
    result: typeof first?.result === "string" ? first.result : "unknown",
    rationale: typeof first?.rationale === "string" ? first.rationale : "",
  };
}

function detectSentiment(detail: ConversationDetail): string {
  const { result } = getEvaluationResult(detail);
  if (result === "success") return "positive";
  if (result === "failure") return "negative";
  return "neutral";
}

function detectIntent(detail: ConversationDetail): string {
  const collected = detail.analysis?.data_collection_results;
  if (!collected || typeof collected !== "object") return "";

  for (const key of Object.keys(collected)) {
    const lower = key.toLowerCase();
    if (lower.includes("intent") || lower.includes("purpose") || lower.includes("reason")) {
      const val = stringifyValue(collected[key]).trim();
      if (val && !NON_ACTIONABLE_VALUES.has(val.toLowerCase())) return val;
    }
  }
  return "";
}

function buildSummary(detail: ConversationDetail): string {
  const { rationale } = getEvaluationResult(detail);
  if (rationale) return rationale;

  if (Array.isArray(detail.transcript) && detail.transcript.length > 0) {
    const firstAgent = detail.transcript.find(
      (t) => t.role === "agent" && t.message?.trim()
    );
    if (firstAgent) return firstAgent.message.trim().slice(0, 200);
  }

  return "";
}

function getCallStatus(detailStatus: string): string {
  if (detailStatus === "done") return "completed";
  if (detailStatus === "failed") return "failed";
  return "active";
}

export async function syncInboundCall({
  conversationId,
  callerPhone,
  detail,
}: InboundSyncParams) {
  const transcript = formatTranscript(detail);
  const duration =
    typeof detail.metadata?.call_duration_secs === "number"
      ? detail.metadata.call_duration_secs
      : 0;
  const status = getCallStatus(detail.status);
  const sentiment = detectSentiment(detail);
  const intent = detectIntent(detail);
  const summary = buildSummary(detail);
  const actionItems = getActionItems(detail);
  const { result } = getEvaluationResult(detail);
  const followUpNeeded = result === "failure" || actionItems.length > 0;

  // Try to match caller to existing customer
  const customer = await db.customer.findUnique({
    where: { phone: callerPhone },
    select: { id: true },
  });

  return db.$transaction(async (tx) => {
    const inboundCall = await tx.inboundCall.upsert({
      where: { conversationId },
      update: {
        status,
        intent,
        summary,
        transcript,
        duration,
        sentiment,
        followUpNeeded,
        customerId: customer?.id ?? null,
      },
      create: {
        conversationId,
        callerPhone,
        customerId: customer?.id ?? null,
        status,
        intent,
        summary,
        transcript,
        duration,
        sentiment,
        followUpNeeded,
      },
    });

    // Replace action items on each sync
    await tx.inboundCallActionItem.deleteMany({
      where: { inboundCallId: inboundCall.id },
    });

    if (actionItems.length > 0) {
      await tx.inboundCallActionItem.createMany({
        data: actionItems.map((item) => ({
          inboundCallId: inboundCall.id,
          title: item.title,
          detail: item.detail,
        })),
      });
    }

    return {
      inboundCall,
      actionItemsCount: actionItems.length,
      status,
      isNewCustomer: !customer,
    };
  });
}
