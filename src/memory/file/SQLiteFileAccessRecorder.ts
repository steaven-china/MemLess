import type { StatementSync } from "node:sqlite";

import type { SQLiteDatabase } from "../sqlite/SQLiteDatabase.js";
import { createId } from "../../utils/id.js";
import type { FileReadRecordInput, IFileAccessRecorder } from "./FileAccessRecorder.js";

export class SQLiteFileAccessRecorder implements IFileAccessRecorder {
  private readonly upsertSnapshotStatement: StatementSync;
  private readonly insertAccessStatement: StatementSync;
  private readonly upsertVectorStatement: StatementSync;

  constructor(private readonly sqlite: SQLiteDatabase) {
    this.upsertSnapshotStatement = this.sqlite.handle.prepare(`
      INSERT INTO file_snapshots (
        snapshot_id,
        file_id,
        file_path,
        version_key,
        content_hash,
        near_duplicate_key,
        size_bytes,
        modified_at,
        captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(snapshot_id) DO UPDATE SET
        file_path=excluded.file_path,
        content_hash=excluded.content_hash,
        near_duplicate_key=excluded.near_duplicate_key,
        size_bytes=excluded.size_bytes,
        modified_at=excluded.modified_at,
        captured_at=excluded.captured_at
    `);
    this.insertAccessStatement = this.sqlite.handle.prepare(`
      INSERT INTO file_access_events (
        event_id,
        file_id,
        snapshot_id,
        access_type,
        bytes_read,
        truncated,
        timestamp,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.upsertVectorStatement = this.sqlite.handle.prepare(`
      INSERT INTO file_vectors (file_id, version_key, embedding_json, timestamp)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(file_id, version_key) DO UPDATE SET
        embedding_json=excluded.embedding_json,
        timestamp=excluded.timestamp
    `);
  }

  recordRead(input: FileReadRecordInput): void {
    this.upsertSnapshotStatement.run(
      input.snapshotId,
      input.fileId,
      input.filePath,
      input.versionKey,
      input.contentHash,
      input.nearDuplicateKey,
      input.sizeBytes,
      input.modifiedAt ?? null,
      input.timestamp
    );

    this.insertAccessStatement.run(
      createId("file_access"),
      input.fileId,
      input.snapshotId,
      "readonly.read",
      input.bytesRead,
      input.truncated ? 1 : 0,
      input.timestamp,
      JSON.stringify({
        contentHash: input.contentHash,
        nearDuplicateKey: input.nearDuplicateKey,
        sizeBytes: input.sizeBytes,
        modifiedAt: input.modifiedAt ?? null
      })
    );

    this.upsertVectorStatement.run(
      input.fileId,
      input.versionKey,
      JSON.stringify(input.embedding),
      input.timestamp
    );
  }
}
