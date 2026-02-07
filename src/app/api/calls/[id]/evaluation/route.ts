import { NextRequest, NextResponse } from "next/server";
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
    const detail = await getConversationDetail(call.conversationId);
    const syncResult = await syncCallArtifactsFromConversation({
      scheduledCallId: call.id,
      conversationId: call.conversationId,
      currentStatus: call.status,
      detail,
    });
    return NextResponse.json(syncResult.evaluation);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
