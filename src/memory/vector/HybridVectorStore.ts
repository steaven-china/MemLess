import type { BlockRef } from "../../types.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import type { IVectorStore } from "./IVectorStore.js";
import type { HybridEmbedder } from "../embedder/HybridEmbedder.js";
import type { IBlockStore } from "../store/IBlockStore.js";

export interface HybridVectorStoreOptions {
  prescreenRatio: number;
  prescreenMin: number;
  prescreenMax: number;
  rerankMultiplier: number;
  localCacheMaxEntries: number;
  localCacheTtlMs: number;
  nowMs?: () => number;
  trace?: (event: string, payload: Record<string, unknown>) => void;
}

interface LocalCacheEntry {
  vec: number[];
  expiresAt: number;
}

/**
 * HybridVectorStore: 粗推算 + 按需向量筛选
 *
 * 架构：
 * - 封块时：只存 hash 向量（极快，无 local 推理）
 * - 查询时：
 *   1. hash 全量扫描 → top-prescreenK（粗推算，毫秒级）
 *   2. 取这些块的原文 → 批量 local.embed（向量筛选，一次批推理）
 *   3. query.local vs 候选.local → 重排 → top-K
 *
 * 效果：
 * - 封块速度：等同于纯 hash（不再有 local 推理开销）
 * - 查询精度：等同于 local（语义检索）
 * - 查询延迟：prescreenK 次文本的一次批推理，通常 100-300ms
 */
export class HybridVectorStore implements IVectorStore {
  private readonly hashVecs = new Map<string, number[]>();
  private readonly localCache = new Map<string, LocalCacheEntry>();
  private readonly hashDim: number;
  private readonly localDim: number;
  private readonly prescreenRatio: number;
  private readonly prescreenMin: number;
  private readonly prescreenMax: number;
  private readonly rerankMultiplier: number;
  private readonly localCacheMaxEntries: number;
  private readonly localCacheTtlMs: number;
  private readonly nowMs: () => number;
  private readonly trace: (event: string, payload: Record<string, unknown>) => void;

  constructor(
    private readonly embedder: HybridEmbedder,
    private readonly blockStore: IBlockStore,
    options: HybridVectorStoreOptions
  ) {
    this.hashDim = Math.max(1, embedder.hashDimension);
    this.localDim = Math.max(0, embedder.localDimension);
    this.prescreenRatio = clamp(options.prescreenRatio, 0, 1, 0.05);
    this.prescreenMin = clampInt(options.prescreenMin, 1, Number.MAX_SAFE_INTEGER, 20);
    const prescreenMax = clampInt(options.prescreenMax, this.prescreenMin, Number.MAX_SAFE_INTEGER, 100);
    this.prescreenMax = Math.max(this.prescreenMin, prescreenMax);
    this.rerankMultiplier = Math.max(1, toFiniteNumber(options.rerankMultiplier, 3));
    this.localCacheMaxEntries = clampInt(options.localCacheMaxEntries, 0, Number.MAX_SAFE_INTEGER, 2000);
    this.localCacheTtlMs = clampInt(options.localCacheTtlMs, 0, Number.MAX_SAFE_INTEGER, 300_000);
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.trace = options.trace ?? (() => {});
  }

  async add(block: MemoryBlock): Promise<void> {
    if (block.embedding.length === 0) return;
    this.hashVecs.set(block.id, normalizeVector(block.embedding, this.hashDim));
    this.localCache.delete(block.id);
  }

  async remove(blockId: string): Promise<void> {
    this.hashVecs.delete(blockId);
    this.localCache.delete(blockId);
  }

  async search(queryVec: number[], topK: number): Promise<BlockRef[]> {
    if (topK <= 0 || this.hashVecs.size === 0) return [];

    this.pruneExpiredLocalCache(this.nowMs());
    const query = this.normalizeQueryVector(queryVec);
    const queryHash = query.slice(0, this.hashDim);
    const queryLocal = query.slice(this.hashDim, this.hashDim + this.localDim);
    const queryLocalNonZero = hasNonZero(queryLocal);
    const prescreenK = this.computePrescreenK(this.hashVecs.size);

    const hashScores = Array.from(this.hashVecs.entries()).map(([id, hash]) => ({
      id,
      hashScore: cosineSimilarity(queryHash, hash)
    }));
    hashScores.sort((a, b) => b.hashScore - a.hashScore);
    const prescreened = hashScores.slice(0, prescreenK);

    if (!queryLocalNonZero || this.localDim === 0) {
      return this.hydrateResults(
        prescreened.map((item) => ({ id: item.id, score: item.hashScore })),
        topK
      );
    }

    const rerankCount = Math.min(
      prescreened.length,
      Math.max(1, Math.ceil(topK * this.rerankMultiplier))
    );
    const toRerank = prescreened.slice(0, rerankCount);
    const candidateIds = toRerank.map((candidate) => candidate.id);
    const candidateBlocks = await this.blockStore.getMany(candidateIds);
    const blockMap = new Map(candidateBlocks.map((block) => [block.id, block]));
    const localVecById = new Map<string, number[]>();
    const pendingIds: string[] = [];
    const pendingTexts: string[] = [];
    const nowMs = this.nowMs();

    for (const candidate of toRerank) {
      const cached = this.getLocalCache(candidate.id, nowMs);
      if (cached) {
        localVecById.set(candidate.id, cached);
        continue;
      }

      const candidateBlock = blockMap.get(candidate.id);
      const text = buildSemanticText(candidateBlock);
      if (!text) {
        continue;
      }
      pendingIds.push(candidate.id);
      pendingTexts.push(text);
    }

    if (pendingTexts.length > 0) {
      try {
        const computed = await this.embedder.embedLocalBatch(pendingTexts);
        for (let index = 0; index < pendingIds.length; index += 1) {
          const blockId = pendingIds[index];
          if (!blockId) continue;
          const localVec = computed[index];
          if (!localVec || localVec.length !== this.localDim) {
            this.trace("local.vector.dimension_mismatch", {
              blockId,
              expected: this.localDim,
              actual: Array.isArray(localVec) ? localVec.length : -1
            });
            continue;
          }
          localVecById.set(blockId, localVec);
          this.setLocalCache(blockId, localVec, nowMs);
        }
      } catch (error) {
        this.trace("local.batch_embed.failed", {
          error: toErrorMessage(error),
          candidateCount: pendingTexts.length
        });
        return this.hydrateResults(
          prescreened.map((item) => ({ id: item.id, score: item.hashScore })),
          topK
        );
      }
    }

    const reranked = toRerank.map(({ id, hashScore }) => {
      const localVec = localVecById.get(id);
      const score = localVec && hasNonZero(localVec)
        ? cosineSimilarity(queryLocal, localVec)
        : hashScore;
      return { id, score };
    });
    reranked.sort((left, right) => right.score - left.score);
    return this.hydrateResults(reranked, topK, blockMap);
  }

