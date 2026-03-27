import type { BlockTag } from "../../types.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import type { ITagger } from "./Tagger.js";

export interface HeuristicTaggerConfig {
  importantThreshold: number;
}

const IMPORTANT_HINTS = [
  "critical",
  "p0",
  "incident",
  "outage",
  "rollback",
  "blocked",
  "sev1",
  "sev0",
  "故障",
  "事故",
  "回滚",
  "阻塞",
  "紧急",
  "严重",
  "生产",
  "线上"
];

export class HeuristicTagger implements ITagger {
  private readonly threshold: number;

  constructor(config: HeuristicTaggerConfig) {
    this.threshold = clamp01(config.importantThreshold);
  }

  async tag(block: MemoryBlock): Promise<BlockTag[]> {
    const score = evaluateImportance(block);
    return score >= this.threshold ? ["important"] : ["normal"];
  }
}

function evaluateImportance(block: MemoryBlock): number {
  const summary = block.summary.toLowerCase();
  const raw = block.rawEvents.map((event) => event.text).join(" ").toLowerCase();
  const merged = `${summary} ${raw}`.trim();

  if (block.conflict) return 0.95;
  if (merged.length === 0) return 0;

  let score = 0;
  if (hasAnyHint(merged)) score += 0.8;
  if (block.retentionMode === "conflict") score += 0.2;
  if (block.matchScore < 0.15) score += 0.05;
  return clamp01(score);
}

function hasAnyHint(text: string): boolean {
  return IMPORTANT_HINTS.some((hint) => text.includes(hint));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
