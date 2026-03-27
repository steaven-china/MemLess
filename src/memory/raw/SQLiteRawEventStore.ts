import type { BlockId, MemoryEvent } from "../../types.js";
import type { StatementSync } from "node:sqlite";
import type { SQLiteDatabase } from "../sqlite/SQLiteDatabase.js";
import type { IRawEventStore } from "./IRawEventStore.js";

type RawEventRow = {
  block_id: string;
  events_json: string;
};

export class SQLiteRawEventStore implements IRawEventStore {
  private readonly putStatement: StatementSync;
  private readonly getStatement: StatementSync;
  private readonly removeStatement: StatementSync;
  private readonly listBlockIdsStatement: StatementSync;

  constructor(private readonly sqlite: SQLiteDatabase) {
    this.putStatement = this.sqlite.handle.prepare(`
      INSERT INTO raw_events (block_id, events_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(block_id) DO UPDATE SET
        events_json=excluded.events_json,
        updated_at=excluded.updated_at
    `);
    this.getStatement = this.sqlite.handle.prepare(`
      SELECT block_id, events_json FROM raw_events WHERE block_id = ?
    `);
    this.removeStatement = this.sqlite.handle.prepare(`DELETE FROM raw_events WHERE block_id = ?`);
    this.listBlockIdsStatement = this.sqlite.handle.prepare(`
      SELECT block_id FROM raw_events ORDER BY block_id ASC
    `);
  }

  put(blockId: BlockId, events: MemoryEvent[]): void {
    this.putStatement.run(blockId, JSON.stringify(events), Date.now());
  }

  get(blockId: BlockId): MemoryEvent[] | undefined {
    const row = this.getStatement.get(blockId) as RawEventRow | undefined;
    if (!row) return undefined;
    return parseJson<MemoryEvent[]>(row.events_json, []);
  }

  remove(blockId: BlockId): void {
    this.removeStatement.run(blockId);
  }

  listBlockIds(): BlockId[] {
    const rows = this.listBlockIdsStatement.all() as Array<{ block_id: string }>;
    return rows.map((row) => row.block_id);
  }
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
