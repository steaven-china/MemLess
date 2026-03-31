import { MemoryBlock } from "../MemoryBlock.js";
import { normalizeBlockTags } from "../tagger/TagNormalizer.js";
import type { IBlockStore } from "./IBlockStore.js";
import { LanceConnection, serializeRow } from "../lance/LanceConnection.js";
import type { LanceRow } from "../lance/LanceConnection.js";

export { LanceConnection } from "../lance/LanceConnection.js";
export type { LanceConnectionConfig } from "../lance/LanceConnection.js";

export class LanceBlockStore implements IBlockStore {
  constructor(
    private readonly connection: LanceConnection,
    private readonly allowedAiTags: string[] = ["important", "normal"]
  ) {}

  async upsert(block: MemoryBlock): Promise<void> {
    const table = await this.connection.getTable(block);
    const row = serializeRow(block);
    await table
      .mergeInsert("id")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute([row]);
  }

  async get(blockId: string): Promise<MemoryBlock | undefined> {
    const table = await this.connection.tryGetTable();
    if (!table) return undefined;
    const rows: LanceRow[] = await table
      .query()
      .where(`id = '${escapeSql(blockId)}'`)
      .toArray();
    return rows.length > 0 ? this.deserialize(rows[0]!) : undefined;
  }

  async getMany(blockIds: string[]): Promise<MemoryBlock[]> {
    if (blockIds.length === 0) return [];
    const table = await this.connection.tryGetTable();
    if (!table) return [];
    const inClause = blockIds.map((id) => `'${escapeSql(id)}'`).join(", ");
    const rows: LanceRow[] = await table
      .query()
      .where(`id IN (${inClause})`)
      .toArray();
    // Preserve the requested order
    const byId = new Map(rows.map((r) => [r.id, r]));
    return blockIds
      .map((id) => byId.get(id))
      .filter((r): r is LanceRow => r !== undefined)
      .map((r) => this.deserialize(r));
  }

  async list(): Promise<MemoryBlock[]> {
    const table = await this.connection.tryGetTable();
    if (!table) return [];
    const rows: LanceRow[] = await table.query().toArray();
    return rows.map((r) => this.deserialize(r)).sort((a, b) => a.startTime - b.startTime);
  }

  private deserialize(row: LanceRow): MemoryBlock {
    const block = new MemoryBlock(row.id, row.startTime);
    block.endTime = row.endTime;
    block.tokenCount = row.tokenCount;
    block.summary = row.summary ?? "";
    block.keywords = safeParseJson<string[]>(row.keywords, []);
    block.embedding = Array.isArray(row.vector) ? [...row.vector] : [];
    block.rawEvents = safeParseJson(row.rawEvents, []);
    block.retentionMode = (row.retentionMode as MemoryBlock["retentionMode"]) ?? "raw";
    block.matchScore = row.matchScore ?? 0;
    block.conflict = row.conflict ?? false;
    block.tags = normalizeBlockTags(safeParseJson(row.tags, undefined), this.allowedAiTags);
    return block;
  }
}

function escapeSql(value: string): string {
  // Escape single quotes by doubling them (SQL standard)
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
