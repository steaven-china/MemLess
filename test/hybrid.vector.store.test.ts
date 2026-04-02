import { describe, expect, test, vi } from "vitest";

import { MemoryBlock } from "../src/memory/MemoryBlock.js";
import type { HybridEmbedder } from "../src/memory/embedder/HybridEmbedder.js";
import type { IBlockStore } from "../src/memory/store/IBlockStore.js";
import {
  HybridVectorStore,
  type HybridVectorStoreOptions
} from "../src/memory/vector/HybridVectorStore.js";

class FakeBlockStore implements IBlockStore {
  private readonly blocks = new Map<string, MemoryBlock>();
  public readonly getManyCalls: string[][] = [];

  async upsert(block: MemoryBlock): Promise<void> {
    this.blocks.set(block.id, block);
  }

  async get(blockId: string): Promise<MemoryBlock | undefined> {
    return this.blocks.get(blockId);
  }

  async getMany(blockIds: string[]): Promise<MemoryBlock[]> {
    this.getManyCalls.push([...blockIds]);
    return blockIds
      .map((blockId) => this.blocks.get(blockId))
      .filter((block): block is MemoryBlock => Boolean(block));
  }

  async list(): Promise<MemoryBlock[]> {
    return [...this.blocks.values()];
  }
}

function makeOptions(overrides: Partial<HybridVectorStoreOptions> = {}): HybridVectorStoreOptions {
  return {
    prescreenRatio: 0.05,
    prescreenMin: 20,
    prescreenMax: 100,
    rerankMultiplier: 3,
    localCacheMaxEntries: 2000,
    localCacheTtlMs: 300_000,
    ...overrides
  };
}

function makeHashVector(index: number): number[] {
  const vec = new Array(256).fill(0);
  vec[0] = 1;
  vec[1] = index * 0.01;
  return vec;
}

function makeLocalVector(index: number): number[] {
  const vec = new Array(768).fill(0);
  vec[0] = 1;
  vec[1] = index * 0.02;
  return vec;
}

function makeQuery(localEnabled: boolean): number[] {
  const query = new Array(1024).fill(0);
  query[0] = 1;
  if (localEnabled) {
    query[256] = 1;
  }
  return query;
}

function makeBlock(blockId: string, index: number): MemoryBlock {
  const block = new MemoryBlock(blockId);
  block.summary = `summary-${blockId}`;
  block.rawEvents = [{ id: `event-${blockId}`, role: "user", text: `raw-${blockId}`, timestamp: index + 1 }];
  block.embedding = [...makeHashVector(index), ...new Array(768).fill(0)];
  return block;
}

async function prepareStore(input: {
  count: number;
  options?: Partial<HybridVectorStoreOptions>;
  embedLocalBatch?: (texts: string[]) => Promise<number[][]>;
}): Promise<{
  vectorStore: HybridVectorStore;
  blockStore: FakeBlockStore;
  embedLocalBatchMock: ReturnType<typeof vi.fn>;
}> {
  const blockStore = new FakeBlockStore();
  const embedLocalBatchMock = vi.fn(
    input.embedLocalBatch ??
      (async (texts: string[]) => texts.map((_, index) => makeLocalVector(index + 1)))
  );
  const embedder = {
    dimension: 1024,
    hashDimension: 256,
    localDimension: 768,
    embedLocalBatch: embedLocalBatchMock
  } as unknown as HybridEmbedder;

  const vectorStore = new HybridVectorStore(embedder, blockStore, makeOptions(input.options));
  for (let index = 0; index < input.count; index += 1) {
    const block = makeBlock(`b-${index}`, index);
    await blockStore.upsert(block);
    await vectorStore.add(block);
  }

  return { vectorStore, blockStore, embedLocalBatchMock };
}

