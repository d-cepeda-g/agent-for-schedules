import { NextRequest, NextResponse } from "next/server";
import { createCallLogSafe } from "@/lib/call-logs";
import { db } from "@/lib/db";
import { syncCallArtifactsFromConversation } from "@/lib/conversation-sync";
import { getConversationDetail } from "@/lib/elevenlabs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const call = await db.scheduledCall.findUnique({
    where: { id },
    include: { evaluation: true },
  });

  if (!call) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  if (!call.conversationId) {
    return NextResponse.json(
      { error: "Call has no conversation yet" },
      { status: 400 }
    );
  }

  if (call.evaluation && call.status === "completed") {
    return NextResponse.json(call.evaluation);
  }

  try {
    await createCallLogSafe({
      scheduledCallId: call.id,
      event: "evaluation_fetch_manual",
      message: "Manual evaluation sync requested",
    });

    const detail = await getConversationDetail(call.conversationId);
    const syncResult = await syncCallArtifactsFromConversation({
      scheduledCallId: call.id,
      conversationId: call.conversationId,
      currentStatus: call.status,
      detail,
    });

    await createCallLogSafe({
      scheduledCallId: call.id,
      event: "evaluation_synced_manual",
      message: `Manual evaluation sync complete (${syncResult.status})`,
      details: {
        actionItemsCount: syncResult.actionItemsCount,
        providerStatus: detail.status,
      },
    });

    return NextResponse.json(syncResult.evaluation);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await createCallLogSafe({
      scheduledCallId: call.id,
      event: "evaluation_sync_failed",
      level: "error",
      message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
