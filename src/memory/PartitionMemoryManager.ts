import type { IMemoryManager } from "./IMemoryManager.js";
import { MemoryBlock } from "./MemoryBlock.js";
import { InvertedIndex } from "./InvertedIndex.js";
import { RelationGraph } from "./RelationGraph.js";
import type { IVectorStore } from "./vector/IVectorStore.js";
import type { IEmbedder } from "./embedder/IEmbedder.js";
import type { IChunkStrategy } from "./chunking/IChunkStrategy.js";
import type { IBlockStore } from "./store/IBlockStore.js";
import { RelationType } from "../types.js";
import type {
  BlockRef,
  Context,
  DirectionalIntent,
  ManagerConfig,
  MemoryEvent,
  PredictedIntent,
  PredictionResult,
  ProactiveSignal,
  ProactiveTriggerSource
} from "../types.js";
import { createId } from "../utils/id.js";
import { extractKeywords, hasDirectionalIntent, normalizeText } from "../utils/text.js";
import { AsyncRelationQueue } from "./relation/AsyncRelationQueue.js";
import type { IRelationExtractor } from "./relation/RelationExtractor.js";
import type { IRelationStore } from "./relation/IRelationStore.js";
import type { IRawEventStore } from "./raw/IRawEventStore.js";
import type { SealProcessor } from "./processing/SealProcessor.js";
import type { ContextAssembler } from "./output/ContextAssembler.js";
import type { RawBacktracker } from "./output/RawBacktracker.js";
import type { PredictorEngine } from "./prediction/PredictorEngine.js";
import type { HybridRetriever } from "./output/HybridRetriever.js";
import { shouldProactiveRetrieve } from "./prediction/ProactiveRetrievePolicy.js";
import { proactivePolicy } from "./prediction/ProactiveTimingPolicy.js";
import {
  applyPrefetchBoost,
  clearPrefetchedIntents,
  stagePrefetchedIntents
} from "./prediction/PrefetchIntentPolicy.js";

export interface PartitionMemoryManagerDeps {
  vectorStore: IVectorStore;
  embedder: IEmbedder;
  blockStore: IBlockStore;
  rawStore: IRawEventStore;
  relationStore: IRelationStore;
  chunkStrategy: IChunkStrategy;
  hybridRetriever: HybridRetriever;
  relationExtractor: IRelationExtractor;
  sealProcessor: SealProcessor;
  contextAssembler: ContextAssembler;
  backtracker: RawBacktracker;
  predictor: PredictorEngine;
  keywordIndex?: InvertedIndex;
  relationGraph?: RelationGraph;
  config: ManagerConfig;
}

export class PartitionMemoryManager implements IMemoryManager {
  private static readonly TIMER_PROBE_QUERY = "__mlex_proactive_timer_probe__";
  private activeBlock: MemoryBlock;
  private readonly blockTable = new Map<string, MemoryBlock>();
  private readonly keywordIndex: InvertedIndex;
  private readonly relationGraph: RelationGraph;
  private readonly relationQueue: AsyncRelationQueue;
  private lastSealedBlockId?: string;
  private lastPrediction?: PredictionResult;
  private lastProactiveSignal?: ProactiveSignal;
  private lastEventTimestampMs = 0;
  private lastRelationTimestampMs = 0;
  private firstMessageUtc?: number;
  private lastMessageUtc?: number;
  private prevMessageUtc?: number;
  private lastTriggerUtc = 0;
  private readonly prefetchedIntents = new Map<
    string,
    { confidence: number; createdAtUtc: number }
  >();
  private readonly hydrationPromise: Promise<void>;
  private proactiveTickRunning = false;

