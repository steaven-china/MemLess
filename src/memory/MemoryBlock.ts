import type { BlockId, BlockTag, MemoryEvent, RetentionMode } from "../types.js";
import { estimateTokens } from "../utils/text.js";

export class MemoryBlock {
  public id: BlockId;
  public startTime: number;
  public endTime: number;
  public tokenCount: number;
  public summary: string;
  public keywords: string[];
  public embedding: number[];
  public rawEvents: MemoryEvent[];
  public retentionMode: RetentionMode;
  public matchScore: number;
  public conflict: boolean;
  public tags: BlockTag[];

  constructor(id: BlockId, startTime = Date.now()) {
    this.id = id;
    this.startTime = startTime;
    this.endTime = startTime;
    this.tokenCount = 0;
    this.summary = "";
    this.keywords = [];
    this.embedding = [];
    this.rawEvents = [];
    this.retentionMode = "raw";
    this.matchScore = 0;
    this.conflict = false;
    this.tags = ["normal"];
  }

  addEvent(event: MemoryEvent): void {
    this.rawEvents.push(event);
    this.endTime = event.timestamp;
    this.tokenCount += estimateTokens(event.text);
  }
}
