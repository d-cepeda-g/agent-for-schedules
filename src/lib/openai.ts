const OPENAI_API_BASE_URL = "https://api.openai.com/v1";

type ChatCompletionChoice = {
  message?: {
    content?: string | null;
  };
};

type ChatCompletionResponse = {
  choices?: ChatCompletionChoice[];
};

type JsonCompletionInput = {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

function readOpenAiApiKey(): string {
  return (
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_KEY ||
    process.env["OPENAI-KEY"] ||
    ""
  ).trim();
}

export function hasOpenAiApiKey(): boolean {
  return readOpenAiApiKey().length > 0;
}

function extractJsonFromContent(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("OpenAI returned empty content");
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const blockMatch = trimmed.match(/```json\s*([\s\S]*?)```/i);
    if (blockMatch?.[1]) {
      return JSON.parse(blockMatch[1]) as unknown;
    }
    throw new Error("OpenAI response was not valid JSON");
  }
}

export async function createJsonCompletion(
  input: JsonCompletionInput
): Promise<unknown> {
  const apiKey = readOpenAiApiKey();
  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
  }

  const response = await fetch(`${OPENAI_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model || process.env.OPENAI_MODEL || "gpt-4.1-mini",
      temperature: input.temperature ?? 0.2,
      max_completion_tokens: input.maxTokens ?? 900,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `OpenAI request failed: ${response.status}${errorText ? ` ${errorText}` : ""}`
    );
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("OpenAI did not return a content string");
  }

  return extractJsonFromContent(content);
}