  constructor(private readonly deps: PartitionMemoryManagerDeps) {
    this.keywordIndex = deps.keywordIndex ?? new InvertedIndex();
    this.relationGraph = deps.relationGraph ?? new RelationGraph();
    this.activeBlock = this.createEmptyBlock();
    this.relationQueue = new AsyncRelationQueue(
      deps.relationExtractor,
      this.relationGraph,
      async (block, limit) => {
        return selectTopNeighbors(block, this.blockTable.values(), limit);
      },
      {
        maxNeighbors: Math.max(1, this.deps.config.semanticTopK),
        relationStore: this.deps.relationStore,
        relationTimestampResolver: (block) => this.nextRelationTimestampMs(block.endTime),
        onError: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[relation-queue] processing failed: ${message}`);
        }
      }
    );
    this.hydrationPromise = this.hydrateFromPersistence();
  }

  async addEvent(event: MemoryEvent): Promise<void> {
    await this.hydrationPromise;
    const normalizedEvent = this.normalizeIncomingEvent(event);
    if (this.shouldProactiveSeal(normalizedEvent)) {
      await this.sealCurrentBlock();
    }
    if (this.shouldCutBlock(normalizedEvent)) {
      await this.sealCurrentBlock();
    }
    this.captureMessageTimeline(normalizedEvent.timestamp);
    this.activeBlock.addEvent(normalizedEvent);

    const hardLimitReached =
      this.activeBlock.tokenCount >= Math.floor(this.deps.config.maxTokensPerBlock * 1.5);
    if (hardLimitReached) {
      await this.sealCurrentBlock();
    }
  }

  async getContext(query: string, triggerSource: ProactiveTriggerSource = "user"): Promise<Context> {
    await this.hydrationPromise;
    const blocks = await this.retrieveBlocks(query, triggerSource);
    const hydrated = await this.deps.backtracker.fillRawEvents(blocks);
    const recentEvents = this.collectRecentEvents();
    return this.deps.contextAssembler.assemble(
      hydrated,
      recentEvents,
      this.lastPrediction,
      this.lastProactiveSignal
    );
  }

  async sealCurrentBlock(): Promise<void> {
    await this.hydrationPromise;
    if (this.activeBlock.rawEvents.length === 0) return;

    const sealed = this.activeBlock;
    const history = [...this.blockTable.values()];
    await this.deps.sealProcessor.process(sealed, history);

    this.blockTable.set(sealed.id, sealed);
    await this.deps.blockStore.upsert(sealed);
    this.keywordIndex.add(sealed.id, sealed.keywords);
    await this.deps.vectorStore.add(sealed);

    if (this.lastSealedBlockId && this.lastSealedBlockId !== sealed.id) {
      this.relationGraph.addRelation(this.lastSealedBlockId, sealed.id, RelationType.FOLLOWS);
      await this.deps.relationStore.add({
        src: this.lastSealedBlockId,
        dst: sealed.id,
        type: RelationType.FOLLOWS,
        timestamp: this.nextRelationTimestampMs(sealed.endTime),
        confidence: 1
      });
    }
    this.lastSealedBlockId = sealed.id;

    this.relationQueue.enqueue(sealed);
    this.createNewBlock();
  }

  createNewBlock(): void {
    this.activeBlock = this.createEmptyBlock();
  }

  async retrieveBlocks(query: string, triggerSource: ProactiveTriggerSource = "user"): Promise<BlockRef[]> {
    await this.hydrationPromise;
    const keywords = this.extractKeywords(query);
    const embedding = this.embed(query);
    const directionalIntent = this.parseDirectionalIntent(query);

    const initial = await this.deps.hybridRetriever.retrieve({
      query,
      keywords,
      embedding,
      activeBlockId: this.activeBlock.rawEvents.length > 0 ? this.activeBlock.id : undefined,
      directionalIntent
    });
    const scores = new Map(initial.scores);
    this.applyPendingPrefetchBoost(scores);

    const seedIds = [...initial.semanticSeedIds];
    if (this.lastSealedBlockId) seedIds.push(this.lastSealedBlockId);
    if (this.activeBlock.rawEvents.length > 0) seedIds.push(this.activeBlock.id);

    const rawPrediction = await this.deps.predictor.predict(seedIds);
    const prediction = await this.applyProactivePredictionGate(
      rawPrediction,
      embedding,
      initial.semanticSeedIds,
      triggerSource
    );
    this.lastPrediction = prediction;
    if (prediction?.activeTrigger) {
      for (const intent of prediction.intents) {
        const base = scores.get(intent.blockId) ?? 0;
        scores.set(intent.blockId, base + intent.confidence * this.deps.config.predictionBoostWeight);
      }
    }

    const blockIds = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.deps.config.finalTopK)
      .map(([blockId]) => blockId);

    const blocks = await this.deps.blockStore.getMany(blockIds);
    const byId = new Map(blocks.map((block) => [block.id, block]));

    const refs: BlockRef[] = [];
    for (const blockId of blockIds) {
      const block = byId.get(blockId);
      if (!block) continue;
      refs.push({
        id: block.id,
        score: scores.get(block.id) ?? 0,
        source: "fusion",
        summary: block.summary,
        startTime: block.startTime,
        endTime: block.endTime,
        keywords: block.keywords,
        tags: block.tags,
        rawEvents: block.rawEvents,
        retentionMode: block.retentionMode,
        matchScore: block.matchScore,
        conflict: block.conflict
      });
    }
    return refs;
  }

  async tickProactiveWakeup(): Promise<void> {
    await this.hydrationPromise;
    if (!this.deps.config.proactiveWakeupEnabled) return;
    if (this.proactiveTickRunning) return;
    this.proactiveTickRunning = true;
    try {
      await this.retrieveBlocks(PartitionMemoryManager.TIMER_PROBE_QUERY, "timer");
    } finally {
      this.proactiveTickRunning = false;
    }
  }

  getActiveBlockId(): string | undefined {
    return this.activeBlock.rawEvents.length > 0 ? this.activeBlock.id : this.lastSealedBlockId;
  }

  async flushAsyncRelations(): Promise<void> {
    await this.relationQueue.drain();
  }

  private shouldCutBlock(nextEvent: MemoryEvent): boolean {
    return this.deps.chunkStrategy.shouldSeal(this.activeBlock, nextEvent);
  }

  private shouldProactiveSeal(nextEvent: MemoryEvent): boolean {
    const config = this.deps.config;
    if (!config.proactiveSealEnabled) return false;
    if (this.activeBlock.rawEvents.length === 0) return false;

    const lastEvent = this.activeBlock.rawEvents[this.activeBlock.rawEvents.length - 1];
    if (!lastEvent) return false;

    const idleSeconds = Math.max(0, (nextEvent.timestamp - lastEvent.timestamp) / 1000);
    if (idleSeconds >= config.proactiveSealIdleSeconds) {
      return true;
    }

    if (!config.proactiveSealTurnBoundary) return false;
    const roleSwitchBoundary = lastEvent.role !== nextEvent.role;
    if (!roleSwitchBoundary) return false;

    const turnBoundaryMinTokens = Math.max(
      config.proactiveSealMinTokens,
      this.deps.config.minTokensPerBlock
    );
    return this.activeBlock.tokenCount >= turnBoundaryMinTokens;
  }

  private collectRecentEvents(): MemoryEvent[] {
    const window = Math.max(0, this.deps.config.recentEventWindow);
    if (window === 0) return [];
    if (this.blockTable.size === 0) {
      return this.activeBlock.rawEvents.slice(-window);
    }

    const events = [...this.activeBlock.rawEvents];
    const sealedBlocks = [...this.blockTable.values()].sort((a, b) => b.endTime - a.endTime);
    for (const block of sealedBlocks) {
      if (events.length >= window) break;
      for (let index = block.rawEvents.length - 1; index >= 0; index -= 1) {
        const event = block.rawEvents[index];
        if (!event) continue;
        events.unshift(event);
        if (events.length >= window) break;
      }
    }

    if (events.length <= window) return events;
    return events.slice(-window);
  }

  private extractKeywords(text: string): string[] {
    return extractKeywords(text, 8);
  }

  private embed(text: string): number[] {
    return this.deps.embedder.embed(text);
  }

  private parseDirectionalIntent(query: string): DirectionalIntent | undefined {
    if (!hasDirectionalIntent(query)) return undefined;
    const normalized = normalizeText(query);

    let direction: DirectionalIntent["direction"] = "both";
    if (containsAny(normalized, ["before", "previous", "之前", "上一步"])) {
      direction = "incoming";
    } else if (containsAny(normalized, ["after", "next", "之后", "后续", "下一步"])) {
      direction = "outgoing";
    }

    const relationTypes: RelationType[] = [];
    if (containsAny(normalized, ["cause", "because", "原因", "导致"])) {
      relationTypes.push(RelationType.CAUSES);
    }
    if (containsAny(normalized, ["parent", "父", "上层"])) {
      relationTypes.push(RelationType.PARENT_TASK);
    }
    if (containsAny(normalized, ["child", "子任务", "下层"])) {
      relationTypes.push(RelationType.CHILD_TASK);
    }
    if (relationTypes.length === 0) {
      relationTypes.push(RelationType.FOLLOWS, RelationType.CONTEXT);
    }

    return {
      direction,
      relationTypes,
      depth: this.deps.config.relationDepth
    };
  }

  private createEmptyBlock(): MemoryBlock {
    return new MemoryBlock(createId("block"));
  }

  private normalizeIncomingEvent(event: MemoryEvent): MemoryEvent {
    const incomingTimestamp = Number.isFinite(event.timestamp) ? event.timestamp : Date.now();
    const normalizedTimestamp = Math.max(incomingTimestamp, this.lastEventTimestampMs + 1);
    this.lastEventTimestampMs = normalizedTimestamp;
    if (normalizedTimestamp === event.timestamp) {
      return event;
    }
    return {
      ...event,
      timestamp: normalizedTimestamp
    };
  }

  private nextRelationTimestampMs(candidateTimestamp: number): number {
    const normalized = Number.isFinite(candidateTimestamp) ? candidateTimestamp : Date.now();
    const next = Math.max(normalized, this.lastRelationTimestampMs + 1);
    this.lastRelationTimestampMs = next;
    return next;
  }

  private async applyProactivePredictionGate(
    prediction: PredictionResult | undefined,
    queryEmbedding: number[],
    semanticSeedIds: string[],
    triggerSource: ProactiveTriggerSource
  ): Promise<PredictionResult | undefined> {
    if (!prediction) {
      this.lastProactiveSignal = {
        allowWakeup: false,
        mode: "none",
        intents: [],
        reason: "no_prediction",
        evidenceNeedHint: "none",
        triggerSource,
        timerEnabled: this.deps.config.proactiveTimerEnabled,
        timerIntervalSeconds: this.deps.config.proactiveTimerIntervalSeconds
      };
      return undefined;
    }
    if (!prediction.activeTrigger) {
      this.lastProactiveSignal = {
        allowWakeup: false,
        mode: "none",
        intents: prediction.intents,
        reason: "inactive_prediction",
        evidenceNeedHint: "none",
        triggerSource,
        timerEnabled: this.deps.config.proactiveTimerEnabled,
        timerIntervalSeconds: this.deps.config.proactiveTimerIntervalSeconds
      };
      return prediction;
    }
    const nowUtc = nowUtcSeconds();
    const lastMsgUtc = this.prevMessageUtc ?? this.lastMessageUtc ?? nowUtc;
    const firstMsgUtc = this.firstMessageUtc ?? lastMsgUtc;
    const timingDecision = proactivePolicy(nowUtc, lastMsgUtc, firstMsgUtc, this.lastTriggerUtc);
    if (!timingDecision.allow) {
      this.lastProactiveSignal = {
        allowWakeup: false,
        mode: "none",
        intents: prediction.intents,
        reason: `timing_blocked:${timingDecision.reason ?? "unknown"}`,
        evidenceNeedHint: "none",
        triggerSource,
        timerEnabled: this.deps.config.proactiveTimerEnabled,
        timerIntervalSeconds: this.deps.config.proactiveTimerIntervalSeconds
      };
      return {
        ...prediction,
        activeTrigger: false
      };
    }

    const topSemanticId = semanticSeedIds[0];
    if (!topSemanticId) {
      this.lastProactiveSignal = {
        allowWakeup: false,
        mode: "none",
        intents: prediction.intents,
        reason: "missing_semantic_seed",
        evidenceNeedHint: "none",
        triggerSource,
        timerEnabled: this.deps.config.proactiveTimerEnabled,
        timerIntervalSeconds: this.deps.config.proactiveTimerIntervalSeconds
      };
      return {
        ...prediction,
        activeTrigger: false
      };
    }
    const topSemanticBlock = await this.deps.blockStore.get(topSemanticId);
    const passed = shouldProactiveRetrieve(
      {
        predProbs: prediction.intents.map((intent) => intent.confidence),
        queryVec: queryEmbedding,
        topSummaryVec: topSemanticBlock?.embedding
      },
      timingDecision.mode === "prefetch" ? PREFETCH_RETRIEVE_THRESHOLDS : undefined
    );
    if (!passed) {
      this.lastProactiveSignal = {
        allowWakeup: false,
        mode: "none",
        intents: prediction.intents,
        reason: "retrieve_gate_blocked",
        evidenceNeedHint: "none",
        triggerSource,
        timerEnabled: this.deps.config.proactiveTimerEnabled,
        timerIntervalSeconds: this.deps.config.proactiveTimerIntervalSeconds
      };
      return {
        ...prediction,
        activeTrigger: false
      };
    }

    const depth = timingDecision.depth ?? 1;
    const intents = prediction.intents.slice(0, depth);
    const transitionProbabilities = prediction.transitionProbabilities.slice(0, Math.max(depth, 1));

    if (timingDecision.mode === "prefetch") {
      this.stagePrefetch(intents, nowUtc);
      this.lastProactiveSignal = {
        allowWakeup: false,
        mode: "prefetch",
        intents,
        reason: "prefetch_only",
        evidenceNeedHint: "none",
        triggerSource,
        timerEnabled: this.deps.config.proactiveTimerEnabled,
        timerIntervalSeconds: this.deps.config.proactiveTimerIntervalSeconds
      };
      return {
        ...prediction,
        activeTrigger: false,
        intents,
        transitionProbabilities
      };
    }

    clearPrefetchedIntents(this.prefetchedIntents);
    this.lastTriggerUtc = nowUtc;
    const evidenceNeedHint = this.deps.config.proactiveWakeupRequireEvidence
      ? "search_required"
      : "search_optional";
    this.lastProactiveSignal = {
      allowWakeup: true,
      mode: "inject",
      intents,
      reason: "inject_ready",
      evidenceNeedHint,
      triggerSource,
      timerEnabled: this.deps.config.proactiveTimerEnabled,
      timerIntervalSeconds: this.deps.config.proactiveTimerIntervalSeconds
    };

    return {
      ...prediction,
      activeTrigger: true,
      intents,
      transitionProbabilities
    };
  }

  private stagePrefetch(intents: PredictedIntent[], nowUtc: number): void {
    stagePrefetchedIntents(this.prefetchedIntents, intents, nowUtc);
    this.lastTriggerUtc = nowUtc;
  }

  private applyPendingPrefetchBoost(scores: Map<string, number>): void {
    applyPrefetchBoost(this.prefetchedIntents, scores, nowUtcSeconds(), {
      ttlSeconds: PREFETCH_TTL_SECONDS,
      boostRatio: PREFETCH_BOOST_RATIO,
      predictionBoostWeight: this.deps.config.predictionBoostWeight
    });
  }

  private async hydrateFromPersistence(): Promise<void> {
    const blocks = await this.deps.blockStore.list();
    const sortedBlocks = [...blocks].sort((a, b) => a.endTime - b.endTime);
    if (sortedBlocks.length > 0) {
      this.firstMessageUtc = toUtcSeconds(sortedBlocks[0]?.startTime ?? Date.now());
      this.lastMessageUtc = toUtcSeconds(sortedBlocks[sortedBlocks.length - 1]?.endTime ?? Date.now());
      this.prevMessageUtc = this.lastMessageUtc;
      this.lastEventTimestampMs = sortedBlocks[sortedBlocks.length - 1]?.endTime ?? 0;
    }
    for (const block of sortedBlocks) {
      this.blockTable.set(block.id, block);
      this.keywordIndex.add(block.id, block.keywords);
      await this.deps.vectorStore.add(block);
      this.lastSealedBlockId = block.id;
    }

    const relations = await this.deps.relationStore.listAll();
    for (const relation of relations) {
      this.lastRelationTimestampMs = Math.max(this.lastRelationTimestampMs, relation.timestamp);
    }
    for (const relation of relations) {
      this.relationGraph.addRelation(relation.src, relation.dst, relation.type);
    }
  }

  private captureMessageTimeline(timestampMs: number): void {
    const currentUtc = toUtcSeconds(timestampMs);
    if (!this.firstMessageUtc) {
      this.firstMessageUtc = currentUtc;
      this.lastMessageUtc = currentUtc;
      this.prevMessageUtc = currentUtc;
      return;
    }
    this.prevMessageUtc = this.lastMessageUtc;
    this.lastMessageUtc = currentUtc;
  }
}

function containsAny(text: string, candidates: string[]): boolean {
  return candidates.some((candidate) => text.includes(candidate));
}

function computeNeighborScore(current: MemoryBlock, candidate: MemoryBlock): number {
  const lexical = keywordOverlapScore(current.keywords, candidate.keywords);
  const recency = recencyAffinity(current.endTime, candidate.endTime);
  return lexical * 0.7 + recency * 0.3;
}

function selectTopNeighbors(
  current: MemoryBlock,
  candidates: Iterable<MemoryBlock>,
  limit: number
): MemoryBlock[] {
  if (limit <= 0) return [];
  const top: Array<{ item: MemoryBlock; score: number }> = [];

  for (const candidate of candidates) {
    if (candidate.id === current.id) continue;
    const score = computeNeighborScore(current, candidate);

    if (top.length < limit) {
      top.push({ item: candidate, score });
      top.sort((left, right) => left.score - right.score);
      continue;
    }

    const weakest = top[0];
    if (!weakest || score <= weakest.score) continue;
    top[0] = { item: candidate, score };
    top.sort((left, right) => left.score - right.score);
  }

  return top
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.item);
}

function keywordOverlapScore(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right.map((keyword) => keyword.toLowerCase()));
  let overlap = 0;
  for (const keyword of left) {
    if (rightSet.has(keyword.toLowerCase())) {
      overlap += 1;
    }
  }
  return overlap / Math.max(left.length, right.length, 1);
}

function recencyAffinity(currentEnd: number, candidateEnd: number): number {
  const delta = Math.abs(currentEnd - candidateEnd);
  const hour = 60 * 60 * 1000;
  if (delta <= hour) return 1;
  if (delta <= 6 * hour) return 0.75;
  if (delta <= 24 * hour) return 0.45;
  if (delta <= 72 * hour) return 0.2;
  return 0.08;
}

function toUtcSeconds(timestampMs: number): number {
  return Math.floor(timestampMs / 1000);
}

function nowUtcSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

const PREFETCH_TTL_SECONDS = 30 * 60;
const PREFETCH_BOOST_RATIO = 0.6;
const PREFETCH_RETRIEVE_THRESHOLDS = {
  entropyRejectThreshold: 0.75,
  entropyAcceptThreshold: 0.5,
  marginThreshold: 0.05,
  semanticThreshold: 0.35
};
