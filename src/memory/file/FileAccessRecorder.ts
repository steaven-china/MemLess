export interface FileReadRecordInput {
  fileId: string;
  snapshotId: string;
  versionKey: string;
  filePath: string;
  contentHash: string;
  nearDuplicateKey: string;
  sizeBytes: number;
  bytesRead: number;
  truncated: boolean;
  modifiedAt?: number;
  timestamp: number;
  embedding: number[];
}

export interface IFileAccessRecorder {
  recordRead(input: FileReadRecordInput): Promise<void> | void;
}
