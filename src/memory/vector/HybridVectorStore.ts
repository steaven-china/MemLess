import type { BlockRef } from "../../types.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import type { IVectorStore } from "./IVectorStore.js";
import type { HybridEmbedder } from "../embedder/HybridEmbedder.js";
import type { IBlockStore } from "../store/IBlockStore.js";

/**
 * HybridVectorStore: 使用 HybridEmbedder 的两阶段检索
 *
 * 策略：
 * - 所有块的向量已经是混合格式（hash + local）
 * - 检索时调用 HybridEmbedder.hybridSearch() 做自适应初筛+重排
 * - 比 InMemoryVectorStore 更智能，速度和准确率都有提升
 */
export class HybridVectorStore implements IVectorStore {
  private readonly blocks = new Map<string, MemoryBlock>();

  constructor(
    private readonly embedder: HybridEmbedder,
    private readonly blockStore: IBlockStore
  ) {}

  async add(block: MemoryBlock): Promise<void> {
    this.blocks.set(block.id, block);
  }

  async remove(blockId: string): Promise<void> {
    this.blocks.delete(blockId);
  }

  async search(queryVec: number[], topK: number): Promise<BlockRef[]> {
    if (topK <= 0 || this.blocks.size === 0) return [];

    // 准备候选向量
    const candidates = Array.from(this.blocks.values()).map(block => ({
      id: block.id,
      vec: block.embedding
    }));

    // 调用 HybridEmbedder 的自适应检索
    const results = this.embedder.hybridSearch(queryVec, candidates, topK);

    // 转换为 BlockRef 格式
    return results.map(({ id, score }) => {
      const block = this.blocks.get(id)!;
      return {
        id,
        score,
        source: "vector" as const,
        summary: block.summary ?? "",
        startTime: block.startTime,
        endTime: block.endTime,
        keywords: block.keywords,
        rawEvents: block.rawEvents,
        retentionMode: block.retentionMode,
        matchScore: block.matchScore,
        conflict: block.conflict
      };
    });
  }
}
