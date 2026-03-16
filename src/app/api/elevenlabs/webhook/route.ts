import { NextRequest, NextResponse } from "next/server";
import { createCallLogSafe } from "@/lib/call-logs";
import { syncCallArtifactsFromConversation } from "@/lib/conversation-sync";
import { syncInboundCall } from "@/lib/inbound-sync";
import { db } from "@/lib/db";
import { getConversationDetail } from "@/lib/elevenlabs";
import { verifyElevenLabsWebhook } from "@/lib/elevenlabs-webhook";

type ElevenLabsWebhookPayload = {
  type?: string;
  data?: {
    conversation_id?: string;
    status?: string;
    phone_number?: string;
    caller_id?: string;
    direction?: string;
  };
};

const RELEVANT_EVENT_TYPES = new Set([
  "post_call_transcription",
  "post_call_analysis",
  "conversation_completed",
  "conversation_ended",
]);

function getConversationId(payload: ElevenLabsWebhookPayload): string | null {
  const conversationId = payload.data?.conversation_id;
  if (typeof conversationId !== "string" || conversationId.trim().length === 0) {
    return null;
  }
  return conversationId;
}

function getCallerPhone(payload: ElevenLabsWebhookPayload): string {
  return payload.data?.caller_id || payload.data?.phone_number || "unknown";
}

async function handleOutboundWebhook(
  call: { id: string; status: string },
  conversationId: string,
  payload: ElevenLabsWebhookPayload
) {
  await createCallLogSafe({
    scheduledCallId: call.id,
    event: "webhook_received",
    message: `Webhook received (${payload.type || "unknown_type"})`,
    details: { conversationId, payloadType: payload.type || null },
  });

  const detail = await getConversationDetail(conversationId);
  const syncResult = await syncCallArtifactsFromConversation({
    scheduledCallId: call.id,
    conversationId,
    currentStatus: call.status,
    detail,
  });

  await createCallLogSafe({
    scheduledCallId: call.id,
    event: "webhook_synced",
    message: `Webhook sync complete (${syncResult.status})`,
    details: {
      actionItemsCount: syncResult.actionItemsCount,
      providerStatus: detail.status,
    },
  });

  return NextResponse.json({
    ok: true,
    direction: "outbound",
    callId: call.id,
    conversationId,
    status: syncResult.status,
    actionItemsCount: syncResult.actionItemsCount,
  });
}

async function handleInboundWebhook(
  conversationId: string,
  callerPhone: string
) {
  const detail = await getConversationDetail(conversationId);
  const syncResult = await syncInboundCall({
    conversationId,
    callerPhone,
    detail,
  });

  return NextResponse.json({
    ok: true,
    direction: "inbound",
    inboundCallId: syncResult.inboundCall.id,
    conversationId,
    status: syncResult.status,
    actionItemsCount: syncResult.actionItemsCount,
    isNewCustomer: syncResult.isNewCustomer,
  });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const verification = verifyElevenLabsWebhook(rawBody, request.headers);
  if (!verification.ok) {
    return NextResponse.json({ error: verification.error }, { status: verification.status });
  }

  let payload: ElevenLabsWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ElevenLabsWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (payload.type && !RELEVANT_EVENT_TYPES.has(payload.type)) {
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: `Unsupported event type: ${payload.type}`,
    });
  }

  const conversationId = getConversationId(payload);
  if (!conversationId) {
    return NextResponse.json(
      { ok: true, ignored: true, reason: "Missing conversation_id" },
      { status: 202 }
    );
  }

  // Check if this conversation matches an outbound scheduled call
  const call = await db.scheduledCall.findFirst({
    where: { conversationId },
    select: { id: true, status: true },
  });

  try {
    if (call) {
      // Outbound call — existing flow
      return await handleOutboundWebhook(call, conversationId, payload);
    }

    // No matching outbound call — treat as inbound
    const callerPhone = getCallerPhone(payload);
    return await handleInboundWebhook(conversationId, callerPhone);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    if (call) {
      await createCallLogSafe({
        scheduledCallId: call.id,
        event: "webhook_sync_failed",
        level: "error",
        message,
        details: { conversationId, payloadType: payload.type || null },
      });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
