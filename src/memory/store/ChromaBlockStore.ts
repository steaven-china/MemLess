import type { EventRole, MemoryEvent } from "../../types.js";
import { MemoryBlock } from "../MemoryBlock.js";
import type { IBlockStore } from "./IBlockStore.js";

export interface ChromaBlockStoreConfig {
  baseUrl: string;
  collectionId: string;
  apiKey?: string;
}

type ChromaGetResponse = {
  ids?: unknown;
  documents?: unknown;
  metadatas?: unknown;
  embeddings?: unknown;
};

export class ChromaBlockStore implements IBlockStore {
  private readonly cache = new Map<string, MemoryBlock>();
  private hydrateAllPromise?: Promise<void>;

  constructor(private readonly config: ChromaBlockStoreConfig) {}

  async upsert(block: MemoryBlock): Promise<void> {
    this.cache.set(block.id, block);
    await this.fetchJson(`/api/v1/collections/${this.config.collectionId}/upsert`, {
      ids: [block.id],
      documents: [block.summary],
      metadatas: [
        {
          startTime: block.startTime,
          endTime: block.endTime,
          tokenCount: block.tokenCount,
          keywords: block.keywords,
          rawEvents: block.rawEvents,
          retentionMode: block.retentionMode,
          matchScore: block.matchScore,
          conflict: block.conflict,
          tags: block.tags
        }
      ],
      embeddings: [block.embedding]
    });
  }

  async get(blockId: string): Promise<MemoryBlock | undefined> {
    const cached = this.cache.get(blockId);
    if (cached) return cached;
    await this.hydrateByIds([blockId]);
    return this.cache.get(blockId);
  }

  async getMany(blockIds: string[]): Promise<MemoryBlock[]> {
    const missing = blockIds.filter((blockId) => !this.cache.has(blockId));
    if (missing.length > 0) {
      await this.hydrateByIds(missing);
    }
    return blockIds
      .map((blockId) => this.cache.get(blockId))
      .filter((item): item is MemoryBlock => Boolean(item));
  }

  async list(): Promise<MemoryBlock[]> {
    await this.ensureHydratedList();
    return [...this.cache.values()].sort((a, b) => a.startTime - b.startTime);
  }

  private async ensureHydratedList(): Promise<void> {
    if (!this.hydrateAllPromise) {
      this.hydrateAllPromise = this.hydrateAll();
    }
    try {
      await this.hydrateAllPromise;
    } catch (error) {
      this.hydrateAllPromise = undefined;
      if (this.cache.size === 0) throw error;
    }
  }

  private async hydrateAll(): Promise<void> {
    const response = (await this.fetchJson(`/api/v1/collections/${this.config.collectionId}/get`, {
      include: ["documents", "metadatas", "embeddings"]
    })) as ChromaGetResponse;
    this.mergeGetResponse(response);
  }

  private async hydrateByIds(blockIds: string[]): Promise<void> {
    if (blockIds.length === 0) return;
    const response = (await this.fetchJson(`/api/v1/collections/${this.config.collectionId}/get`, {
      ids: blockIds,
      include: ["documents", "metadatas", "embeddings"]
    })) as ChromaGetResponse;
    this.mergeGetResponse(response);
  }

  private mergeGetResponse(response: ChromaGetResponse): void {
    const ids = asStringArray(response.ids);
    if (ids.length === 0) return;

    const documents = asUnknownArray(response.documents);
    const metadatas = asUnknownArray(response.metadatas);
    const embeddings = asUnknownArray(response.embeddings);

    for (let index = 0; index < ids.length; index += 1) {
      const blockId = ids[index];
      if (!blockId) continue;
      const metadata = asRecord(metadatas[index]);
      const block = deserializeBlock({
        id: blockId,
        document: documents[index],
        metadata,
        embedding: embeddings[index]
      });
      this.cache.set(block.id, block);
    }
  }

  private async fetchJson(path: string, body: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Chroma request failed: ${response.status} ${text}`);
    }
    return response.json();
  }
}

function deserializeBlock(input: {
  id: string;
  document: unknown;
  metadata: Record<string, unknown>;
  embedding: unknown;
}): MemoryBlock {
  const startTime = asFiniteNumber(input.metadata.startTime, Date.now());
  const block = new MemoryBlock(input.id, startTime);
  block.endTime = asFiniteNumber(input.metadata.endTime, startTime);
  block.tokenCount = asFiniteNumber(input.metadata.tokenCount, 0);
  block.summary =
    typeof input.document === "string"
      ? input.document
      : typeof input.metadata.summary === "string"
        ? input.metadata.summary
        : "";
  block.keywords = asStringArray(input.metadata.keywords);
  block.embedding = asNumberArray(input.embedding);
  block.rawEvents = parseMemoryEvents(input.metadata.rawEvents);
  block.retentionMode = parseRetentionMode(input.metadata.retentionMode);
  block.matchScore = asFiniteNumber(input.metadata.matchScore, 0);
  block.conflict = asBoolean(input.metadata.conflict);
  block.tags = normalizeTags(input.metadata.tags);
  return block;
}

function asUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "number" ? item : Number.NaN))
    .filter((item) => Number.isFinite(item));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asFiniteNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}

function parseRetentionMode(value: unknown): MemoryBlock["retentionMode"] {
  if (value === "compressed" || value === "raw" || value === "conflict") {
    return value;
  }
  return "raw";
}

function parseMemoryEvents(value: unknown): MemoryEvent[] {
  if (!Array.isArray(value)) return [];
  const events: MemoryEvent[] = [];
  for (const item of value) {
    const row = asRecord(item);
    const id = typeof row.id === "string" ? row.id : "";
    const role = parseRole(row.role);
    const text = typeof row.text === "string" ? row.text : "";
    const timestamp = asFiniteNumber(row.timestamp, Date.now());
    if (!id || !role) continue;
    const metadata = asRecord(row.metadata);
    if (Object.keys(metadata).length > 0) {
      events.push({ id, role, text, timestamp, metadata });
    } else {
      events.push({ id, role, text, timestamp });
    }
  }
  return events;
}

function parseRole(value: unknown): EventRole | undefined {
  if (value === "system" || value === "user" || value === "assistant" || value === "tool") {
    return value;
  }
  return undefined;
}

function normalizeTags(value: unknown): Array<"important" | "normal"> {
  const output: Array<"important" | "normal"> = [];
  if (Array.isArray(value)) {
    for (const tag of value) {
      if ((tag === "important" || tag === "normal") && !output.includes(tag)) {
        output.push(tag);
      }
    }
  }
  if (output.includes("important")) return ["important"];
  if (output.includes("normal")) return ["normal"];
  return ["normal"];
}
