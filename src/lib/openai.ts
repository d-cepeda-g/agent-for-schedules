const OPENAI_API_BASE_URL = "https://api.openai.com/v1";

type ChatCompletionChoice = {
  message?: {
    content?: string | null;
  };
};

type ChatCompletionResponse = {
  choices?: ChatCompletionChoice[];
};

type ResponsesContentItem = {
  type?: string;
  text?: string;
};

type ResponsesOutputItem = {
  type?: string;
  content?: ResponsesContentItem[];
};

type ResponsesApiResponse = {
  output_text?: string;
  output?: ResponsesOutputItem[];
};

type JsonCompletionInput = {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

type WebJsonCompletionInput = JsonCompletionInput & {
  searchContextSize?: "low" | "medium" | "high";
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

function extractTextFromResponsesPayload(payload: ResponsesApiResponse): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  if (Array.isArray(payload.output)) {
    const chunks: string[] = [];
    for (const item of payload.output) {
      if (!item || !Array.isArray(item.content)) continue;
      for (const contentItem of item.content) {
        if (
          contentItem?.type === "output_text" &&
          typeof contentItem.text === "string" &&
          contentItem.text.trim()
        ) {
          chunks.push(contentItem.text);
        }
      }
    }

    const combined = chunks.join("\n").trim();
    if (combined) return combined;
  }

  throw new Error("OpenAI web response did not include output text");
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

export async function createJsonCompletionWithWebSearch(
  input: WebJsonCompletionInput
): Promise<unknown> {
  const content = await createWebSearchTextCompletion(input);
  return extractJsonFromContent(content);
}

export async function createWebSearchTextCompletion(
  input: WebJsonCompletionInput
): Promise<string> {
  const apiKey = readOpenAiApiKey();
  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
  }

  const response = await fetch(`${OPENAI_API_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model || process.env.OPENAI_MODEL || "gpt-4.1-mini",
      temperature: input.temperature ?? 0.2,
      max_output_tokens: input.maxTokens ?? 900,
      tools: [
        {
          type: "web_search_preview",
          search_context_size: input.searchContextSize || "medium",
        },
      ],
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: input.systemPrompt }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: input.userPrompt }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `OpenAI web search request failed: ${response.status}${
        errorText ? ` ${errorText}` : ""
      }`
    );
  }

  const payload = (await response.json()) as ResponsesApiResponse;
  return extractTextFromResponsesPayload(payload);
}
