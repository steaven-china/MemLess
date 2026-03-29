import type { ManagerConfig, PredictionResult } from "../../types.js";
import type { IBlockStore } from "../store/IBlockStore.js";
import type { RelationGraph } from "../RelationGraph.js";
import type { IGraphEmbedder } from "./GraphEmbedder.js";
import { IntentDecoder, sortTransitionEntries } from "./IntentDecoder.js";
import { WeightedRandomWalk } from "./WeightedRandomWalk.js";

export interface PredictorEngineDeps {
  config: ManagerConfig;
  relationGraph: RelationGraph;
  blockStore: IBlockStore;
  graphEmbedder: IGraphEmbedder;
}

export class PredictorEngine {
  private readonly decoder = new IntentDecoder();
  private readonly walker: WeightedRandomWalk;

  constructor(private readonly deps: PredictorEngineDeps) {
    this.walker = new WeightedRandomWalk({
      depth: deps.config.predictionWalkDepth,
      transitionDecay: deps.config.predictionTransitionDecay
    });
  }

  async predict(seedBlockIds: string[]): Promise<PredictionResult | undefined> {
    if (!this.deps.config.predictionEnabled) return undefined;
    const blocks = await this.deps.blockStore.list();
    if (blocks.length === 0) return undefined;

    const seeds = seedBlockIds.filter((id) => blocks.some((block) => block.id === id));
    if (seeds.length === 0) return undefined;

    const graphEmbedding = this.deps.graphEmbedder.train(blocks, this.deps.relationGraph);
    const transition = this.walker.walk(seeds, this.deps.relationGraph);

    const weightedVector = buildWeightedVector(transition, graphEmbedding.nodeEmbeddings, graphEmbedding.dimension);
    const blockById = new Map(blocks.map((block) => [block.id, block]));
    const intents = this.decoder.decode(transition, blockById, this.deps.config.predictionTopK);
    const activeTrigger =
      this.deps.config.predictionForceActiveTrigger ||
      (intents[0]?.confidence ?? 0) >= this.deps.config.predictionActiveThreshold;

    return {
      vector: weightedVector,
      intents,
      activeTrigger,
      transitionProbabilities: sortTransitionEntries(transition)
        .slice(0, this.deps.config.predictionTopK)
        .map(([blockId, probability]) => ({ blockId, probability }))
    };
  }
}

function buildWeightedVector(
  transition: Map<string, number>,
  nodeEmbeddings: Map<string, number[]>,
  dimension: number
): number[] {
  const vector = new Array(dimension).fill(0);
  for (const [blockId, probability] of transition.entries()) {
    const embedding = nodeEmbeddings.get(blockId);
    if (!embedding) continue;
    for (let index = 0; index < dimension; index += 1) {
      vector[index] += (embedding[index] ?? 0) * probability;
    }
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}
