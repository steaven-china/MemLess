import { describe, expect, test } from "vitest";

import { SQLiteDatabase } from "../src/memory/sqlite/SQLiteDatabase.js";
import { SQLiteRelationStore } from "../src/memory/relation/SQLiteRelationStore.js";
import { RelationType } from "../src/types.js";

describe("file entity relations", () => {
  test("stores snapshot/file and file/block relations", () => {
    const sqlite = new SQLiteDatabase({ filePath: ":memory:" });
    try {
      const store = new SQLiteRelationStore(sqlite);
      store.add({
        src: "snapshot:README.md#v1",
        dst: "file:README.md",
        type: RelationType.SNAPSHOT_OF_FILE,
        timestamp: 100,
        confidence: 1
      });
      store.add({
        src: "file:README.md",
        dst: "block_1",
        type: RelationType.FILE_MENTIONS_BLOCK,
        timestamp: 101,
        confidence: 0.8
      });

      const all = store.listAll();
      expect(all.some((item) => item.type === RelationType.SNAPSHOT_OF_FILE)).toBe(true);
      expect(all.some((item) => item.type === RelationType.FILE_MENTIONS_BLOCK)).toBe(true);
    } finally {
      sqlite.close();
    }
  });
});