describe("HybridVectorStore", () => {
  test("respects prescreen min/max bounds", async () => {
    const lowTotal = await prepareStore({
      count: 10,
      options: { prescreenRatio: 0.01, prescreenMin: 20, prescreenMax: 100, rerankMultiplier: 10, rerankHardCap: 100 }
    });
    await lowTotal.vectorStore.search(makeQuery(true), 10);
    expect(lowTotal.blockStore.getManyCalls[0]?.length).toBe(10);

    const highTotal = await prepareStore({
      count: 600,
      options: { prescreenRatio: 0.8, prescreenMin: 20, prescreenMax: 40, rerankMultiplier: 10, rerankHardCap: 100 }
    });
    await highTotal.vectorStore.search(makeQuery(true), 20);
    expect(highTotal.blockStore.getManyCalls[0]?.length).toBe(40);
  });

  test("uses rerankCount = topK * multiplier", async () => {
    const { vectorStore, embedLocalBatchMock } = await prepareStore({
      count: 120,
      options: { prescreenRatio: 1, prescreenMin: 1, prescreenMax: 120, rerankMultiplier: 2 }
    });

    await vectorStore.search(makeQuery(true), 5);
    const firstCallArgs = embedLocalBatchMock.mock.calls[0]?.[0] as string[] | undefined;
    expect(firstCallArgs?.length).toBe(10);
  });

  test("branches by query local/non-local path", async () => {
    const { vectorStore, embedLocalBatchMock } = await prepareStore({
      count: 50,
      options: { prescreenRatio: 1, prescreenMin: 1, prescreenMax: 50, rerankMultiplier: 3 }
    });

    await vectorStore.search(makeQuery(false), 5);
    expect(embedLocalBatchMock).toHaveBeenCalledTimes(0);

    await vectorStore.search(makeQuery(true), 5);
    expect(embedLocalBatchMock).toHaveBeenCalledTimes(1);
  });

  test("uses query local dimension for rerank compatibility", async () => {
    const { vectorStore, blockStore } = await prepareStore({
      count: 2,
      options: {
        prescreenRatio: 1,
        prescreenMin: 2,
        prescreenMax: 2,
        rerankMultiplier: 2,
        rerankHardCap: 10,
        hashEarlyStopMinGap: 0
      },
      embedLocalBatch: async (texts: string[]) =>
        texts.map((text) => (text.includes("b-0") ? [1, 0] : [0, 1]))
    });

    const block0 = makeBlock("b-0", 0);
    block0.embedding = [...new Array(256).fill(0), ...new Array(768).fill(0)];
    block0.embedding[0] = 1;
    await blockStore.upsert(block0);
    await vectorStore.add(block0);

    const block1 = makeBlock("b-1", 1);
    block1.embedding = [...new Array(256).fill(0), ...new Array(768).fill(0)];
    block1.embedding[1] = 1;
    await blockStore.upsert(block1);
    await vectorStore.add(block1);

    const query = [...new Array(256).fill(0), 1, 0];
    query[1] = 1;
    const hits = await vectorStore.search(query, 1);
    expect(hits[0]?.id).toBe("b-0");
  });

  test("reuses local cache and invalidates cache on block update", async () => {
    const { vectorStore, blockStore, embedLocalBatchMock } = await prepareStore({
      count: 5,
      options: { prescreenRatio: 1, prescreenMin: 1, prescreenMax: 5, rerankMultiplier: 1 }
    });

    await vectorStore.search(makeQuery(true), 1);
    expect(embedLocalBatchMock).toHaveBeenCalledTimes(1);

    await vectorStore.search(makeQuery(true), 1);
    expect(embedLocalBatchMock).toHaveBeenCalledTimes(1);

    const updated = makeBlock("b-0", 0);
    updated.summary = "summary-updated";
    await blockStore.upsert(updated);
    await vectorStore.add(updated);

    await vectorStore.search(makeQuery(true), 1);
    expect(embedLocalBatchMock).toHaveBeenCalledTimes(2);
    const secondCallArgs = embedLocalBatchMock.mock.calls[1]?.[0] as string[] | undefined;
    expect(secondCallArgs?.length).toBe(1);
  });

  test("skips local rerank when hash ranking is already decisive", async () => {
    const { vectorStore, blockStore, embedLocalBatchMock } = await prepareStore({
      count: 3,
      options: { prescreenRatio: 1, prescreenMin: 1, prescreenMax: 3, rerankMultiplier: 3, hashEarlyStopMinGap: 0.5 }
    });

    const strong = makeBlock("b-0", 0);
    strong.embedding = [...new Array(256).fill(0), ...new Array(768).fill(0)];
    strong.embedding[0] = 1;
    await blockStore.upsert(strong);
    await vectorStore.add(strong);

    const weak1 = makeBlock("b-1", 1);
    weak1.embedding = [...new Array(256).fill(0), ...new Array(768).fill(0)];
    weak1.embedding[1] = 1;
    await blockStore.upsert(weak1);
    await vectorStore.add(weak1);

    const weak2 = makeBlock("b-2", 2);
    weak2.embedding = [...new Array(256).fill(0), ...new Array(768).fill(0)];
    weak2.embedding[2] = 1;
    await blockStore.upsert(weak2);
    await vectorStore.add(weak2);

    const query = new Array(1024).fill(0);
    query[0] = 1;
    query[256] = 1;
    const hits = await vectorStore.search(query, 1);

    expect(hits[0]?.id).toBe("b-0");
    expect(embedLocalBatchMock).toHaveBeenCalledTimes(0);
  });

  test("falls back to hash scores when local rerank times out", async () => {
    const { vectorStore } = await prepareStore({
      count: 12,
      options: {
        prescreenRatio: 1,
        prescreenMin: 1,
        prescreenMax: 12,
        rerankMultiplier: 2,
        hashEarlyStopMinGap: 0,
        localRerankTimeoutMs: 1
      },
      embedLocalBatch: async (texts: string[]) =>
        await new Promise<number[][]>((resolve) => {
          setTimeout(() => {
            resolve(texts.map(() => makeLocalVector(1)));
          }, 20);
        })
    });

    const result = await vectorStore.search(makeQuery(true), 3);
    expect(result.length).toBe(3);
  });

  test("clips rerank text length before local embedding", async () => {
    const { vectorStore, blockStore, embedLocalBatchMock } = await prepareStore({
      count: 1,
      options: {
        prescreenRatio: 1,
        prescreenMin: 1,
        prescreenMax: 1,
        rerankMultiplier: 1,
        hashEarlyStopMinGap: 0,
        rerankTextMaxChars: 20
      }
    });

    const block = makeBlock("b-0", 0);
    block.summary = "summary-" + "x".repeat(100);
    block.rawEvents = [{ id: "event-b-0", role: "user", text: "raw-" + "y".repeat(100), timestamp: 1 }];
    block.embedding = [...makeHashVector(0), ...new Array(768).fill(0)];
    await blockStore.upsert(block);
    await vectorStore.add(block);

    await vectorStore.search(makeQuery(true), 1);
    const sentTexts = embedLocalBatchMock.mock.calls[0]?.[0] as string[] | undefined;
    expect(sentTexts?.[0]?.length).toBeLessThanOrEqual(20);
  });
});
