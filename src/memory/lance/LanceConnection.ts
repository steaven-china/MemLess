import type { MemoryBlock } from "../MemoryBlock.js";

export interface LanceConnectionConfig {
  dbPath: string;
}

// Type alias for the LanceDB Table object (obtained via dynamic import)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LanceTable = any;

/**
 * Shared LanceDB connection holder.
 *
 * - Lazily connects to the LanceDB directory on first use.
 * - Creates the `blocks` table on first write (schema is inferred from the
 *   first row so we don't need an explicit Apache Arrow dependency).
 * - Both `LanceBlockStore` and `LanceVectorStore` share one instance, which
 *   means they both operate on the same table without data-sync issues.
 * - `@lancedb/lancedb` is imported dynamically so that other storage backends
 *   continue to work even if the package is not installed.
 */
export class LanceConnection {
  private db: unknown = undefined;
  private blocksTable: LanceTable = undefined;

  constructor(private readonly config: LanceConnectionConfig) {}

  /**
   * Return the shared `blocks` table.
   *
   * @param firstBlock  Supply the first block when the table may not exist yet.
   *                    Its embedding is used to infer the vector column dimension.
   */
  async getTable(firstBlock?: MemoryBlock): Promise<LanceTable> {
    if (this.blocksTable) return this.blocksTable;

    // Dynamic import — only executed when lance backend is actually used.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lancedb = (await import("@lancedb/lancedb")) as any;

    if (!this.db) {
      this.db = await lancedb.connect(this.config.dbPath);
    }
    const db = this.db as { tableNames(): Promise<string[]>; openTable(name: string): Promise<LanceTable>; createTable(name: string, rows: unknown[]): Promise<LanceTable> };

    const tableNames: string[] = await db.tableNames();
    if (tableNames.includes("blocks")) {
      this.blocksTable = await db.openTable("blocks");
    } else {
      if (!firstBlock) {
        throw new Error(
          "[LanceDB] Cannot create blocks table: no initial block provided. " +
            "Upsert at least one block first."
        );
      }
      const row = serializeRow(firstBlock);
      this.blocksTable = await db.createTable("blocks", [row]);
    }

    return this.blocksTable;
  }

  /**
   * Attempt to open an existing table without creating it.
   * Returns `undefined` if the table does not exist yet.
   */
  async tryGetTable(): Promise<LanceTable | undefined> {
    if (this.blocksTable) return this.blocksTable;
    try {
      return await this.getTable();
    } catch {
      return undefined;
    }
  }
}

// ─── Row serialization (shared between BlockStore and VectorStore) ───────────

export interface LanceRow {
  id: string;
  startTime: number;
  endTime: number;
  tokenCount: number;
  summary: string;
  keywords: string;   // JSON
  vector: number[];
  rawEvents: string;  // JSON
  retentionMode: string;
  matchScore: number;
  conflict: boolean;
  tags: string;       // JSON
}

export function serializeRow(block: MemoryBlock): LanceRow {
  return {
    id: block.id,
    startTime: block.startTime,
    endTime: block.endTime,
    tokenCount: block.tokenCount,
    summary: block.summary,
    keywords: JSON.stringify(block.keywords),
    // Use a [0] placeholder vector when embedding is empty to satisfy LanceDB's
    // fixed-size list requirement.  The placeholder will never be returned in
    // a meaningful top-K search result because its score will be near 0.
    vector: block.embedding.length > 0 ? block.embedding : [0],
    rawEvents: JSON.stringify(block.rawEvents),
    retentionMode: block.retentionMode,
    matchScore: block.matchScore,
    conflict: block.conflict,
    tags: JSON.stringify(block.tags)
  };
}
