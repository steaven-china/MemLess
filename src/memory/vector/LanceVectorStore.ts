import type { BlockRef } from "../../types.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import type { IVectorStore } from "./IVectorStore.js";
import type { LanceConnection } from "../lance/LanceConnection.js";
import type { LanceRow } from "../lance/LanceConnection.js";
import type { LanceBlockStore } from "../store/LanceBlockStore.js";

/**
 * LanceDB-backed vector store.
 *
 * Shares the same `LanceConnection` (and therefore the same `blocks` table)
 * as `LanceBlockStore`.  This means:
 *
 * - `add(block)` simply delegates to `LanceBlockStore.upsert()` — the embedding
 *   is persisted as part of the block row, no double-write.
 * - `remove(blockId)` deletes the row from the shared table.
 * - `search(vector, topK)` uses LanceDB's native ANN cosine search against the
 *   `vector` column, returning results sorted by descending similarity score.
 *
 * Score conversion:
 *   LanceDB cosine distance is defined as `1 − cosine_similarity`, so:
 *   `score = Math.max(0, 1 − _distance)`
 *   This maps to the same [0, 1] range used by `InMemoryVectorStore`.
 */
export class LanceVectorStore implements IVectorStore {
  constructor(
    private readonly connection: LanceConnection,
    private readonly blockStore: LanceBlockStore
  ) {}

  async add(block: MemoryBlock): Promise<void> {
    // For the LanceDB backend, the embedding is stored as the `vector` column
    // in the shared `blocks` table.  During normal operation, `blockStore.upsert()`
    // is called by PartitionMemoryManager BEFORE this method, so the row already
    // exists — skip the re-upsert to avoid LanceDB mergeInsert rewriting fragment
    // files (which causes "Not found" errors on stale fragment references).
    //
    // When called directly (e.g. contract tests, manual usage), the block is NOT
    // yet in the table, so we fall through to `blockStore.upsert()`.
    const table = await this.connection.tryGetTable();
    if (table) {
      const existing: LanceRow[] = await table
        .query()
        .where(`id = '${escapeSql(block.id)}'`)
        .limit(1)
        .toArray();
      if (existing.length > 0) return;
    }
    await this.blockStore.upsert(block);
  }

  async remove(blockId: string): Promise<void> {
    const table = await this.connection.tryGetTable();
    if (!table) return;
    await table.delete(`id = '${escapeSql(blockId)}'`);
  }

  async search(vector: number[], topK: number): Promise<BlockRef[]> {
    if (topK <= 0) return [];
    if (vector.length === 0) return [];

    const table = await this.connection.tryGetTable();
    if (!table) return [];

    const rows: (LanceRow & { _distance: number })[] = await table
      .vectorSearch(vector)
      .distanceType("cosine")
      .limit(topK)
      .toArray();

    return rows.map((row) => ({
      id: row.id,
      score: Math.min(1, Math.max(0, 1 - (row._distance ?? 1))),
      source: "vector" as const,
      summary: row.summary ?? "",
      startTime: row.startTime,
      endTime: row.endTime,
      keywords: safeParseJson<string[]>(row.keywords, []),
      rawEvents: safeParseJson(row.rawEvents, []),
      retentionMode: (row.retentionMode as MemoryBlock["retentionMode"]) ?? "raw",
      matchScore: row.matchScore ?? 0,
      conflict: row.conflict ?? false
    }));
  }
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

function safeParseJson<T>(value: unknown, fallback: T): T {
  if (!value || typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
