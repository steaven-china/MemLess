import { MemoryBlock } from "../MemoryBlock.js";
import type { IBlockStore } from "./IBlockStore.js";
import type { StatementSync } from "node:sqlite";
import type { SQLiteDatabase } from "../sqlite/SQLiteDatabase.js";

type Row = {
  id: string;
  start_time: number;
  end_time: number;
  token_count: number;
  summary: string;
  keywords_json: string;
  embedding_json: string;
  raw_events_json: string;
  retention_mode: MemoryBlock["retentionMode"];
  match_score: number;
  conflict: number;
  tags_json: string;
};

export class SQLiteBlockStore implements IBlockStore {
  private readonly upsertStatement: StatementSync;
  private readonly getStatement: StatementSync;
  private readonly listStatement: StatementSync;
  private readonly getManyStatements = new Map<number, StatementSync>();

  constructor(private readonly sqlite: SQLiteDatabase) {
    this.upsertStatement = this.sqlite.handle.prepare(`
      INSERT INTO blocks (
        id, start_time, end_time, token_count, summary,
        keywords_json, embedding_json, raw_events_json,
        retention_mode, match_score, conflict, tags_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        start_time=excluded.start_time,
        end_time=excluded.end_time,
        token_count=excluded.token_count,
        summary=excluded.summary,
        keywords_json=excluded.keywords_json,
        embedding_json=excluded.embedding_json,
        raw_events_json=excluded.raw_events_json,
        retention_mode=excluded.retention_mode,
        match_score=excluded.match_score,
        conflict=excluded.conflict,
        tags_json=excluded.tags_json
    `);
    this.getStatement = this.sqlite.handle.prepare(`
      SELECT
        id, start_time, end_time, token_count, summary,
        keywords_json, embedding_json, raw_events_json,
        retention_mode, match_score, conflict, tags_json
      FROM blocks WHERE id = ?
    `);
    this.listStatement = this.sqlite.handle.prepare(`
      SELECT
        id, start_time, end_time, token_count, summary,
        keywords_json, embedding_json, raw_events_json,
        retention_mode, match_score, conflict, tags_json
      FROM blocks ORDER BY start_time ASC
    `);
  }

  upsert(block: MemoryBlock): void {
    this.upsertStatement.run(
      block.id,
      block.startTime,
      block.endTime,
      block.tokenCount,
      block.summary,
      JSON.stringify(block.keywords),
      JSON.stringify(block.embedding),
      JSON.stringify(block.rawEvents),
      block.retentionMode,
      block.matchScore,
      block.conflict ? 1 : 0,
      JSON.stringify(normalizeTags(block.tags))
    );
  }

  get(blockId: string): MemoryBlock | undefined {
    const row = this.getStatement.get(blockId) as Row | undefined;
    return row ? toMemoryBlock(row) : undefined;
  }

  getMany(blockIds: string[]): MemoryBlock[] {
    if (blockIds.length === 0) return [];

    const uniqueIds = [...new Set(blockIds)];
    const statement = this.getManyStatement(uniqueIds.length);
    const rows = statement.all(...uniqueIds) as Row[];
    const byId = new Map(rows.map((row) => {
      const block = toMemoryBlock(row);
      return [block.id, block];
    }));

    return blockIds
      .map((blockId) => byId.get(blockId))
      .filter((item): item is MemoryBlock => Boolean(item));
  }

  list(): MemoryBlock[] {
    const rows = this.listStatement.all() as Row[];
    return rows.map(toMemoryBlock);
  }

  private getManyStatement(arity: number): StatementSync {
    const cached = this.getManyStatements.get(arity);
    if (cached) return cached;

    const placeholders = new Array(arity).fill("?").join(", ");
    const statement = this.sqlite.handle.prepare(`
      SELECT
        id, start_time, end_time, token_count, summary,
        keywords_json, embedding_json, raw_events_json,
        retention_mode, match_score, conflict, tags_json
      FROM blocks
      WHERE id IN (${placeholders})
    `);
    this.getManyStatements.set(arity, statement);
    return statement;
  }
}

function toMemoryBlock(row: Row): MemoryBlock {
  const block = new MemoryBlock(row.id, row.start_time);
  block.endTime = row.end_time;
  block.tokenCount = row.token_count;
  block.summary = row.summary;
  block.keywords = parseJson<string[]>(row.keywords_json, []);
  block.embedding = parseJson<number[]>(row.embedding_json, []);
  block.rawEvents = parseJson(row.raw_events_json, []);
  block.retentionMode = row.retention_mode ?? "raw";
  block.matchScore = typeof row.match_score === "number" ? row.match_score : 0;
  block.conflict = row.conflict === 1;
  block.tags = normalizeTags(parseJson<string[]>(row.tags_json, ["normal"]));
  return block;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeTags(tags: unknown): Array<"important" | "normal"> {
  const output: Array<"important" | "normal"> = [];
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if ((tag === "important" || tag === "normal") && !output.includes(tag)) {
        output.push(tag);
      }
    }
  }
  if (output.includes("important")) return ["important"];
  if (output.includes("normal")) return ["normal"];
  return ["normal"];
}
