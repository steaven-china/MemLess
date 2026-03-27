import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { MemoryBlock } from "../src/memory/MemoryBlock.js";
import { SQLiteDatabase } from "../src/memory/sqlite/SQLiteDatabase.js";
import { SQLiteBlockStore } from "../src/memory/store/SQLiteBlockStore.js";

describe("SQLiteBlockStore getMany", () => {
  test("keeps caller order (including duplicates)", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-sqlite-blockstore-"));
    const sqliteFile = join(folder, "memory.db");
    const sqlite = new SQLiteDatabase({ filePath: sqliteFile });
    try {
      const store = new SQLiteBlockStore(sqlite);

      const b1 = new MemoryBlock("block_1", 1000);
      b1.summary = "first";
      b1.endTime = 1100;
      const b2 = new MemoryBlock("block_2", 2000);
      b2.summary = "second";
      b2.endTime = 2100;

      store.upsert(b1);
      store.upsert(b2);

      const blocks = store.getMany(["block_2", "block_1", "block_2"]);
      expect(blocks.map((item) => item.id)).toEqual(["block_2", "block_1", "block_2"]);
    } finally {
      sqlite.close();
    }
  });

  test("persists and hydrates tags_json", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-sqlite-blockstore-tags-"));
    const sqliteFile = join(folder, "memory.db");
    const sqlite = new SQLiteDatabase({ filePath: sqliteFile });
    try {
      const store = new SQLiteBlockStore(sqlite);
      const block = new MemoryBlock("block_tags", 1234);
      block.summary = "incident rollback blocked";
      block.tags = ["important"];
      store.upsert(block);

      const loaded = store.get("block_tags");
      expect(loaded?.tags).toEqual(["important"]);
    } finally {
      sqlite.close();
    }
  });

  test("falls back to normal tag when tags_json is missing", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-sqlite-blockstore-legacy-"));
    const sqliteFile = join(folder, "memory.db");
    const sqlite = new SQLiteDatabase({ filePath: sqliteFile });
    try {
      sqlite.handle.exec(`
        INSERT INTO blocks (
          id, start_time, end_time, token_count, summary,
          keywords_json, embedding_json, raw_events_json,
          retention_mode, match_score, conflict, tags_json
        ) VALUES (
          'legacy_block', 1, 2, 3, 'legacy summary',
          '[]', '[]', '[]',
          'raw', 0, 0, 'null'
        )
      `);

      const store = new SQLiteBlockStore(sqlite);
      const loaded = store.get("legacy_block");
      expect(loaded?.tags).toEqual(["normal"]);
    } finally {
      sqlite.close();
    }
  });
});
