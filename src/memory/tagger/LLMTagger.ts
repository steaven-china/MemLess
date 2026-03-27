import type { BlockTag } from "../../types.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import { HeuristicTagger } from "./HeuristicTagger.js";
import type { ITagger } from "./Tagger.js";

export interface LLMFallbackDetails {
  reason: string;
  blockId: string;
}

export interface LLMTaggerConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  importantThreshold: number;
  onFallback?: (details: LLMFallbackDetails) => void;
}

export interface LLMTaggerOptions {
  providerName: string;
  defaultBaseUrl: string;
  systemPrompt: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface TaggerPayload {
  tags?: string[];
  importantScore?: number;
}

export class LLMTagger implements ITagger {
  private readonly fallback: HeuristicTagger;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(
    private readonly config: LLMTaggerConfig,
    private readonly options: LLMTaggerOptions
  ) {
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.baseUrl = config.baseUrl ?? options.defaultBaseUrl;
    this.fallback = new HeuristicTagger({ importantThreshold: config.importantThreshold });
  }

  async tag(block: MemoryBlock): Promise<BlockTag[]> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`
          },
          body: JSON.stringify({
            model: this.config.model,
            temperature: 0,
            messages: [
              { role: "system", content: this.options.systemPrompt },
              { role: "user", content: buildPrompt(block) }
            ]
          }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        throw new Error(`${this.options.providerName} tag request failed: ${response.status}`);
      }

      const payload = parsePayload((await response.json()) as ChatCompletionResponse);
      const tags = normalizeTags(payload, this.config.importantThreshold);
      if (tags.length > 0) return tags;

      this.reportFallback("empty_or_invalid_model_output", block.id);
      return this.fallback.tag(block);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.reportFallback(`request_or_parse_error:${message}`, block.id);
      return this.fallback.tag(block);
    }
  }

  private reportFallback(reason: string, blockId: string): void {
    this.config.onFallback?.({ reason, blockId });
  }
}

function buildPrompt(block: MemoryBlock): string {
  const events = block.rawEvents
    .slice(-8)
    .map((event) => `- [${event.role}] ${truncate(event.text, 220)}`)
    .join("\n");

  return [
    `block.id=${block.id}`,
    `retentionMode=${block.retentionMode}`,
    `conflict=${block.conflict}`,
    `summary=${truncate(block.summary, 600)}`,
    "recent_events:",
    events || "- (none)",
    "\nReturn JSON only."
  ].join("\n");
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function parsePayload(data: ChatCompletionResponse): TaggerPayload {
  const content = data.choices?.[0]?.message?.content ?? "";
  const cleaned = stripCodeFences(content).trim();
  const jsonText = extractJsonObject(cleaned) ?? cleaned;
  try {
    return JSON.parse(jsonText) as TaggerPayload;
  } catch {
    return {};
  }
}

function stripCodeFences(content: string): string {
  return content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return undefined;
  return text.slice(start, end + 1);
}

function normalizeTags(payload: TaggerPayload, threshold: number): BlockTag[] {
  const raw = payload.tags ?? [];
  const tags = new Set<BlockTag>();
  for (const tag of raw) {
    if (tag === "important" || tag === "normal") {
      tags.add(tag);
    }
  }
  if (typeof payload.importantScore === "number" && Number.isFinite(payload.importantScore)) {
    if (payload.importantScore >= threshold) {
      tags.add("important");
      tags.delete("normal");
    }
  }

  if (tags.has("important")) return ["important"];
  if (tags.has("normal")) return ["normal"];
  return [];
}
