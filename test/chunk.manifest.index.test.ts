import { describe, expect, test } from "vitest";

import { MemoryBlock } from "../src/memory/MemoryBlock.js";
import { ChunkManifestIndex } from "../src/memory/output/ChunkManifestIndex.js";

function makeBlock(
  id: string,
  startTime: number,
  tokenCount: number,
  keywords: string[] = []
): MemoryBlock {
  const block = new MemoryBlock(id, startTime);
  block.endTime = startTime + 1;
  block.tokenCount = tokenCount;
  block.keywords = keywords;
  return block;
}

describe("ChunkManifestIndex", () => {
  test("splits into a new chunk when boundary is hit and semantic continuity breaks", () => {
    const index = new ChunkManifestIndex({
      enabled: true,
      targetTokens: 100,
      maxTokens: 180,
      maxBlocks: 8,
      maxGapMs: 10_000
    });

    index.addBlock(makeBlock("b1", 1_000, 40, ["gateway", "timeout"]));
    index.addBlock(makeBlock("b2", 2_000, 50, ["gateway", "retry"]));
    index.addBlock(makeBlock("b3", 3_000, 60, ["invoice", "settlement"]));

    const manifests = index.list();
    expect(manifests.length).toBe(2);
    expect(manifests[0]?.blockIds).toEqual(["b1", "b2"]);
    expect(manifests[1]?.blockIds).toEqual(["b3"]);
  });

  test("allows continuous semantic chain to overflow configured boundaries", () => {
    const index = new ChunkManifestIndex({
      enabled: true,
      targetTokens: 60,
      maxTokens: 80,
      maxBlocks: 2,
      maxGapMs: 10_000
    });

    index.addBlock(makeBlock("b1", 1_000, 30, ["payment", "webhook", "idempotent"]));
    index.addBlock(makeBlock("b2", 2_000, 30, ["payment", "retry", "idempotent"]));
    index.addBlock(makeBlock("b3", 3_000, 30, ["payment", "callback", "idempotent"]));

    const manifests = index.list();
    expect(manifests.length).toBe(1);
    expect(manifests[0]?.blockIds).toEqual(["b1", "b2", "b3"]);
  });

  test("returns neighbor block ids inside the same chunk", () => {
    const index = new ChunkManifestIndex({
      enabled: true,
      targetTokens: 1_000,
      maxTokens: 2_000,
      maxBlocks: 8,
      maxGapMs: 10_000
    });
    index.addBlock(makeBlock("b1", 1_000, 20));
    index.addBlock(makeBlock("b2", 2_000, 20));
    index.addBlock(makeBlock("b3", 3_000, 20));
    index.addBlock(makeBlock("b4", 4_000, 20));

    expect(index.getNeighborBlockIds("b2", 1)).toEqual(["b1", "b3"]);
    expect(index.getNeighborBlockIds("b3", 2)).toEqual(["b2", "b4", "b1"]);
  });

  test("rebuild resets state and replays stable manifests", () => {
    const index = new ChunkManifestIndex({
      enabled: true,
      targetTokens: 70,
      maxTokens: 120,
      maxBlocks: 4,
      maxGapMs: 10_000
    });
    const blocks = [
      makeBlock("b1", 1_000, 30),
      makeBlock("b2", 2_000, 30),
      makeBlock("b3", 3_000, 30)
    ];

    index.rebuild(blocks);
    const firstPass = index.list().map((item) => item.blockIds.join(","));

    index.reset();
    index.rebuild(blocks);
    const secondPass = index.list().map((item) => item.blockIds.join(","));

    expect(secondPass).toEqual(firstPass);
  });
});
