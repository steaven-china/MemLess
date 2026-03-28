import type { I18n } from "../i18n/index.js";
import type { ChatMessage, ILLMProvider, LlmGenerateOptions, TokenCallback } from "./LLMProvider.js";

export interface AnthropicClaudeProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  version?: string;
  maxTokens?: number;
}

export type AnthropicTraceCallback = (event: string, payload: unknown) => void;

export class AnthropicClaudeProvider implements ILLMProvider {
  private readonly baseUrl: string;
  private readonly version: string;
  private readonly maxTokens: number;
  private readonly emptyResponseMessage: string;

  constructor(
    private readonly config: AnthropicClaudeProviderConfig,
    private readonly options?: {
      i18n?: I18n;
      onTrace?: AnthropicTraceCallback;
    }
  ) {
    this.baseUrl = config.baseUrl ?? "https://api.anthropic.com";
    this.version = config.version ?? "2023-06-01";
    this.maxTokens = config.maxTokens ?? 1024;
    this.emptyResponseMessage = options?.i18n?.t("chat.empty_response") ?? "Model returned no usable text.";
  }

  async generate(messages: ChatMessage[], options?: LlmGenerateOptions): Promise<string> {
    this.trace("request.start", { stream: false, messages });
    const response = await this.request(messages, false, options?.signal);
    this.trace("request.response", { stream: false, status: response.status });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic request failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    const text = extractAnthropicText(data.content);
    this.trace("response.parsed", { stream: false, text });
    return text ?? this.emptyResponseMessage;
  }

  async generateStream(
    messages: ChatMessage[],
    onToken: TokenCallback,
    options?: LlmGenerateOptions
  ): Promise<string> {
    this.trace("request.start", { stream: true, messages });
    const response = await this.request(messages, true, options?.signal);
    this.trace("request.response", { stream: true, status: response.status });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic stream request failed: ${response.status} ${text}`);
    }

    const body = response.body;
    if (!body) {
      throw new Error("Anthropic stream response body is empty.");
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
        const parsed = parseAnthropicSseEvent(event);
        if (parsed.done) {
          this.trace("response.parsed", { stream: true, text: fullText });
          return fullText.trim().length > 0 ? fullText : this.emptyResponseMessage;
        }
        if (parsed.token) {
          fullText += parsed.token;
          onToken(parsed.token);
        }
        boundary = buffer.indexOf("\n\n");
      }
    }

    if (buffer.trim().length > 0) {
      const parsed = parseAnthropicSseEvent(buffer);
      if (parsed.token) {
        fullText += parsed.token;
        onToken(parsed.token);
      }
    }

    this.trace("response.parsed", { stream: true, text: fullText });
    return fullText.trim().length > 0 ? fullText : this.emptyResponseMessage;
  }

  private request(messages: ChatMessage[], stream: boolean, signal?: AbortSignal): Promise<Response> {
    const payload = toAnthropicPayload(messages, this.config.model, this.maxTokens, stream);
    const endpoint = new URL("/v1/messages", this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);

    return fetch(endpoint.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": this.version
      },
      body: JSON.stringify(payload),
      signal
    });
  }

  private trace(event: string, payload: unknown): void {
    this.options?.onTrace?.(event, payload);
  }
}

interface AnthropicResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
}

function extractAnthropicText(
  content: Array<{
    type?: string;
    text?: string;
  }> | undefined
): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : ""))
    .filter((item) => item.length > 0)
    .join("\n")
    .trim();
  return text.length > 0 ? text : undefined;
}

function toAnthropicPayload(messages: ChatMessage[], model: string, maxTokens: number, stream: boolean): Record<string, unknown> {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter((message) => message.length > 0)
    .join("\n\n");

  const anthropicMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content
    }));

  const payload: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: anthropicMessages,
    stream
  };
  if (system.length > 0) {
    payload.system = system;
  }
  return payload;
}

function parseAnthropicSseEvent(event: string): { token?: string; done: boolean } {
  let eventType = "";
  let dataPayload = "";
  for (const line of event.split("\n")) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataPayload += line.slice(5).trim();
    }
  }

  if (!dataPayload) {
    return { done: eventType === "message_stop" };
  }

  const parsed = safeJsonParse<{
    type?: string;
    delta?: { text?: string };
  }>(dataPayload);
  if (!parsed) {
    return { done: false };
  }

  if (parsed.type === "message_stop" || eventType === "message_stop") {
    return { done: true };
  }

  const token = parsed.delta?.text;
  if (typeof token === "string" && token.length > 0) {
    return { token, done: false };
  }
  return { done: false };
}

function safeJsonParse<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