  private computePrescreenK(total: number): number {
    const byRatio = Math.floor(total * this.prescreenRatio);
    const bounded = Math.max(this.prescreenMin, byRatio);
    return Math.min(total, Math.min(this.prescreenMax, bounded));
  }

  private normalizeQueryVector(queryVec: number[]): number[] {
    const expected = this.hashDim + this.localDim;
    if (queryVec.length === expected) return queryVec;
    this.trace("query.vector.dimension_mismatch", {
      expected,
      actual: queryVec.length
    });
    return normalizeVector(queryVec, expected);
  }

  private pruneExpiredLocalCache(nowMs: number): void {
    if (!this.cacheEnabled()) {
      if (this.localCache.size > 0) {
        this.localCache.clear();
      }
      return;
    }
    for (const [blockId, entry] of this.localCache.entries()) {
      if (entry.expiresAt <= nowMs) {
        this.localCache.delete(blockId);
      }
    }
  }

  private getLocalCache(blockId: string, nowMs: number): number[] | undefined {
    if (!this.cacheEnabled()) return undefined;
    const entry = this.localCache.get(blockId);
    if (!entry) return undefined;
    if (entry.expiresAt <= nowMs) {
      this.localCache.delete(blockId);
      return undefined;
    }
    if (entry.vec.length !== this.localDim) {
      this.trace("local.cache.dimension_mismatch", {
        blockId,
        expected: this.localDim,
        actual: entry.vec.length
      });
      this.localCache.delete(blockId);
      return undefined;
    }
    this.localCache.delete(blockId);
    this.localCache.set(blockId, entry);
    return entry.vec;
  }

  private setLocalCache(blockId: string, vec: number[], nowMs: number): void {
    if (!this.cacheEnabled()) return;
    const expiresAt = nowMs + this.localCacheTtlMs;
    this.localCache.delete(blockId);
    this.localCache.set(blockId, { vec: [...vec], expiresAt });
    while (this.localCache.size > this.localCacheMaxEntries) {
      const oldest = this.localCache.keys().next().value;
      if (!oldest) break;
      this.localCache.delete(oldest);
    }
  }

  private cacheEnabled(): boolean {
    return this.localCacheMaxEntries > 0 && this.localCacheTtlMs > 0;
  }

  private async hydrateResults(
    scored: Array<{ id: string; score: number }>,
    topK: number,
    seededBlocks?: Map<string, MemoryBlock>
  ): Promise<BlockRef[]> {
    const topItems = scored.slice(0, topK);
    if (topItems.length === 0) return [];
    const ids = topItems.map((item) => item.id);
    const blockMap = new Map<string, MemoryBlock>();
    if (seededBlocks) {
      for (const [blockId, block] of seededBlocks.entries()) {
        blockMap.set(blockId, block);
      }
    }
    const missing = ids.filter((id) => !blockMap.has(id));
    if (missing.length > 0) {
      const blocks = await this.blockStore.getMany(missing);
      for (const block of blocks) {
        blockMap.set(block.id, block);
      }
    }

    return topItems.map(({ id, score }) => {
      const block = blockMap.get(id);
      return {
        id,
        score,
        source: "vector" as const,
        summary: block?.summary ?? "",
        startTime: block?.startTime ?? 0,
        endTime: block?.endTime ?? 0,
        keywords: block?.keywords ?? [],
        rawEvents: block?.rawEvents ?? [],
        retentionMode: block?.retentionMode ?? "raw",
        matchScore: block?.matchScore ?? 0,
        conflict: block?.conflict ?? false
      };
    });
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

function normalizeVector(vec: number[], expectedDim: number): number[] {
  if (vec.length === expectedDim) return vec;
  if (vec.length > expectedDim) return vec.slice(0, expectedDim);
  const normalized = new Array(expectedDim).fill(0);
  for (let index = 0; index < vec.length; index += 1) {
    normalized[index] = vec[index] ?? 0;
  }
  return normalized;
}

function hasNonZero(vec: number[]): boolean {
  return vec.some((value) => value !== 0);
}

function toFiniteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  const normalized = toFiniteNumber(value, fallback);
  return Math.min(max, Math.max(min, normalized));
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  const normalized = Math.trunc(toFiniteNumber(value, fallback));
  return Math.min(max, Math.max(min, normalized));
}

function buildSemanticText(block: MemoryBlock | undefined): string {
  if (!block) return "";
  const parts = [block.summary ?? ""];
  for (const rawEvent of block.rawEvents ?? []) {
    parts.push(rawEvent.text);
  }
  return parts.join(" ").trim();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
