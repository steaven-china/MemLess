import { createHash } from "node:crypto";

import type { MemoryBlock } from "../MemoryBlock.js";

export interface ChunkManifest {
  id: string;
  blockIds: string[];
  startTime: number;
  endTime: number;
  tokenStart: number;
  tokenEnd: number;
  sourceHash: string;
}

export interface ChunkManifestIndexConfig {
  enabled: boolean;
  targetTokens: number;
  maxTokens: number;
  maxBlocks: number;
  maxGapMs: number;
  chunkIdFactory?: () => string;
}

export class ChunkManifestIndex {
  private readonly manifests: ChunkManifest[] = [];
  private readonly manifestById = new Map<string, ChunkManifest>();
  private readonly chunkIdByBlockId = new Map<string, string>();
  private readonly tailBlockByChunkId = new Map<string, MemoryBlock>();
  private totalTokens = 0;

  constructor(private readonly config: ChunkManifestIndexConfig) {}

  reset(): void {
    this.manifests.splice(0, this.manifests.length);
    this.manifestById.clear();
    this.chunkIdByBlockId.clear();
    this.tailBlockByChunkId.clear();
    this.totalTokens = 0;
  }

  rebuild(blocks: MemoryBlock[]): void {
    this.reset();
    if (!this.config.enabled) return;
    const sorted = [...blocks].sort((left, right) => left.startTime - right.startTime);
    for (const block of sorted) {
      this.addBlock(block);
    }
  }

  addBlock(block: MemoryBlock): ChunkManifest | undefined {
    if (!this.config.enabled) return undefined;
    if (this.chunkIdByBlockId.has(block.id)) {
      return this.getChunkByBlockId(block.id);
    }

    const latest = this.manifests[this.manifests.length - 1];
    if (!latest || this.shouldStartNewChunk(latest, block)) {
      return this.createChunk(block);
    }

    this.appendBlock(latest, block);
    return latest;
  }

  getChunkByBlockId(blockId: string): ChunkManifest | undefined {
    const chunkId = this.chunkIdByBlockId.get(blockId);
    if (!chunkId) return undefined;
    return this.manifestById.get(chunkId);
  }

  getNeighborBlockIds(blockId: string, window: number): string[] {
    if (!this.config.enabled) return [];
    if (window <= 0) return [];
    const chunk = this.getChunkByBlockId(blockId);
    if (!chunk) return [];
    const index = chunk.blockIds.indexOf(blockId);
    if (index < 0) return [];

    const neighbors: string[] = [];
    for (let distance = 1; distance <= window; distance += 1) {
      const left = chunk.blockIds[index - distance];
      if (left) neighbors.push(left);
      const right = chunk.blockIds[index + distance];
      if (right) neighbors.push(right);
    }
    return neighbors;
  }

  list(): ChunkManifest[] {
    return [...this.manifests];
  }

  private createChunk(block: MemoryBlock): ChunkManifest {
    const blockTokens = normalizeTokens(block.tokenCount);
    const chunkId = this.nextChunkId();
    const tokenStart = this.totalTokens;
    const tokenEnd = tokenStart + blockTokens;
    this.totalTokens = tokenEnd;

    const chunk: ChunkManifest = {
      id: chunkId,
      blockIds: [block.id],
      startTime: block.startTime,
      endTime: block.endTime,
      tokenStart,
      tokenEnd,
      sourceHash: ""
    };
    chunk.sourceHash = hashChunk(chunk);

    this.manifests.push(chunk);
    this.manifestById.set(chunk.id, chunk);
    this.chunkIdByBlockId.set(block.id, chunk.id);
    this.tailBlockByChunkId.set(chunk.id, block);
    return chunk;
  }

  private appendBlock(chunk: ChunkManifest, block: MemoryBlock): void {
    const blockTokens = normalizeTokens(block.tokenCount);
    chunk.blockIds.push(block.id);
    chunk.endTime = Math.max(chunk.endTime, block.endTime);
    chunk.tokenEnd += blockTokens;
    chunk.sourceHash = hashChunk(chunk);
    this.totalTokens = Math.max(this.totalTokens, chunk.tokenEnd);
    this.chunkIdByBlockId.set(block.id, chunk.id);
    this.tailBlockByChunkId.set(chunk.id, block);
  }

  private shouldStartNewChunk(chunk: ChunkManifest, nextBlock: MemoryBlock): boolean {
    const chunkTokens = chunk.tokenEnd - chunk.tokenStart;
    const nextTokens = normalizeTokens(nextBlock.tokenCount);
    if (this.config.maxGapMs > 0 && nextBlock.startTime - chunk.endTime > this.config.maxGapMs) {
      return true;
    }
    const reachedTarget = this.config.targetTokens > 0 && chunkTokens >= this.config.targetTokens;
    const exceedTarget = this.config.targetTokens > 0 && chunkTokens + nextTokens > this.config.targetTokens;
    const exceedMaxTokens = this.config.maxTokens > 0 && chunkTokens + nextTokens > this.config.maxTokens;
    const exceedMaxBlocks = this.config.maxBlocks > 0 && chunk.blockIds.length >= this.config.maxBlocks;
    const boundaryHit = reachedTarget || exceedTarget || exceedMaxTokens || exceedMaxBlocks;
    if (!boundaryHit) return false;

    const tailBlock = this.tailBlockByChunkId.get(chunk.id);
    return !isContinuousChain(tailBlock, nextBlock);
  }

  private nextChunkId(): string {
    const fromConfig = this.config.chunkIdFactory?.();
    if (fromConfig) return fromConfig;
    return `chunk-${this.manifests.length + 1}`;
  }
}

function normalizeTokens(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.trunc(value));
}

function hashChunk(chunk: ChunkManifest): string {
  const hash = createHash("sha1");
  hash.update(chunk.id);
  hash.update("|");
  hash.update(chunk.blockIds.join(","));
  hash.update("|");
  hash.update(String(chunk.startTime));
  hash.update("|");
  hash.update(String(chunk.endTime));
  hash.update("|");
  hash.update(String(chunk.tokenStart));
  hash.update("|");
  hash.update(String(chunk.tokenEnd));
  return hash.digest("hex").slice(0, 16);
}

function isContinuousChain(previous: MemoryBlock | undefined, next: MemoryBlock): boolean {
  if (!previous) return false;
  const left = new Set(previous.keywords.map((keyword) => keyword.toLowerCase()));
  const right = new Set(next.keywords.map((keyword) => keyword.toLowerCase()));
  if (left.size === 0 || right.size === 0) return false;

  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  const minSize = Math.max(1, Math.min(left.size, right.size));
  return overlap / minSize >= 0.34;
}
