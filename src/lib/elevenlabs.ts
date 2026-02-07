const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";

function getHeaders(): HeadersInit {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
  return {
    "Content-Type": "application/json",
    "xi-api-key": apiKey,
  };
}

function getAgentId(): string {
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!agentId) throw new Error("ELEVENLABS_AGENT_ID is not set");
  return agentId;
}

function getPhoneNumberId(): string {
  const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;
  if (!phoneNumberId) throw new Error("ELEVENLABS_PHONE_NUMBER_ID is not set");
  return phoneNumberId;
}

export type OutboundCallResult = {
  success: boolean;
  message: string;
  conversation_id: string | null;
  callSid: string | null;
};

export async function makeOutboundCall(
  toNumber: string,
  overrides?: {
    firstMessage?: string;
    prompt?: string;
  }
): Promise<OutboundCallResult> {
  const body: Record<string, unknown> = {
    agent_id: getAgentId(),
    agent_phone_number_id: getPhoneNumberId(),
    to_number: toNumber,
  };

  const agentOverride: Record<string, unknown> = {};
  if (overrides?.prompt) {
    agentOverride.prompt = { prompt: overrides.prompt };
  }
  if (overrides?.firstMessage) {
    agentOverride.first_message = overrides.firstMessage;
  }

  if (Object.keys(agentOverride).length > 0) {
    body.conversation_initiation_client_data = {
      conversation_config_override: {
        agent: agentOverride,
      },
    };
  }

  const response = await fetch(
    `${ELEVENLABS_BASE_URL}/convai/twilio/outbound-call`,
    { method: "POST", headers: getHeaders(), body: JSON.stringify(body) }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs outbound call failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

export type BatchCallRecipient = {
  phone_number: string;
  prompt_variables?: Record<string, string>;
};

export type BatchCallResult = {
  id: string;
  name: string;
  agent_id: string;
  status: string;
  total_calls_scheduled: number;
};

export async function submitBatchCall(
  callName: string,
  recipients: BatchCallRecipient[],
  scheduledTimeUnix?: number
): Promise<BatchCallResult> {
  const body: Record<string, unknown> = {
    call_name: callName,
    agent_id: getAgentId(),
    recipients,
    agent_phone_number_id: getPhoneNumberId(),
  };

  if (scheduledTimeUnix) {
    body.scheduled_time_unix = scheduledTimeUnix;
  }

  const response = await fetch(
    `${ELEVENLABS_BASE_URL}/convai/batch-calling/submit`,
    { method: "POST", headers: getHeaders(), body: JSON.stringify(body) }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs batch call failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

export async function getBatchCallStatus(batchId: string): Promise<BatchCallResult> {
  const response = await fetch(
    `${ELEVENLABS_BASE_URL}/convai/batch-calling/${batchId}`,
    { method: "GET", headers: getHeaders() }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs batch status failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

export type ConversationDetail = {
  conversation_id: string;
  status: string;
  transcript: Array<{ role: string; message: string; time_in_call_secs?: number }>;
  metadata?: {
    call_duration_secs?: number;
  };
  analysis?: {
    evaluation_criteria_results?: Record<
      string,
      { result: string; rationale: string }
    >;
    data_collection_results?: Record<string, { value: string }>;
  };
};

export async function getConversationDetail(
  conversationId: string
): Promise<ConversationDetail> {
  const response = await fetch(
    `${ELEVENLABS_BASE_URL}/convai/conversations/${conversationId}`,
    { method: "GET", headers: getHeaders() }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs conversation detail failed: ${response.status} ${errorText}`);
  }

  return response.json();
}
