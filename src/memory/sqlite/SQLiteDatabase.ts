import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";

export interface SQLiteDatabaseConfig {
  filePath: string;
}

export class SQLiteDatabase {
  private readonly db: DatabaseSync;

  constructor(config: SQLiteDatabaseConfig) {
    const filePath = normalizeFilePath(config.filePath);
    if (filePath !== ":memory:") {
      mkdirSync(dirname(filePath), { recursive: true });
    }
    const DatabaseSyncCtor = loadDatabaseSync();
    this.db = new DatabaseSyncCtor(filePath);
    this.initialize();
  }

  get handle(): DatabaseSync {
    return this.db;
  }

  close(): void {
    this.db.close();
  }

  private initialize(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS blocks (
        id TEXT PRIMARY KEY,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        token_count INTEGER NOT NULL,
        summary TEXT NOT NULL,
        keywords_json TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        raw_events_json TEXT NOT NULL,
        retention_mode TEXT NOT NULL,
        match_score REAL NOT NULL,
        conflict INTEGER NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '["normal"]'
      );

      CREATE TABLE IF NOT EXISTS raw_events (
        block_id TEXT PRIMARY KEY,
        events_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS relations (
        src TEXT NOT NULL,
        dst TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        confidence REAL,
        PRIMARY KEY (src, dst, type)
      );

      CREATE TABLE IF NOT EXISTS file_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        version_key TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        near_duplicate_key TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        modified_at INTEGER,
        captured_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS file_access_events (
        event_id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        snapshot_id TEXT,
        access_type TEXT NOT NULL,
        bytes_read INTEGER NOT NULL,
        truncated INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        metadata_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS file_vectors (
        file_id TEXT NOT NULL,
        version_key TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (file_id, version_key)
      );

      CREATE INDEX IF NOT EXISTS idx_blocks_start_time ON blocks(start_time);
      CREATE INDEX IF NOT EXISTS idx_blocks_end_time ON blocks(end_time);
      CREATE INDEX IF NOT EXISTS idx_raw_events_updated_at ON raw_events(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_relations_src_timestamp ON relations(src, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_relations_dst_timestamp ON relations(dst, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_relations_type_timestamp ON relations(type, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_file_snapshots_file_captured ON file_snapshots(file_id, captured_at DESC);
      CREATE INDEX IF NOT EXISTS idx_file_access_file_timestamp ON file_access_events(file_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_file_vectors_file_timestamp ON file_vectors(file_id, timestamp DESC);
    `);
    this.addMissingColumns();
  }

  private addMissingColumns(): void {
    try {
      this.db.exec("ALTER TABLE blocks ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[\"normal\"]';");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("duplicate column name")) {
        throw error;
      }
    }
  }
}

function loadDatabaseSync(): new (location: string) => DatabaseSync {
  const require = createRequire(import.meta.url);
  try {
    const loaded = require("node:sqlite") as { DatabaseSync?: new (location: string) => DatabaseSync };
    if (!loaded.DatabaseSync) {
      throw new Error("DatabaseSync export is unavailable from node:sqlite");
    }
    return loaded.DatabaseSync;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `SQLite backend requires Node.js runtime support for node:sqlite. Current load failed: ${message}`
    );
  }
}

function normalizeFilePath(filePath: string): string {
  const trimmed = filePath.trim();
  return trimmed.length > 0 ? trimmed : ":memory:";
}
