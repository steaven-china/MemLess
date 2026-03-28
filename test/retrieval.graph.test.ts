import { describe, expect, test, vi } from "vitest";

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

  test("builds confidence map from local relation queries", async () => {
    const graph = new RelationGraph();
    const relationStore = new InMemoryRelationStore();
    const blockStore = new InMemoryBlockStore();
    const retriever = new GraphRetriever(graph, relationStore, blockStore);

    blockStore.upsert(new MemoryBlock("seed"));
    blockStore.upsert(new MemoryBlock("a"));
    blockStore.upsert(new MemoryBlock("b"));

    graph.addRelation("seed", "a", RelationType.CONTEXT);
    graph.addRelation("a", "b", RelationType.FOLLOWS);

    relationStore.add({
      src: "seed",
      dst: "a",
      type: RelationType.CONTEXT,
      timestamp: 1,
      confidence: 0.7
    });
    relationStore.add({
      src: "a",
      dst: "b",
      type: RelationType.FOLLOWS,
      timestamp: 2,
      confidence: 0.9
    });

    const outgoingSpy = vi.spyOn(relationStore, "listOutgoing");
    const incomingSpy = vi.spyOn(relationStore, "listIncoming");
    const listAllSpy = vi.spyOn(relationStore, "listAll");

    const hits = await retriever.retrieve({
      query: "chain",
      keywords: [],
      embedding: [],
      topK: 10,
      seedBlockIds: ["seed"],
      direction: "outgoing",
      relationTypes: [RelationType.CONTEXT, RelationType.FOLLOWS],
      depth: 2
    });

    expect(hits.map((hit) => hit.blockId)).toEqual(["a", "b"]);
    expect(outgoingSpy).toHaveBeenCalled();
    expect(incomingSpy).not.toHaveBeenCalled();
    expect(listAllSpy).not.toHaveBeenCalled();
  });

  test("handles large star graph and keeps topK ordering", async () => {
    const graph = new RelationGraph();
    const relationStore = new InMemoryRelationStore();
    const blockStore = new InMemoryBlockStore();
    const retriever = new GraphRetriever(graph, relationStore, blockStore);

    const seedId = "seed";
    blockStore.upsert(new MemoryBlock(seedId));

    const edgeCount = 1200;
    for (let index = 0; index < edgeCount; index += 1) {
      const blockId = `b-${index}`;
      blockStore.upsert(new MemoryBlock(blockId));
      graph.addRelation(seedId, blockId, RelationType.CONTEXT);
      relationStore.add({
        src: seedId,
        dst: blockId,
        type: RelationType.CONTEXT,
        timestamp: Date.now(),
        confidence: (index + 1) / edgeCount
      });
    }

    const startedAt = Date.now();
    const hits = await retriever.retrieve({
      query: "context",
      keywords: [],
      embedding: [],
      topK: 10,
      seedBlockIds: [seedId],
      direction: "outgoing",
      relationTypes: [RelationType.CONTEXT],
      depth: 1
    });
    const elapsedMs = Date.now() - startedAt;

    expect(hits).toHaveLength(10);
    expect(hits[0]?.blockId).toBe("b-1199");
    expect(hits[9]?.blockId).toBe("b-1190");
    expect(elapsedMs).toBeLessThan(1500);
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
