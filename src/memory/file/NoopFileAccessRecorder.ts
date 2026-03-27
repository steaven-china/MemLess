import type { IFileAccessRecorder, FileReadRecordInput } from "./FileAccessRecorder.js";

export class NoopFileAccessRecorder implements IFileAccessRecorder {
  recordRead(_input: FileReadRecordInput): void {}
}
