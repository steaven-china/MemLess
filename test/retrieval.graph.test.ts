import { describe, expect, test } from "vitest";

import { MemoryBlock } from "../src/memory/MemoryBlock.js";
import { RelationGraph } from "../src/memory/RelationGraph.js";
import { InMemoryRelationStore } from "../src/memory/relation/InMemoryRelationStore.js";
import { GraphRetriever } from "../src/memory/retrieval/GraphRetriever.js";
import { InMemoryBlockStore } from "../src/memory/store/InMemoryBlockStore.js";
import { RelationType } from "../src/types.js";

describe("GraphRetriever", () => {
  test("ranks traversal hits by relation confidence", async () => {
    const graph = new RelationGraph();
    const relationStore = new InMemoryRelationStore();
    const blockStore = new InMemoryBlockStore();
    const retriever = new GraphRetriever(graph, relationStore, blockStore);

    blockStore.upsert(new MemoryBlock("a"));
    blockStore.upsert(new MemoryBlock("b"));
    blockStore.upsert(new MemoryBlock("c"));

    graph.addRelation("a", "b", RelationType.CONTEXT);
    graph.addRelation("a", "c", RelationType.CONTEXT);

    relationStore.add({
      src: "a",
      dst: "b",
      type: RelationType.CONTEXT,
      timestamp: Date.now(),
      confidence: 0.95
    });
    relationStore.add({
      src: "a",
      dst: "c",
      type: RelationType.CONTEXT,
      timestamp: Date.now(),
      confidence: 0.2
    });

    const hits = await retriever.retrieve({
      query: "next context",
      keywords: [],
      embedding: [],
      topK: 10,
      seedBlockIds: ["a"],
      direction: "outgoing",
      relationTypes: [RelationType.CONTEXT],
      depth: 1
    });

    expect(hits.map((hit) => hit.blockId)).toEqual(["b", "c"]);
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0);
    expect(hits[0]?.score).toBeCloseTo(1, 6);
  });

  test("ignores file nodes in graph hits", async () => {
    const graph = new RelationGraph();
    const relationStore = new InMemoryRelationStore();
    const blockStore = new InMemoryBlockStore();
    const retriever = new GraphRetriever(graph, relationStore, blockStore);

    blockStore.upsert(new MemoryBlock("seed"));
    blockStore.upsert(new MemoryBlock("b"));

    graph.addRelation("seed", "file:README.md", RelationType.FILE_MENTIONS_BLOCK);
    graph.addRelation("seed", "b", RelationType.CONTEXT);

    relationStore.add({
      src: "seed",
      dst: "file:README.md",
      type: RelationType.FILE_MENTIONS_BLOCK,
      timestamp: Date.now(),
      confidence: 0.9
    });
    relationStore.add({
      src: "seed",
      dst: "b",
      type: RelationType.CONTEXT,
      timestamp: Date.now(),
      confidence: 0.6
    });

    const hits = await retriever.retrieve({
      query: "context",
      keywords: [],
      embedding: [],
      topK: 10,
      seedBlockIds: ["seed"],
      direction: "outgoing",
      relationTypes: [RelationType.FILE_MENTIONS_BLOCK, RelationType.CONTEXT],
      depth: 1
    });

    expect(hits.map((hit) => hit.blockId)).toEqual(["b"]);
  });
});
