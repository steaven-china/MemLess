import type { BlockId } from "../../types.js";
import type { StatementSync } from "node:sqlite";
import type { SQLiteDatabase } from "../sqlite/SQLiteDatabase.js";
import type { IRelationStore, StoredRelation } from "./IRelationStore.js";

type RelationRow = {
  src: string;
  dst: string;
  type: StoredRelation["type"];
  timestamp: number;
  confidence: number | null;
};

export class SQLiteRelationStore implements IRelationStore {
  private readonly addStatement: StatementSync;
  private readonly listOutgoingStatement: StatementSync;
  private readonly listIncomingStatement: StatementSync;
  private readonly listAllStatement: StatementSync;

  constructor(private readonly sqlite: SQLiteDatabase) {
    this.addStatement = this.sqlite.handle.prepare(`
      INSERT INTO relations (src, dst, type, timestamp, confidence)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(src, dst, type) DO UPDATE SET
        timestamp=excluded.timestamp,
        confidence=excluded.confidence
    `);
    this.listOutgoingStatement = this.sqlite.handle.prepare(`
      SELECT src, dst, type, timestamp, confidence
      FROM relations WHERE src = ?
      ORDER BY timestamp DESC
    `);
    this.listIncomingStatement = this.sqlite.handle.prepare(`
      SELECT src, dst, type, timestamp, confidence
      FROM relations WHERE dst = ?
      ORDER BY timestamp DESC
    `);
    this.listAllStatement = this.sqlite.handle.prepare(`
      SELECT src, dst, type, timestamp, confidence
      FROM relations ORDER BY timestamp ASC
    `);
  }

  add(relation: StoredRelation): void {
    this.addStatement.run(
      relation.src,
      relation.dst,
      relation.type,
      relation.timestamp,
      relation.confidence ?? null
    );
  }

  listOutgoing(src: BlockId): StoredRelation[] {
    const rows = this.listOutgoingStatement.all(src) as RelationRow[];
    return rows.map(toStoredRelation);
  }

  listIncoming(dst: BlockId): StoredRelation[] {
    const rows = this.listIncomingStatement.all(dst) as RelationRow[];
    return rows.map(toStoredRelation);
  }

  listAll(): StoredRelation[] {
    const rows = this.listAllStatement.all() as RelationRow[];
    return rows.map(toStoredRelation);
  }
}

function toStoredRelation(row: RelationRow): StoredRelation {
  return {
    src: row.src,
    dst: row.dst,
    type: row.type,
    timestamp: row.timestamp,
    confidence: row.confidence ?? undefined
  };
}
