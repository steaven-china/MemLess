import { InvertedIndex } from "../InvertedIndex.js";
import type { IBlockStore } from "../store/IBlockStore.js";
import type { IBlockRetriever } from "./IBlockRetriever.js";
import type { RetrievalHit, RetrievalInput } from "./types.js";

export class KeywordRetriever implements IBlockRetriever {
  constructor(
    private readonly index: InvertedIndex,
    private readonly blockStore: IBlockStore
  ) {}

  async retrieve(input: RetrievalInput): Promise<RetrievalHit[]> {
    const candidateIds = this.index.lookup(input.keywords);
    if (candidateIds.size === 0) return [];
    const blocks = await this.blockStore.getMany([...candidateIds]);
    const result: RetrievalHit[] = [];
    for (const block of blocks) {
      const overlap = countOverlap(input.keywords, block.keywords);
      // Jaccard-style denominator: penalises blocks whose keyword set is much
      // larger than the query's, preventing large unfocused blocks from
      // dominating recall over short, focused ones.
      const union = countUnion(input.keywords, block.keywords);
      const score = union === 0 ? 0 : overlap / union;
      result.push({ blockId: block.id, score, source: "keyword", block });
    }
    return result.sort((a, b) => b.score - a.score).slice(0, input.topK);
  }
}

function countOverlap(left: string[], right: string[]): number {
  const rightSet = new Set(right.map((item) => item.toLowerCase()));
  return left.reduce((sum, item) => sum + Number(rightSet.has(item.toLowerCase())), 0);
}

function countUnion(left: string[], right: string[]): number {
  const union = new Set([
    ...left.map((s) => s.toLowerCase()),
    ...right.map((s) => s.toLowerCase())
  ]);
  return union.size;
}
