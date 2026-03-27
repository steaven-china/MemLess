import type { BlockRef } from "../../types.js";
import { cosineSimilarity } from "../../utils/text.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import type { IVectorStore } from "./IVectorStore.js";
import { AnnCosineIndex } from "./AnnCosineIndex.js";

export class InMemoryVectorStore implements IVectorStore {
  private blocks = new Map<string, MemoryBlock>();
  private annIndex?: AnnCosineIndex;
  private annDimension?: number;

  add(block: MemoryBlock): void {
    this.blocks.set(block.id, block);
    if (block.embedding.length === 0) return;
    if (this.annDimension === undefined) {
      this.annDimension = block.embedding.length;
      this.annIndex = new AnnCosineIndex({ dimension: this.annDimension });
    }
    if (!this.annIndex || block.embedding.length !== this.annDimension) return;
    this.annIndex.upsert(block.id, block.embedding);
  }

  remove(blockId: string): void {
    this.blocks.delete(blockId);
    this.annIndex?.remove(blockId);
  }

  async search(vector: number[], topK: number): Promise<BlockRef[]> {
    if (topK <= 0) return [];

    const scored: Array<{ block: MemoryBlock; score: number }> = [];
    if (
      this.annIndex &&
      this.annDimension !== undefined &&
      vector.length === this.annDimension
    ) {
      const annRefs = this.annIndex.search(vector, topK * 8, {
        candidateMultiplier: 8
      });
      for (const ref of annRefs) {
        const block = this.blocks.get(ref.id);
        if (!block) continue;
        scored.push({ block, score: ref.score });
      }

      if (scored.length < topK) {
        const seen = new Set(scored.map((item) => item.block.id));
        for (const block of this.blocks.values()) {
          if (seen.has(block.id)) continue;
          if (block.embedding.length !== this.annDimension) continue;
          scored.push({
            block,
            score: cosineSimilarity(vector, block.embedding)
          });
        }
      }
    } else {
      for (const block of this.blocks.values()) {
        if (block.embedding.length === 0 || block.embedding.length !== vector.length) continue;
        const score = cosineSimilarity(vector, block.embedding);
        scored.push({ block, score });
      }
    }

    scored.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.block.id.localeCompare(right.block.id);
    });

    return scored.slice(0, topK).map(({ block, score }) => ({
      id: block.id,
      score,
      source: "vector",
      summary: block.summary,
      startTime: block.startTime,
      endTime: block.endTime,
      keywords: block.keywords,
      rawEvents: block.rawEvents,
      retentionMode: block.retentionMode,
      matchScore: block.matchScore,
      conflict: block.conflict
    }));
  }
}
