import { promises as fs } from "node:fs";

import { MemoryBlock } from "../MemoryBlock.js";
import { writeJsonAtomic } from "../../utils/fs.js";
import type { IBlockStore } from "./IBlockStore.js";

export interface LanceBlockStoreConfig {
  filePath: string;
}

type SerializedBlock = {
  id: string;
  startTime: number;
  endTime: number;
  tokenCount: number;
  summary: string;
  keywords: string[];
  embedding: number[];
  rawEvents: MemoryBlock["rawEvents"];
  retentionMode: MemoryBlock["retentionMode"];
  matchScore: MemoryBlock["matchScore"];
  conflict: MemoryBlock["conflict"];
  tags?: MemoryBlock["tags"];
};

export class LanceBlockStore implements IBlockStore {
  private readonly table = new Map<string, MemoryBlock>();
  private initialized = false;

  constructor(private readonly config: LanceBlockStoreConfig) {}

  async upsert(block: MemoryBlock): Promise<void> {
    await this.ensureLoaded();
    this.table.set(block.id, block);
    await this.flush();
  }

  async get(blockId: string): Promise<MemoryBlock | undefined> {
    await this.ensureLoaded();
    return this.table.get(blockId);
  }

  async getMany(blockIds: string[]): Promise<MemoryBlock[]> {
    await this.ensureLoaded();
    return blockIds
      .map((blockId) => this.table.get(blockId))
      .filter((item): item is MemoryBlock => Boolean(item));
  }

  async list(): Promise<MemoryBlock[]> {
    await this.ensureLoaded();
    return [...this.table.values()].sort((a, b) => a.startTime - b.startTime);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const raw = await fs.readFile(this.config.filePath, "utf8");
      const payload = JSON.parse(raw) as SerializedBlock[];
      for (const item of payload) {
        const block = new MemoryBlock(item.id, item.startTime);
        block.endTime = item.endTime;
        block.tokenCount = item.tokenCount;
        block.summary = item.summary;
        block.keywords = item.keywords;
        block.embedding = item.embedding;
        block.rawEvents = item.rawEvents;
        block.retentionMode = item.retentionMode ?? "raw";
        block.matchScore = item.matchScore ?? 0;
        block.conflict = item.conflict ?? false;
        block.tags = normalizeTags(item.tags);
        this.table.set(block.id, block);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("ENOENT")) {
        throw error;
      }
    }
  }

  private async flush(): Promise<void> {
    const serialized = [...this.table.values()].map((block) => ({
      id: block.id,
      startTime: block.startTime,
      endTime: block.endTime,
      tokenCount: block.tokenCount,
      summary: block.summary,
      keywords: block.keywords,
      embedding: block.embedding,
      rawEvents: block.rawEvents,
      retentionMode: block.retentionMode,
      matchScore: block.matchScore,
      conflict: block.conflict,
      tags: normalizeTags(block.tags)
    }));
    await writeJsonAtomic(this.config.filePath, serialized);
  }
}

function normalizeTags(tags: string[] | undefined): Array<"important" | "normal"> {
  const output: Array<"important" | "normal"> = [];
  for (const tag of tags ?? []) {
    if ((tag === "important" || tag === "normal") && !output.includes(tag)) {
      output.push(tag);
    }
  }
  if (output.includes("important")) return ["important"];
  if (output.includes("normal")) return ["normal"];
  return ["normal"];
}
