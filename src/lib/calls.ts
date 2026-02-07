import type { Prisma } from "@prisma/client";
import { createCallLogSafe } from "@/lib/call-logs";
import { db } from "@/lib/db";
import { makeOutboundCall, type OutboundCallResult } from "@/lib/elevenlabs";
import type { CallStatus } from "@/lib/validation";

const DEFAULT_DISPATCHABLE_STATUSES: CallStatus[] = ["pending", "failed"];

type CallWithCustomer = Prisma.ScheduledCallGetPayload<{
  include: { customer: true };
}>;

type DispatchSuccess = {
  ok: true;
  call: CallWithCustomer;
  elevenlabs: OutboundCallResult;
};

type DispatchFailure = {
  ok: false;
  status: number;
  error: string;
};

export type DispatchResult = DispatchSuccess | DispatchFailure;

type DispatchOptions = {
  force?: boolean;
  allowedStatuses?: CallStatus[];
};

function getMissingConfigError(message: string): boolean {
  return message.includes("ELEVENLABS_") && message.includes("is not set");
}

function buildPromptVariables(call: CallWithCustomer): Record<string, string> {
  const preferredLanguage = call.preferredLanguage?.trim() || "English";
  const callReason = call.callReason?.trim() || "";
  const callPurpose = call.callPurpose?.trim() || "";
  const notes = call.notes?.trim() || "";

  const contextLines = [
    `Language: ${preferredLanguage}`,
    callReason ? `Reason: ${callReason}` : "",
    callPurpose ? `Purpose: ${callPurpose}` : "",
    notes ? `Additional context: ${notes}` : "",
  ].filter(Boolean);

  const pairs = [
    ["customer_name", call.customer.name],
    ["preferred_language", preferredLanguage],
    ["call_reason", callReason],
    ["call_purpose", callPurpose],
    ["additional_context", notes],
    ["call_context", contextLines.join("\n")],
  ] as const;

  return Object.fromEntries(
    pairs.filter(([, value]) => typeof value === "string" && value.trim().length > 0)
  );
}

export async function dispatchScheduledCall(
  callId: string,
  options: DispatchOptions = {}
): Promise<DispatchResult> {
  const force = options.force ?? false;
  const allowedStatuses = options.allowedStatuses ?? DEFAULT_DISPATCHABLE_STATUSES;

  const call = await db.scheduledCall.findUnique({
    where: { id: callId },
    include: { customer: true },
  });

  if (!call) {
    return { ok: false, status: 404, error: "Call not found" };
  }

  if (!allowedStatuses.includes(call.status as CallStatus)) {
    return { ok: false, status: 400, error: `Call is already ${call.status}` };
  }

  const now = new Date();
  if (!force && call.scheduledAt.getTime() > now.getTime()) {
    return {
      ok: false,
      status: 400,
      error: `Call is scheduled for ${call.scheduledAt.toISOString()}`,
    };
  }

  // Claim the call before hitting the provider so concurrent requests do not double-dial.
  const claim = await db.scheduledCall.updateMany({
    where: {
      id: call.id,
      status: { in: allowedStatuses },
      ...(force ? {} : { scheduledAt: { lte: now } }),
    },
    data: { status: "dispatching" },
  });

  if (claim.count === 0) {
    const latest = await db.scheduledCall.findUnique({
      where: { id: call.id },
      select: { status: true },
    });
    return {
      ok: false,
      status: 409,
      error: latest ? `Call is already ${latest.status}` : "Call is no longer dispatchable",
    };
  }

  try {
    const promptVariables = buildPromptVariables(call);

    await createCallLogSafe({
      scheduledCallId: call.id,
      event: "dispatch_attempt",
      message: `Dispatching outbound call to ${call.customer.phone}`,
      details: { promptVariables },
    });

    const result = await makeOutboundCall(
      call.customer.phone,
      Object.keys(promptVariables).length > 0 ? { promptVariables } : undefined
    );

    const updatedCall = await db.scheduledCall.update({
      where: { id: call.id },
      data: {
        status: "dispatched",
        conversationId: result.conversation_id || "",
      },
      include: { customer: true },
    });

    await createCallLogSafe({
      scheduledCallId: call.id,
      event: "dispatch_success",
      message: "Outbound call accepted by ElevenLabs",
      details: {
        conversationId: result.conversation_id,
        callSid: result.callSid,
        providerMessage: result.message,
      },
    });

    return { ok: true, call: updatedCall, elevenlabs: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isConfigError = getMissingConfigError(message);

    await db.scheduledCall.update({
      where: { id: call.id },
      data: { status: isConfigError ? call.status : "failed" },
    });

    await createCallLogSafe({
      scheduledCallId: call.id,
      event: "dispatch_failed",
      level: "error",
      message,
    });

    return {
      ok: false,
      status: isConfigError ? 503 : 500,
      error: message,
    };
  }
}
