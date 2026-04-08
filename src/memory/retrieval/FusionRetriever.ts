import type { IBlockRetriever } from "./IBlockRetriever.js";
import type { RetrievalHit, RetrievalInput, RetrievalSource } from "./types.js";

export interface WeightedRetriever {
  source: RetrievalSource;
  retriever: IBlockRetriever;
  weight: number;
}

/**
 * Reciprocal Rank Fusion (RRF) based multi-retriever fusion.
 *
 * RRF score for a document d across retrievers:
 *   score(d) = Σ_r  weight_r / (k + rank_r(d))
 *
 * where k=60 is the standard smoothing constant that prevents top-ranked
 * documents from dominating excessively.  Using rank rather than raw scores
 * eliminates cross-retriever score scale differences (keyword overlap [0,1]
 * vs cosine similarity [0,1] with different effective ranges).
 *
 * Documents appearing in multiple retrievers naturally get higher scores.
 */
export class FusionRetriever implements IBlockRetriever {
  private static readonly RRF_K = 60;

  constructor(private readonly retrievers: WeightedRetriever[]) {}

  async retrieve(input: RetrievalInput): Promise<RetrievalHit[]> {
    const rrfScores = new Map<string, number>();
    const hitMeta = new Map<string, { hit: RetrievalHit; sourceCount: number }>();

    const allResults = await Promise.all(
      this.retrievers.map(async (item) => ({
        weight: item.weight,
        hits: await item.retriever.retrieve(input)
      }))
    );

    for (const { weight, hits } of allResults) {
      for (let rank = 0; rank < hits.length; rank += 1) {
        const hit = hits[rank];
        const rrf = weight / (FusionRetriever.RRF_K + rank + 1);
        rrfScores.set(hit.blockId, (rrfScores.get(hit.blockId) ?? 0) + rrf);
        const existing = hitMeta.get(hit.blockId);
        if (!existing) {
          hitMeta.set(hit.blockId, { hit, sourceCount: 1 });
        } else {
          existing.sourceCount += 1;
          if (!existing.hit.block && hit.block) existing.hit.block = hit.block;
        }
      }
    }

    return [...hitMeta.entries()]
      .map(([blockId, meta]) => ({
        ...meta.hit,
        score: rrfScores.get(blockId) ?? 0
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (hitMeta.get(b.blockId)?.sourceCount ?? 0) -
               (hitMeta.get(a.blockId)?.sourceCount ?? 0);
      })
      .slice(0, input.topK);
  }
}
