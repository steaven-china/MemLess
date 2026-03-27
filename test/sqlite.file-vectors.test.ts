import { describe, expect, test } from "vitest";

import { SQLiteDatabase } from "../src/memory/sqlite/SQLiteDatabase.js";
import { SQLiteFileAccessRecorder } from "../src/memory/file/SQLiteFileAccessRecorder.js";

describe("SQLiteFileAccessRecorder", () => {
  test("persists snapshots, access events and vectors", () => {
    const sqlite = new SQLiteDatabase({ filePath: ":memory:" });
    try {
      const recorder = new SQLiteFileAccessRecorder(sqlite);
      recorder.recordRead({
        fileId: "file:README.md",
        snapshotId: "snapshot:README.md#v1",
        versionKey: "v1",
        filePath: "README.md",
        contentHash: "hash-1",
        nearDuplicateKey: "near-1",
        sizeBytes: 123,
        bytesRead: 123,
        truncated: false,
        modifiedAt: 1000,
        timestamp: 2000,
        embedding: [0.1, 0.2, 0.3]
      });

      const snapshotCount = (
        sqlite.handle.prepare("SELECT COUNT(*) AS count FROM file_snapshots").get() as { count: number }
      ).count;
      const accessCount = (
        sqlite.handle.prepare("SELECT COUNT(*) AS count FROM file_access_events").get() as { count: number }
      ).count;
      const vectorCount = (
        sqlite.handle.prepare("SELECT COUNT(*) AS count FROM file_vectors").get() as { count: number }
      ).count;

      expect(snapshotCount).toBe(1);
      expect(accessCount).toBe(1);
      expect(vectorCount).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});
