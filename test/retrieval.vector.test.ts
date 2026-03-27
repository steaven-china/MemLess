import { describe, expect, test } from "vitest";

import type { BlockRef } from "../src/types.js";
import { VectorRetriever } from "../src/memory/retrieval/VectorRetriever.js";
import type { RetrievalInput } from "../src/memory/retrieval/types.js";
import { MemoryBlock } from "../src/memory/MemoryBlock.js";
import type { IVectorStore } from "../src/memory/vector/IVectorStore.js";
import type { IBlockStore } from "../src/memory/store/IBlockStore.js";

class StaticVectorStore implements IVectorStore {
  constructor(private readonly refs: BlockRef[]) {}

  add(): void {}

  remove(): void {}

  async search(_vector: number[], _topK: number): Promise<BlockRef[]> {
    return this.refs;
  }
}

class StaticBlockStore implements IBlockStore {
  private readonly blocks = new Map<string, MemoryBlock>();
  public getCalls = 0;
  public getManyCalls = 0;

  constructor(blockIds: string[]) {
    for (const blockId of blockIds) {
      this.blocks.set(blockId, new MemoryBlock(blockId));
    }
  }

  async upsert(): Promise<void> {}

  async get(blockId: string): Promise<MemoryBlock | undefined> {
    this.getCalls += 1;
    return this.blocks.get(blockId);
  }

  async getMany(blockIds: string[]): Promise<MemoryBlock[]> {
    this.getManyCalls += 1;
    return blockIds
      .map((blockId) => this.blocks.get(blockId))
      .filter((block): block is MemoryBlock => Boolean(block));
  }

  async list(): Promise<MemoryBlock[]> {
    return [...this.blocks.values()];
  }
}

function makeRef(id: string, score: number): BlockRef {
  return {
    id,
    score,
    source: "vector",
    summary: id,
    startTime: 0,
    endTime: 0,
    keywords: []
  };
}

const INPUT: RetrievalInput = {
  query: "q",
  keywords: [],
  embedding: [1, 0],
  topK: 3
};

describe("VectorRetriever", () => {
  test("falls back to original refs when min-score filter removes everything", async () => {
    const retriever = new VectorRetriever(
      new StaticVectorStore([makeRef("a", 0.2), makeRef("b", 0.1)]),
      new StaticBlockStore(["a", "b"]),
      0.5
    );

    const hits = await retriever.retrieve(INPUT);
    expect(hits.map((hit) => hit.blockId)).toEqual(["a", "b"]);
  });

  test("keeps min-score filtering when at least one ref passes", async () => {
    const retriever = new VectorRetriever(
      new StaticVectorStore([makeRef("a", 0.9), makeRef("b", 0.1)]),
      new StaticBlockStore(["a", "b"]),
      0.5
    );

    const hits = await retriever.retrieve(INPUT);
    expect(hits.map((hit) => hit.blockId)).toEqual(["a"]);
  });

  test("uses getMany for block hydration", async () => {
    const blockStore = new StaticBlockStore(["a", "b"]);
    const retriever = new VectorRetriever(
      new StaticVectorStore([makeRef("a", 0.9), makeRef("b", 0.8)]),
      blockStore,
      0
    );

    const hits = await retriever.retrieve(INPUT);
    expect(hits.map((hit) => hit.blockId)).toEqual(["a", "b"]);
    expect(blockStore.getCalls).toBe(0);
    expect(blockStore.getManyCalls).toBe(1);
  });
});
