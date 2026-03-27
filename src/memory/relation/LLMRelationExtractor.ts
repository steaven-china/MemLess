import { RelationType } from "../../types.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import { HeuristicRelationExtractor } from "./RelationExtractor.js";
import type { ExtractedRelation, IRelationExtractor } from "./RelationExtractor.js";

export interface LLMFallbackDetails {
  reason: string;
  currentBlockId: string;
  neighborCount: number;
}

export interface LLMRelationExtractorConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  timeoutMs?: number;
  onFallback?: (details: LLMFallbackDetails) => void;
}

export interface LLMRelationExtractorOptions {
  defaultBaseUrl: string;
  providerName: string;
  systemPrompt: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface ExtractorPayload {
  relations?: Array<{
    src?: string;
    dst?: string;
    type?: string;
    confidence?: number;
  }>;
}

export class LLMRelationExtractor implements IRelationExtractor {
  private readonly fallback = new HeuristicRelationExtractor();
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: LLMRelationExtractorConfig,
    private readonly options: LLMRelationExtractorOptions
  ) {
    this.baseUrl = config.baseUrl ?? options.defaultBaseUrl;
    this.timeoutMs = config.timeoutMs ?? 12_000;
  }

  async extract(current: MemoryBlock, neighbors: MemoryBlock[]): Promise<ExtractedRelation[]> {
    if (neighbors.length === 0) return [];

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
              {
                role: "system",
                content: this.options.systemPrompt
              },
              {
                role: "user",
                content: buildPrompt(current, neighbors)
              }
            ]
          }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        throw new Error(`${this.options.providerName} relation request failed: ${response.status}`);
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content ?? "";
      const parsed = parsePayload(content);
      const cleaned = validateRelations(parsed, current, neighbors);
      if (cleaned.length === 0) {
        this.reportFallback("empty_or_invalid_model_output", current.id, neighbors.length);
        return this.fallback.extract(current, neighbors);
      }
      return cleaned;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.reportFallback(`request_or_parse_error:${message}`, current.id, neighbors.length);
      return this.fallback.extract(current, neighbors);
    }
  }

  private reportFallback(reason: string, currentBlockId: string, neighborCount: number): void {
    this.config.onFallback?.({
      reason,
      currentBlockId,
      neighborCount
    });
  }
}

function buildPrompt(current: MemoryBlock, neighbors: MemoryBlock[]): string {
  const currentPart = [
    `current.id=${current.id}`,
    `current.summary=${truncate(current.summary, 320)}`,
    `current.keywords=${current.keywords.join(",")}`
  ].join("\n");

  const neighborPart = neighbors
    .map((neighbor) =>
      [
        `neighbor.id=${neighbor.id}`,
        `neighbor.summary=${truncate(neighbor.summary, 220)}`,
        `neighbor.keywords=${neighbor.keywords.join(",")}`
      ].join("\n")
    )
    .join("\n---\n");

  return `${currentPart}\n\nneighbors:\n${neighborPart}`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function parsePayload(content: string): ExtractorPayload {
  const cleaned = stripCodeFences(content).trim();
  const jsonText = extractJsonObject(cleaned) ?? cleaned;
  try {
    return JSON.parse(jsonText) as ExtractorPayload;
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
  if (start === -1 || end === -1 || end <= start) return undefined;
  return text.slice(start, end + 1);
}

function validateRelations(
  payload: ExtractorPayload,
  current: MemoryBlock,
  neighbors: MemoryBlock[]
): ExtractedRelation[] {
  const neighborIds = new Set(neighbors.map((item) => item.id));
  const relationValues = new Set(Object.values(RelationType));
  const relations = payload.relations ?? [];
  const output: ExtractedRelation[] = [];

  for (const relation of relations) {
    const src = relation.src ?? "";
    const dst = relation.dst ?? current.id;
    const type = relation.type ?? "";
    if (!neighborIds.has(src)) continue;
    if (dst !== current.id) continue;
    if (!relationValues.has(type as RelationType)) continue;
    output.push({
      src,
      dst,
      type: type as RelationType,
      confidence: clampConfidence(relation.confidence)
    });
  }

  const dedupe = new Map<string, ExtractedRelation>();
  for (const relation of output) {
    const key = `${relation.src}|${relation.dst}|${relation.type}`;
    const prev = dedupe.get(key);
    if (!prev || prev.confidence < relation.confidence) {
      dedupe.set(key, relation);
    }
  }
  return [...dedupe.values()];
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}
