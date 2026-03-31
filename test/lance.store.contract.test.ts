/**
 * Contract tests for the real LanceDB-backed stores.
 *
 * These tests are skipped automatically if `@lancedb/lancedb` is not installed
 * (e.g. in CI environments that don't carry the native binary), so they never
 * break other storage backends.
 *
 * Each test gets its own isolated LanceDB directory under os.tmpdir() and
 * cleans up after itself.
 */
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { MemoryBlock } from "../src/memory/MemoryBlock.js";
import { LanceConnection } from "../src/memory/lance/LanceConnection.js";
import { LanceBlockStore } from "../src/memory/store/LanceBlockStore.js";
import { LanceVectorStore } from "../src/memory/vector/LanceVectorStore.js";

// ---------------------------------------------------------------------------
// Skip the entire suite if the native module can't be loaded
// ---------------------------------------------------------------------------
let lancedbAvailable = false;

beforeAll(async () => {
  try {
    await import("@lancedb/lancedb");
    lancedbAvailable = true;
  } catch {
    lancedbAvailable = false;
  }
});

// Helper: create a test block with optional embedding
function makeBlock(id: string, embedding: number[] = []): MemoryBlock {
  const block = new MemoryBlock(id, 1000);
  block.endTime = 2000;
  block.tokenCount = 10;
  block.summary = `summary of ${id}`;
  block.keywords = [id, "test"];
  block.embedding = embedding;
  block.retentionMode = "raw";
  block.matchScore = 0.5;
  block.conflict = false;
  block.tags = ["normal"];
  return block;
}

// Helper: unit vector of given dimension (all equal components)
function unitVec(dim: number): number[] {
  const v = Array.from({ length: dim }, () => 1 / Math.sqrt(dim));
  return v;
}

