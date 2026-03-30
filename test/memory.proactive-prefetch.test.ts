import { afterEach, describe, expect, test } from "vitest";

import { createRuntime, type Runtime } from "../src/container.js";
import type { PredictedIntent, PredictionResult } from "../src/types.js";
import { createId } from "../src/utils/id.js";

type InternalManager = {
  deps: {
    embedder: { embed(text: string): number[] };
    blockStore: {
      get(blockId: string): Promise<{ embedding: number[] } | undefined>;
      list(): Promise<Array<{ id: string }>>;
    };
    hybridRetriever: {
      retrieve(input: unknown): Promise<{
        scores: Map<string, number>;
        semanticSeedIds: string[];
        graphHitIds?: string[];
        graphHitConfidenceAvg?: number;
      }>;
    };
    predictor: { predict(seedIds: string[]): Promise<PredictionResult | undefined> };
  };
  firstMessageUtc?: number;
  lastMessageUtc?: number;
  prevMessageUtc?: number;
  lastTriggerUtc: number;
  prefetchedIntents: Map<string, { confidence: number; createdAtUtc: number }>;
  lowEntropyStreak: number;
  lastLowEntropySoftUtc: number;
  lastLowEntropyHardUtc: number;
};

describe("Proactive prefetch path", () => {
  let runtime: Runtime | undefined;

  afterEach(async () => {
    if (runtime) {
      await runtime.close();
      runtime = undefined;
    }
  });

  test("stages predictive boost and applies it on next retrieval", async () => {
    runtime = createRuntime({
      manager: {
        predictionEnabled: true,
        predictionBoostWeight: 0.4
      },
      component: {
        chunkStrategy: "fixed"
      }
    });

    const now = Date.now();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "prefetch anchor block",
      timestamp: now - 1000
    });
    await runtime.memoryManager.sealCurrentBlock();

    const internal = runtime.memoryManager as unknown as InternalManager;
    const blocks = await internal.deps.blockStore.list();
    const blockId = blocks[0]?.id;
    expect(blockId).toBeDefined();

    const block = await internal.deps.blockStore.get(blockId as string);
    expect(block).toBeDefined();
    if (block) {
      block.embedding = [1, 0, 0];
    }
    internal.deps.embedder.embed = () => [1, 0, 0];
    internal.deps.hybridRetriever.retrieve = async () => ({
      scores: new Map([[blockId as string, 1]]),
      semanticSeedIds: [blockId as string]
    });
    internal.deps.predictor.predict = async () => ({
      vector: [1, 0, 0],
      intents: [{ blockId: blockId as string, label: "prefetch", confidence: 0.9 }],
      activeTrigger: true,
      transitionProbabilities: [{ blockId: blockId as string, probability: 0.9 }]
    });

    const nowUtc = Math.floor(Date.now() / 1000);
    internal.firstMessageUtc = nowUtc - 1200;
    internal.lastMessageUtc = nowUtc - 600;
    internal.prevMessageUtc = nowUtc - 600;
    internal.lastTriggerUtc = 0;
    internal.prefetchedIntents.clear();

    const first = await runtime.memoryManager.getContext("q1");
    const firstScore = first.blocks[0]?.score ?? 0;
    expect(first.prediction?.activeTrigger).toBe(false);
    expect(internal.prefetchedIntents.size).toBeGreaterThan(0);
    expect(firstScore).toBe(1);

    const second = await runtime.memoryManager.getContext("q2");
    const secondScore = second.blocks[0]?.score ?? 0;
    expect(secondScore).toBeGreaterThan(firstScore);
    expect(internal.prefetchedIntents.size).toBe(0);
  });
});
