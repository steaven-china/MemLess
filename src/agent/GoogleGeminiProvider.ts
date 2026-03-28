import type { I18n } from "../i18n/index.js";
import type { ChatMessage, ILLMProvider, LlmGenerateOptions, TokenCallback } from "./LLMProvider.js";

export interface GoogleGeminiProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export type GeminiTraceCallback = (event: string, payload: unknown) => void;

export class GoogleGeminiProvider implements ILLMProvider {
  private readonly baseUrl: string;
  private readonly emptyResponseMessage: string;

  constructor(
    private readonly config: GoogleGeminiProviderConfig,
    private readonly options?: {
      i18n?: I18n;
      onTrace?: GeminiTraceCallback;
    }
  ) {
    this.baseUrl = config.baseUrl ?? "https://generativelanguage.googleapis.com";
    this.emptyResponseMessage = options?.i18n?.t("chat.empty_response") ?? "Model returned no usable text.";
  }

  async generate(messages: ChatMessage[], options?: LlmGenerateOptions): Promise<string> {
    this.trace("request.start", { stream: false, messages });
    const endpoint = this.buildUrl(false);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(toGeminiPayload(messages)),
      signal: options?.signal
    });

    this.trace("request.response", { stream: false, status: response.status });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini request failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as GeminiResponse;
    const text = extractGeminiText(data);
    this.trace("response.parsed", { stream: false, text });
    return text ?? this.emptyResponseMessage;
  }

  async generateStream(
    messages: ChatMessage[],
    onToken: TokenCallback,
    options?: LlmGenerateOptions
  ): Promise<string> {
    this.trace("request.start", { stream: true, messages });
    const endpoint = this.buildUrl(true);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(toGeminiPayload(messages)),
      signal: options?.signal
    });

    this.trace("request.response", { stream: true, status: response.status });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini stream request failed: ${response.status} ${text}`);
    }

    const body = response.body;
    if (!body) {
      throw new Error("Gemini stream response body is empty.");
    }

    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullText = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const token = parseGeminiSseToken(event);
        if (token) {
          fullText += token;
          onToken(token);
        }
        boundary = buffer.indexOf("\n\n");
      }
    }

    if (buffer.trim().length > 0) {
      const token = parseGeminiSseToken(buffer);
      if (token) {
        fullText += token;
        onToken(token);
      }
    }

    this.trace("response.parsed", { stream: true, text: fullText });
    return fullText.trim().length > 0 ? fullText : this.emptyResponseMessage;
  }

  private buildUrl(stream: boolean): string {
    const method = stream ? "streamGenerateContent" : "generateContent";
    const model = encodeURIComponent(this.config.model);
    const endpoint = new URL(
      `/v1beta/models/${model}:${method}`,
      this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`
    );
    endpoint.searchParams.set("key", this.config.apiKey);
    if (stream) {
      endpoint.searchParams.set("alt", "sse");
    }
    return endpoint.toString();
  }

  private trace(event: string, payload: unknown): void {
    this.options?.onTrace?.(event, payload);
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

function toGeminiPayload(messages: ChatMessage[]): Record<string, unknown> {
  const systemText = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter((text) => text.length > 0)
    .join("\n\n");

  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    }));

  const payload: Record<string, unknown> = {
    contents
  };
  if (systemText.length > 0) {
    payload.systemInstruction = {
      parts: [{ text: systemText }]
    };
  }
  return payload;
}

function extractGeminiText(data: GeminiResponse | undefined): string | undefined {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return undefined;
  const text = parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter((part) => part.length > 0)
    .join("\n")
    .trim();
  return text.length > 0 ? text : undefined;
}

function parseGeminiSseToken(event: string): string | undefined {
  const lines = event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line.length > 0 && line !== "[DONE]");
  if (lines.length === 0) return undefined;

  let token = "";
  for (const line of lines) {
    const parsed = safeJsonParse<GeminiResponse>(line);
    const text = extractGeminiText(parsed);
    if (text) token += text;
  }
  return token.length > 0 ? token : undefined;
}

function safeJsonParse<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