// ---------------------------------------------------------------------------
// Helpers to manage temp dirs
// ---------------------------------------------------------------------------
const cleanupDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), "mlex-lance-test-"));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(async () => {
  // Remove all temp dirs accumulated during this test
  const dirs = cleanupDirs.splice(0);
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

// ---------------------------------------------------------------------------
// LanceBlockStore CRUD
// ---------------------------------------------------------------------------
describe("LanceBlockStore (real LanceDB)", () => {
  test("upsert + get round-trip", async () => {
    if (!lancedbAvailable) return;

    const dbPath = await makeTempDir();
    const conn = new LanceConnection({ dbPath });
    const store = new LanceBlockStore(conn, ["important", "normal"]);

    const block = makeBlock("b1", unitVec(4));
    await store.upsert(block);

    const result = await store.get("b1");
    expect(result).toBeDefined();
    expect(result!.id).toBe("b1");
    expect(result!.summary).toBe("summary of b1");
    expect(result!.keywords).toEqual(["b1", "test"]);
    expect(result!.retentionMode).toBe("raw");
    expect(result!.matchScore).toBe(0.5);
    expect(result!.conflict).toBe(false);
  });

  test("get returns undefined for unknown id", async () => {
    if (!lancedbAvailable) return;

    const dbPath = await makeTempDir();
    const conn = new LanceConnection({ dbPath });
    const store = new LanceBlockStore(conn);

    const result = await store.get("nonexistent");
    expect(result).toBeUndefined();
  });

  test("upsert is idempotent (update on re-insert)", async () => {
    if (!lancedbAvailable) return;

    const dbPath = await makeTempDir();
    const conn = new LanceConnection({ dbPath });
    const store = new LanceBlockStore(conn);

    const block = makeBlock("b2", unitVec(4));
    await store.upsert(block);

    block.summary = "updated summary";
    block.tokenCount = 99;
    await store.upsert(block);

    const result = await store.get("b2");
    expect(result!.summary).toBe("updated summary");
    expect(result!.tokenCount).toBe(99);
  });

  test("getMany preserves requested order", async () => {
    if (!lancedbAvailable) return;

    const dbPath = await makeTempDir();
    const conn = new LanceConnection({ dbPath });
    const store = new LanceBlockStore(conn);

    await store.upsert(makeBlock("b1", unitVec(4)));
    await store.upsert(makeBlock("b2", unitVec(4)));
    await store.upsert(makeBlock("b3", unitVec(4)));

    const results = await store.getMany(["b3", "b1"]);
    expect(results.map((r) => r.id)).toEqual(["b3", "b1"]);
  });

  test("getMany returns empty for empty input", async () => {
    if (!lancedbAvailable) return;

    const dbPath = await makeTempDir();
    const conn = new LanceConnection({ dbPath });
    const store = new LanceBlockStore(conn);

    expect(await store.getMany([])).toEqual([]);
  });

  test("list returns all blocks sorted by startTime", async () => {
    if (!lancedbAvailable) return;

    const dbPath = await makeTempDir();
    const conn = new LanceConnection({ dbPath });
    const store = new LanceBlockStore(conn);

    const b1 = makeBlock("b1", unitVec(4));
    b1.startTime = 3000;
    const b2 = makeBlock("b2", unitVec(4));
    b2.startTime = 1000;
    const b3 = makeBlock("b3", unitVec(4));
    b3.startTime = 2000;

    await store.upsert(b1);
    await store.upsert(b2);
    await store.upsert(b3);

    const list = await store.list();
    expect(list.map((b) => b.id)).toEqual(["b2", "b3", "b1"]);
  });
});

// ---------------------------------------------------------------------------
// LanceVectorStore add / remove / search
// ---------------------------------------------------------------------------
describe("LanceVectorStore (real LanceDB)", () => {
  test("add + search returns the correct block", async () => {
    if (!lancedbAvailable) return;

    const dbPath = await makeTempDir();
    const conn = new LanceConnection({ dbPath });
    const blockStore = new LanceBlockStore(conn);
    const vectorStore = new LanceVectorStore(conn, blockStore);

    const block = makeBlock("v1", unitVec(4));
    await vectorStore.add(block);

    const results = await vectorStore.search(unitVec(4), 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.id).toBe("v1");
  });

  test("score is in [0, 1] and near 1 for identical vector", async () => {
    if (!lancedbAvailable) return;

    const dbPath = await makeTempDir();
    const conn = new LanceConnection({ dbPath });
    const blockStore = new LanceBlockStore(conn);
    const vectorStore = new LanceVectorStore(conn, blockStore);

    const vec = unitVec(8);
    await vectorStore.add(makeBlock("v1", vec));

    const results = await vectorStore.search(vec, 1);
    expect(results.length).toBe(1);
    expect(results[0]!.score).toBeGreaterThan(0.9);
    expect(results[0]!.score).toBeLessThanOrEqual(1.0);
  });

  test("search respects topK limit", async () => {
    if (!lancedbAvailable) return;

    const dbPath = await makeTempDir();
    const conn = new LanceConnection({ dbPath });
    const blockStore = new LanceBlockStore(conn);
    const vectorStore = new LanceVectorStore(conn, blockStore);

    for (let i = 0; i < 5; i++) {
      await vectorStore.add(makeBlock(`v${i}`, unitVec(4)));
    }

    const results = await vectorStore.search(unitVec(4), 3);
    expect(results.length).toBe(3);
  });

  test("search returns [] for topK=0", async () => {
    if (!lancedbAvailable) return;

    const dbPath = await makeTempDir();
    const conn = new LanceConnection({ dbPath });
    const blockStore = new LanceBlockStore(conn);
    const vectorStore = new LanceVectorStore(conn, blockStore);

    await vectorStore.add(makeBlock("v1", unitVec(4)));
    expect(await vectorStore.search(unitVec(4), 0)).toEqual([]);
  });

  test("remove deletes the block from search results", async () => {
    if (!lancedbAvailable) return;

    const dbPath = await makeTempDir();
    const conn = new LanceConnection({ dbPath });
    const blockStore = new LanceBlockStore(conn);
    const vectorStore = new LanceVectorStore(conn, blockStore);

    const vec = unitVec(4);
    await vectorStore.add(makeBlock("v1", vec));
    await vectorStore.add(makeBlock("v2", vec));

    await vectorStore.remove("v1");

    const results = await vectorStore.search(vec, 10);
    expect(results.map((r) => r.id)).not.toContain("v1");
    expect(results.map((r) => r.id)).toContain("v2");
  });

  test("BlockRef fields are populated correctly", async () => {
    if (!lancedbAvailable) return;

    const dbPath = await makeTempDir();
    const conn = new LanceConnection({ dbPath });
    const blockStore = new LanceBlockStore(conn);
    const vectorStore = new LanceVectorStore(conn, blockStore);

    const block = makeBlock("v1", unitVec(4));
    await vectorStore.add(block);

    const [ref] = await vectorStore.search(unitVec(4), 1);
    expect(ref).toBeDefined();
    expect(ref!.id).toBe("v1");
    expect(ref!.source).toBe("vector");
    expect(ref!.summary).toBe("summary of v1");
    expect(ref!.startTime).toBe(1000);
    expect(ref!.endTime).toBe(2000);
    expect(ref!.keywords).toEqual(["v1", "test"]);
    expect(ref!.retentionMode).toBe("raw");
  });
});

// ---------------------------------------------------------------------------
// Shared connection: blockStore upsert visible to vectorStore search
// ---------------------------------------------------------------------------
describe("LanceBlockStore + LanceVectorStore shared connection", () => {
  test("block upserted via blockStore is searchable via vectorStore", async () => {
    if (!lancedbAvailable) return;

    const dbPath = await makeTempDir();
    const conn = new LanceConnection({ dbPath });
    const blockStore = new LanceBlockStore(conn);
    const vectorStore = new LanceVectorStore(conn, blockStore);

    const vec = unitVec(4);
    // Only use blockStore to write
    await blockStore.upsert(makeBlock("shared-1", vec));

    // vectorStore should find it because they share the same table
    const results = await vectorStore.search(vec, 10);
    expect(results.map((r) => r.id)).toContain("shared-1");
  });

  test("block added via vectorStore.add is retrievable via blockStore.get", async () => {
    if (!lancedbAvailable) return;

    const dbPath = await makeTempDir();
    const conn = new LanceConnection({ dbPath });
    const blockStore = new LanceBlockStore(conn);
    const vectorStore = new LanceVectorStore(conn, blockStore);

    await vectorStore.add(makeBlock("shared-2", unitVec(4)));

    const retrieved = await blockStore.get("shared-2");
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe("shared-2");
  });
});
