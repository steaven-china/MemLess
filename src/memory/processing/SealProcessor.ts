import type { MemoryEvent } from "../../types.js";
import { extractKeywords } from "../../utils/text.js";
import type { IEmbedder } from "../embedder/IEmbedder.js";
import type { IHistoryMatchCalculator } from "../management/HistoryMatchCalculator.js";
import type { RetentionPolicyEngine } from "../management/RetentionPolicyEngine.js";
import type { IRawEventStore } from "../raw/IRawEventStore.js";
import type { ITagger } from "../tagger/Tagger.js";
import type { ISummarizer } from "../summarizer/ISummarizer.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import { normalizeBlockTags } from "../tagger/TagNormalizer.js";

export interface SealProcessorDeps {
  summarizer: ISummarizer;
  embedder: IEmbedder;
  rawStore: IRawEventStore;
  historyMatchCalculator: IHistoryMatchCalculator;
  retentionPolicy: RetentionPolicyEngine;
  tagger: ITagger;
  allowedAiTags: string[];
}

export interface SealProcessResult {
  block: MemoryBlock;
  matchScore: number;
  retentionReason: string;
  bestMatchId?: string;
}

export class SealProcessor {
  constructor(private readonly deps: SealProcessorDeps) {}

  async process(block: MemoryBlock, history: MemoryBlock[]): Promise<SealProcessResult> {
    const summary = this.generateSummary(block.rawEvents);
    const semanticText = `${summary}\n${joinEventText(block.rawEvents)}`.trim();
    block.summary = summary;
    block.keywords = this.extractKeywords(`${summary} ${joinEventText(block.rawEvents)}`);

    // 先打标签，再 embed（HybridEmbedder 需要 tags 判断策略）
    block.tags = normalizeBlockTags(await this.deps.tagger.tag(block), this.deps.allowedAiTags);
    block.embedding = await this.embed(semanticText, {
      tokenCount: block.tokenCount,
      tags: block.tags
    });

    const matchResult = this.deps.historyMatchCalculator.calculate(block, history);
    block.matchScore = matchResult.score;

    const decision = this.deps.retentionPolicy.decide({
      block,
      matchScore: matchResult.score,
      directionalAffinity: matchResult.directionalAffinity,
      noveltyScore: matchResult.noveltyScore,
      relationBoost: matchResult.relationBoost
    });
    await decision.action.apply(block, this.deps.rawStore);

    return {
      block,
      matchScore: matchResult.score,
      retentionReason: decision.reason,
      bestMatchId: matchResult.bestMatchId
    };
  }

  private generateSummary(events: MemoryEvent[]): string {
    return this.deps.summarizer.summarize(events);
  }

  private extractKeywords(text: string): string[] {
    return extractKeywords(text, 8);
  }

  private async embed(text: string, options?: { tokenCount?: number; tags?: string[] }): Promise<number[]> {
    return this.deps.embedder.embed(text, options);
  }
}

function joinEventText(events: MemoryEvent[]): string {
  return events.map((event) => event.text).join(" ");
}
