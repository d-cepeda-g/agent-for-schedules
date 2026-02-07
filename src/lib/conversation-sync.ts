import { db } from "@/lib/db";
import type { ConversationDetail } from "@/lib/elevenlabs";
import { isEvaluationResult } from "@/lib/validation";

type SyncConversationParams = {
  scheduledCallId: string;
  conversationId: string;
  currentStatus: string;
  detail: ConversationDetail;
};

type ActionItemSeed = {
  source: string;
  key: string;
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
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => stringifyValue(entry)).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("value" in record) {
      return stringifyValue(record.value);
    }
    try {
      return JSON.stringify(record);
    } catch {
      return "";
    }
  }
  return "";
}

function normalizeActionItemValue(value: unknown): string | null {
  const normalized = stringifyValue(value).trim();
  if (!normalized) return null;
  if (NON_ACTIONABLE_VALUES.has(normalized.toLowerCase())) {
    return null;
  }
  return normalized;
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

function getEvaluationResult(detail: ConversationDetail): {
  result: string;
  rationale: string;
} {
  const criteria = detail.analysis?.evaluation_criteria_results || {};
  const firstCriterion = Object.values(criteria)[0] as
    | { result?: unknown; rationale?: unknown }
    | undefined;

  const resultCandidate =
    typeof firstCriterion?.result === "string"
      ? firstCriterion.result
      : "unknown";

  return {
    result: isEvaluationResult(resultCandidate) ? resultCandidate : "unknown",
    rationale:
      typeof firstCriterion?.rationale === "string"
        ? firstCriterion.rationale
        : "",
  };
}

function getActionItems(detail: ConversationDetail): ActionItemSeed[] {
  const collected = detail.analysis?.data_collection_results;
  if (!collected || typeof collected !== "object") return [];

  const actionItems: ActionItemSeed[] = [];
  for (const [key, rawValue] of Object.entries(collected)) {
    const normalized = normalizeActionItemValue(rawValue);
    if (!normalized) continue;

    actionItems.push({
      source: "data_collection",
      key,
      title: toDisplayLabel(key),
      detail: normalized,
    });
  }

  return actionItems;
}

function getNextCallStatus(detailStatus: string, currentStatus: string): string | null {
  if (detailStatus === "done") return "completed";
  if (detailStatus === "failed") return "failed";
  if (currentStatus === "dispatching") return "dispatched";
  return null;
}

export async function syncCallArtifactsFromConversation({
  scheduledCallId,
  conversationId,
  currentStatus,
  detail,
}: SyncConversationParams) {
  const transcript = formatTranscript(detail);
  const { result, rationale } = getEvaluationResult(detail);
  const duration =
    typeof detail.metadata?.call_duration_secs === "number"
      ? detail.metadata.call_duration_secs
      : 0;
  const actionItems = getActionItems(detail);
  const nextStatus = getNextCallStatus(detail.status, currentStatus);

  return db.$transaction(async (tx) => {
    const evaluation = await tx.callEvaluation.upsert({
      where: { scheduledCallId },
      update: {
        conversationId,
        result,
        rationale,
        transcript,
        duration,
      },
      create: {
        scheduledCallId,
        conversationId,
        result,
        rationale,
        transcript,
        duration,
      },
    });

    await tx.callActionItem.deleteMany({ where: { scheduledCallId } });
    if (actionItems.length > 0) {
      await tx.callActionItem.createMany({
        data: actionItems.map((item) => ({
          scheduledCallId,
          conversationId,
          source: item.source,
          key: item.key,
          title: item.title,
          detail: item.detail,
        })),
      });
    }

    if (nextStatus && nextStatus !== currentStatus) {
      await tx.scheduledCall.update({
        where: { id: scheduledCallId },
        data: { status: nextStatus },
      });
    }

    return {
      evaluation,
      actionItemsCount: actionItems.length,
      status: nextStatus || currentStatus,
    };
  });
}
