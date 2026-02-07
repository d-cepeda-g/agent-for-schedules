import { NextRequest, NextResponse } from "next/server";
import { syncCallArtifactsFromConversation } from "@/lib/conversation-sync";
import { db } from "@/lib/db";
import { getConversationDetail } from "@/lib/elevenlabs";
import { verifyElevenLabsWebhook } from "@/lib/elevenlabs-webhook";

type ElevenLabsWebhookPayload = {
  type?: string;
  data?: {
    conversation_id?: string;
    status?: string;
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

  const call = await db.scheduledCall.findFirst({
    where: { conversationId },
    select: { id: true, status: true },
  });

  if (!call) {
    return NextResponse.json(
      { ok: true, ignored: true, reason: "No matching scheduled call" },
      { status: 202 }
    );
  }

  try {
    const detail = await getConversationDetail(conversationId);
    const syncResult = await syncCallArtifactsFromConversation({
      scheduledCallId: call.id,
      conversationId,
      currentStatus: call.status,
      detail,
    });

    return NextResponse.json({
      ok: true,
      callId: call.id,
      conversationId,
      status: syncResult.status,
      actionItemsCount: syncResult.actionItemsCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
