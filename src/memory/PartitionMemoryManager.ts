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
import { cosineSimilarity, extractKeywords, hasDirectionalIntent, normalizeText, tokenize } from "../utils/text.js";
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
  decideRelationLowInfoHighEntropy,
  type RelationTriggerDecision
} from "./prediction/RelationTriggerPolicy.js";
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
  blockIdFactory?: () => string;
  nowMs?: () => number;
  config: ManagerConfig;
}

interface RetrievalEntropyInput {
  topBlockIds: string[];
  graphHitIds: string[];
  graphHitConfidenceAvg: number;
  predictionWeight: number;
  nowUtc: number;
}

interface RetrievalEntropySnapshot {
  topBlockIds: string[];
  topBlockIdSet: Set<string>;
  top1BlockId?: string;
  graphHitIds: string[];
  graphHitIdSet: Set<string>;
  graphCoverage: number;
  relationConfidenceAvg: number;
  relationNewRate: number;
  predictionWeight: number;
  retrievalOverlap: number;
  noveltyRate: number;
  repeatRate: number;
  timestampUtc: number;
}

interface RelationTriggerSnapshot {
  totalConditionalInfo: number;
  conditionalEntropy: number;
  matched: boolean;
  timestampUtc: number;
}

interface LowEntropyDecision {
  level: "none" | "soft" | "hard";
  reason: string;
}

export class PartitionMemoryManager implements IMemoryManager {
  private static readonly TIMER_PROBE_QUERY = "__mlex_proactive_timer_probe__";
  private readonly nowMs: () => number;
  private readonly blockIdFactory: () => string;
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
  private readonly retrievalEntropyHistory: RetrievalEntropySnapshot[] = [];
  private readonly relationTriggerWindow: RelationTriggerSnapshot[] = [];
  private lowEntropyStreak = 0;
  private relationTriggerStreak = 0;
  private lastLowEntropySoftUtc = 0;
  private lastLowEntropyHardUtc = 0;
  private relationTriggerLastHardUtc = 0;
  // Per-signal raw-value history for variance-based weight computation.
  // Order: [noveltyRate, retrievalOverlap, predictionWeight, relationNewRate, graphCoverage, relationConfidenceAvg]
  private readonly entropySignalHistory: number[][] = [[], [], [], [], [], []];

  constructor(private readonly deps: PartitionMemoryManagerDeps) {
    this.nowMs = deps.nowMs ?? (() => Date.now());
    this.blockIdFactory = deps.blockIdFactory ?? (() => createId("block"));
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
        minConfidence: this.deps.config.relationMinConfidence,
        relationTypeAliases: {
          cause: RelationType.CAUSES,
          causes: RelationType.CAUSES,
          follows: RelationType.FOLLOWS,
          follow: RelationType.FOLLOWS,
          parent: RelationType.PARENT_TASK,
          child: RelationType.CHILD_TASK,
          alternative: RelationType.ALTERNATIVE,
          context: RelationType.CONTEXT
        },
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
    const embedding = await this.embed(query);
    const directionalIntent = this.parseDirectionalIntent(query);

    const initial = await this.deps.hybridRetriever.retrieve({
      query,
      keywords,
      embedding,
      activeBlockId: this.activeBlock.rawEvents.length > 0 ? this.activeBlock.id : undefined,
      directionalIntent
    });
    const scores = new Map(initial.scores);

    // Give the un-sealed activeBlock a chance to surface in results.
    // It has no indexed embedding/keywords yet, so we score it inline using the
    // same signals the sealed blocks use: keyword overlap (Jaccard) + cosine
    // similarity against a freshly computed embedding.  Only inject if the
    // score clears the keyword minimum (> 0) to avoid noise on unrelated turns.
    if (this.activeBlock.rawEvents.length > 0) {
      const activeText = this.activeBlock.rawEvents.map((e) => e.text).join(" ");
      const activeKeywords = extractKeywords(activeText, 8);
      const activeEmbedding = await this.embed(activeText);
      const activeUnion = new Set([
        ...keywords.map((s) => s.toLowerCase()),
        ...activeKeywords.map((s) => s.toLowerCase())
      ]).size;
      const activeOverlap = keywords.filter((k) =>
        activeKeywords.some((ak) => ak.toLowerCase() === k.toLowerCase())
      ).length;
      const keywordScore = activeUnion === 0 ? 0 : activeOverlap / activeUnion;
      const vectorScore = cosineSimilarity(embedding, activeEmbedding);
      const activeScore = keywordScore * 0.5 + vectorScore * 0.5;
      if (activeScore > 0) {
        scores.set(this.activeBlock.id, Math.max(scores.get(this.activeBlock.id) ?? 0, activeScore));
      }
    }
    this.applyPendingPrefetchBoost(scores);
    const prePredictionScores = new Map(scores);
    // Removed noisy prePredictionScores console.info

    const seedIds = [...initial.semanticSeedIds];
    if (this.lastSealedBlockId) seedIds.push(this.lastSealedBlockId);
    if (this.activeBlock.rawEvents.length > 0) seedIds.push(this.activeBlock.id);

    const rawPrediction = await this.deps.predictor.predict(seedIds);
    const prediction = await this.applyProactivePredictionGate(
      rawPrediction,
      embedding,
      initial.semanticSeedIds,
      triggerSource,
      query,
      keywords
    );
    const isSparseQuery = isKeywordSparseQuery(query, keywords);
    const boostMultiplier = isSparseQuery
      ? KEYWORD_SPARSE_BOOST_MULTIPLIER
      : this.deps.config.predictionDenseBoostMultiplier;
    let maxBoost = 0;
    if (prediction?.activeTrigger) {
      for (const intent of prediction.intents) {
        const base = scores.get(intent.blockId) ?? 0;
        if (boostMultiplier <= 0) continue;
        if (isSparseQuery) {
          if (base > this.deps.config.predictionBaseScoreGateMax) continue;
        } else {
          const denseGatePassed =
            intent.confidence >= this.deps.config.predictionDenseConfidenceGateMin ||
            base <= this.deps.config.predictionBaseScoreGateMax;
          if (!denseGatePassed) continue;
        }
        const boost = computePredictionBoost(
          intent.confidence,
          this.deps.config.predictionBoostWeight,
          boostMultiplier,
          this.deps.config.predictionBoostCap
        );
        maxBoost = Math.max(maxBoost, boost);
        scores.set(intent.blockId, base + boost);
      }
    }
    this.lastPrediction = this.attachPredictionDiagnostics(
      prediction,
      prePredictionScores,
      scores,
      boostMultiplier,
      maxBoost
    );

    const blockIds = sortScoreEntries(scores)
      .slice(0, this.deps.config.finalTopK)
      .map(([blockId]) => blockId);

    this.applyLowEntropySignalOverride(
      {
        topBlockIds: blockIds,
        graphHitIds: initial.graphHitIds ?? [],
        graphHitConfidenceAvg: initial.graphHitConfidenceAvg ?? 0,
        predictionWeight: this.lastPrediction?.predictionWeight ?? 0,
        nowUtc: this.nowUtcSeconds()
      },
      triggerSource,
      prediction?.intents ?? []
    );

    const blocks = await this.deps.blockStore.getMany(blockIds);
    const byId = new Map(blocks.map((block) => [block.id, block]));
    // Also make the activeBlock available by id so it can surface as a ref.
    if (this.activeBlock.rawEvents.length > 0) {
      byId.set(this.activeBlock.id, this.activeBlock);
    }

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

  private async embed(text: string): Promise<number[]> {
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
    return new MemoryBlock(this.blockIdFactory(), this.nowMs());
  }

  private normalizeIncomingEvent(event: MemoryEvent): MemoryEvent {
    const incomingTimestamp = Number.isFinite(event.timestamp) ? event.timestamp : this.nowMs();
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
    const normalized = Number.isFinite(candidateTimestamp) ? candidateTimestamp : this.nowMs();
    const next = Math.max(normalized, this.lastRelationTimestampMs + 1);
    this.lastRelationTimestampMs = next;
    return next;
  }

  private nowUtcSeconds(): number {
    return Math.floor(this.nowMs() / 1000);
  }

  private async applyProactivePredictionGate(
    prediction: PredictionResult | undefined,
    queryEmbedding: number[],
    semanticSeedIds: string[],
    triggerSource: ProactiveTriggerSource,
    query: string,
    queryKeywords: string[]
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
    if (this.deps.config.predictionForceActiveTrigger) {
      this.lastProactiveSignal = {
        allowWakeup: true,
        mode: "inject",
        intents: prediction.intents,
        reason: "force_active_trigger",
        evidenceNeedHint: this.deps.config.proactiveWakeupRequireEvidence ? "search_required" : "search_optional",
        triggerSource,
        timerEnabled: this.deps.config.proactiveTimerEnabled,
        timerIntervalSeconds: this.deps.config.proactiveTimerIntervalSeconds
      };
      return {
        ...prediction,
        activeTrigger: true
      };
    }

    if (isKeywordSparseQuery(query, queryKeywords)) {
      this.lastProactiveSignal = {
        allowWakeup: true,
        mode: "inject",
        intents: prediction.intents,
        reason: "keyword_sparse_priority",
        evidenceNeedHint: this.deps.config.proactiveWakeupRequireEvidence ? "search_required" : "search_optional",
        triggerSource,
        timerEnabled: this.deps.config.proactiveTimerEnabled,
        timerIntervalSeconds: this.deps.config.proactiveTimerIntervalSeconds
      };
      return {
        ...prediction,
        activeTrigger: true
      };
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
    const nowUtc = this.nowUtcSeconds();
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

  private applyLowEntropySignalOverride(
    input: RetrievalEntropyInput,
    triggerSource: ProactiveTriggerSource,
    intents: PredictedIntent[]
  ): void {
    const relationDecision = this.decideRelationTriggerLevel(
      intents.map((intent) => intent.confidence),
      input.nowUtc
    );
    if (relationDecision.level !== "none") {
      this.lastProactiveSignal = {
        allowWakeup: true,
        mode: "inject",
        intents,
        reason: relationDecision.reason,
        evidenceNeedHint: relationDecision.level === "hard" ? "search_required" : "search_optional",
        triggerSource,
        timerEnabled: this.deps.config.proactiveTimerEnabled,
        timerIntervalSeconds: this.deps.config.proactiveTimerIntervalSeconds
      };
      return;
    }

    if (!this.deps.config.lowEntropyTriggerEnabled) return;
    const snapshot = this.captureRetrievalEntropySnapshot(input);
    const decision = this.decideLowEntropyLevel(snapshot, input.nowUtc);
    if (decision.level === "none") return;

    this.lastProactiveSignal = {
      allowWakeup: true,
      mode: "inject",
      intents,
      reason: decision.reason,
      evidenceNeedHint: decision.level === "hard" ? "search_required" : "search_optional",
      triggerSource,
      timerEnabled: this.deps.config.proactiveTimerEnabled,
      timerIntervalSeconds: this.deps.config.proactiveTimerIntervalSeconds
    };
  }

  private decideRelationTriggerLevel(
    relationProbabilities: number[],
    nowUtc: number
  ): LowEntropyDecision {
    if (!this.deps.config.relationTriggerEnabled) {
      this.relationTriggerStreak = 0;
      return { level: "none", reason: "relation_trigger_disabled" };
    }

    const decision: RelationTriggerDecision = decideRelationLowInfoHighEntropy({
      relationProbabilities,
      thresholds: {
        lowInfoThreshold: this.deps.config.relationTriggerLowInfoThreshold,
        highEntropyThreshold: this.deps.config.relationTriggerHighEntropyThreshold,
        shortChainMaxSize: this.deps.config.relationTriggerShortChainMaxSize
      }
    });

    const snapshot: RelationTriggerSnapshot = {
      totalConditionalInfo: decision.totalConditionalInfo,
      conditionalEntropy: decision.conditionalEntropy,
      matched: decision.matched,
      timestampUtc: nowUtc
    };
    this.relationTriggerWindow.push(snapshot);
    const windowSize = Math.max(1, this.deps.config.relationTriggerWindowSize);
    if (this.relationTriggerWindow.length > windowSize) {
      this.relationTriggerWindow.splice(0, this.relationTriggerWindow.length - windowSize);
    }

    if (!decision.matched) {
      this.relationTriggerStreak = 0;
      return { level: "none", reason: "relation_direction_guard_failed" };
    }

    this.relationTriggerStreak += 1;
    const required = Math.max(1, this.deps.config.relationTriggerStreakRequired);
    if (this.relationTriggerStreak >= required) {
      const cooldown = Math.max(0, this.deps.config.relationTriggerCooldownSeconds);
      if (nowUtc - this.relationTriggerLastHardUtc < cooldown) {
        return { level: "none", reason: "relation_cooldown_blocked" };
      }
      this.relationTriggerLastHardUtc = nowUtc;
      return {
        level: "hard",
        reason: decision.matchedByShortChain
          ? "relation_short_chain_hard_triggered"
          : "relation_hard_triggered"
      };
    }

    return {
      level: "soft",
      reason: decision.matchedByShortChain
        ? "relation_short_chain_soft_triggered"
        : "relation_soft_triggered"
    };
  }

  private captureRetrievalEntropySnapshot(input: RetrievalEntropyInput): RetrievalEntropySnapshot {
    const windowSize = Math.max(1, this.deps.config.lowEntropyWindowSize);
    const history = this.retrievalEntropyHistory.slice(-(windowSize - 1));
    const currentTopSet = new Set(input.topBlockIds);
    const currentGraphSet = new Set(input.graphHitIds);
    const previousTopUnion = new Set<string>();
    const previousGraphUnion = new Set<string>();

    for (const item of history) {
      for (const blockId of item.topBlockIdSet) {
        previousTopUnion.add(blockId);
      }
      for (const graphId of item.graphHitIdSet) {
        previousGraphUnion.add(graphId);
      }
    }

    const retrievalOverlap = jaccardSimilarity(currentTopSet, previousTopUnion);
    const noveltyRate = 1 - retrievalOverlap;
    const hasGraphSignals = input.graphHitIds.length > 0;
    const graphCoverage = hasGraphSignals
      ? safeRatio(countIntersect(currentTopSet, currentGraphSet), currentTopSet.size)
      : 1;
    const relationConfidenceAvg = hasGraphSignals ? clamp01(input.graphHitConfidenceAvg) : 1;
    const relationNewCount = input.graphHitIds.filter((blockId) => !previousGraphUnion.has(blockId)).length;
    const relationNewRate = hasGraphSignals ? safeRatio(relationNewCount, input.graphHitIds.length) : 1;

    const previousTop1 = history
      .map((item) => item.top1BlockId)
      .filter((item): item is string => Boolean(item));
    const currentTop1 = input.topBlockIds[0];
    const repeatRate =
      currentTop1 && previousTop1.length > 0
        ? safeRatio(previousTop1.filter((blockId) => blockId === currentTop1).length, previousTop1.length)
        : 0;

    const predictionWeights = history.map((item) => item.predictionWeight);
    predictionWeights.push(input.predictionWeight);
    const avgPredictionWeight = average(predictionWeights);

    const snapshot: RetrievalEntropySnapshot = {
      topBlockIds: input.topBlockIds,
      topBlockIdSet: currentTopSet,
      top1BlockId: currentTop1,
      graphHitIds: input.graphHitIds,
      graphHitIdSet: currentGraphSet,
      graphCoverage,
      relationConfidenceAvg,
      relationNewRate,
      predictionWeight: avgPredictionWeight,
      retrievalOverlap,
      noveltyRate,
      repeatRate,
      timestampUtc: input.nowUtc
    };

    this.retrievalEntropyHistory.push(snapshot);
    if (this.retrievalEntropyHistory.length > windowSize) {
      this.retrievalEntropyHistory.splice(0, this.retrievalEntropyHistory.length - windowSize);
    }

    // Push raw signal values into per-signal history for variance computation.
    const rawValues = [
      snapshot.noveltyRate,
      snapshot.retrievalOverlap,
      snapshot.predictionWeight,
      snapshot.relationNewRate,
      snapshot.graphCoverage,
      snapshot.relationConfidenceAvg
    ];
    for (let i = 0; i < rawValues.length; i++) {
      this.entropySignalHistory[i]!.push(rawValues[i]!);
      if (this.entropySignalHistory[i]!.length > windowSize) {
        this.entropySignalHistory[i]!.splice(0, this.entropySignalHistory[i]!.length - windowSize);
      }
    }

    return snapshot;
  }

  private decideLowEntropyLevel(snapshot: RetrievalEntropySnapshot, nowUtc: number): LowEntropyDecision {
    const config = this.deps.config;
    const boolSignals = [
      snapshot.noveltyRate < config.lowEntropyNoveltyMax,
      snapshot.retrievalOverlap > config.lowEntropyRetrievalOverlapMin,
      snapshot.predictionWeight < config.lowEntropyPredictionWeightMax,
      snapshot.relationNewRate < config.lowEntropyRelationNewRateMax,
      snapshot.graphCoverage < config.lowEntropyGraphCoverageMax,
      snapshot.relationConfidenceAvg < config.lowEntropyRelationConfidenceMax
    ];

    // Compute per-signal variance weights from sliding-window history.
    // Stable signals (low variance) → higher weight; noisy signals → lower weight.
    // Falls back to equal weight (1.0) when history is too short (< 2 points).
    const weights = computeEntropySignalWeights(this.entropySignalHistory);

    const weightedScore = boolSignals.reduce((sum, b, i) => sum + (b ? weights[i]! : 0), 0);
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    // Equivalent threshold: weighted proportion must meet minSignals / 6 ratio.
    if (weightedScore < (Math.max(1, config.lowEntropyMinSignals) / boolSignals.length) * totalWeight) {
      this.lowEntropyStreak = 0;
      return { level: "none", reason: "low_entropy_not_met" };
    }

    this.lowEntropyStreak += 1;

    const hardK = Math.max(1, config.lowEntropyHardStreakK);
    const softK = Math.max(1, config.lowEntropySoftStreakK);

    if (this.lowEntropyStreak >= hardK) {
      if (nowUtc - this.lastLowEntropyHardUtc < Math.max(0, config.lowEntropyHardCooldownSeconds)) {
        return { level: "none", reason: "low_entropy_hard_cooldown_blocked" };
      }
      this.lastLowEntropyHardUtc = nowUtc;
      this.lastLowEntropySoftUtc = nowUtc;
      return { level: "hard", reason: "low_entropy_hard" };
    }

    if (this.lowEntropyStreak >= softK) {
      if (nowUtc - this.lastLowEntropySoftUtc < Math.max(0, config.lowEntropySoftCooldownSeconds)) {
        return { level: "none", reason: "low_entropy_soft_cooldown_blocked" };
      }
      this.lastLowEntropySoftUtc = nowUtc;
      return { level: "soft", reason: "low_entropy_soft" };
    }

    return { level: "none", reason: "low_entropy_streak_accumulating" };
  }

  private stagePrefetch(intents: PredictedIntent[], nowUtc: number): void {
    stagePrefetchedIntents(this.prefetchedIntents, intents, nowUtc);
    this.lastTriggerUtc = nowUtc;
  }

  private applyPendingPrefetchBoost(scores: Map<string, number>): void {
    applyPrefetchBoost(this.prefetchedIntents, scores, this.nowUtcSeconds(), {
      ttlSeconds: PREFETCH_TTL_SECONDS,
      boostRatio: PREFETCH_BOOST_RATIO,
      predictionBoostWeight: this.deps.config.predictionBoostWeight
    });
  }

  private attachPredictionDiagnostics(
    prediction: PredictionResult | undefined,
    preScores: Map<string, number>,
    postScores: Map<string, number>,
    boostMultiplier: number,
    maxBoost: number
  ): PredictionResult | undefined {
    if (!prediction) return undefined;
    const topIntent = prediction.intents[0];
    if (!topIntent) return prediction;

    const targetId = topIntent.blockId;
    const fallbackRank = preScores.size + 1;
    const preRank = computeRank(preScores, targetId, fallbackRank);
    const postRank = computeRank(postScores, targetId, fallbackRank);
    const preScore = preScores.get(targetId) ?? 0;
    const postScore = postScores.get(targetId) ?? 0;
    const maxScoreGap = computeMaxScoreGap(postScores, targetId, this.deps.config.finalTopK);
    const preTopScores = computeTopScores(preScores, this.deps.config.finalTopK);
    const postTopScores = computeTopScores(postScores, this.deps.config.finalTopK);

    return {
      ...prediction,
      predictionWeight: computePredictionBoost(
        topIntent.confidence,
        this.deps.config.predictionBoostWeight,
        boostMultiplier,
        this.deps.config.predictionBoostCap
      ),
      rerankShift: postScore - preScore,
      deltaRank: preRank - postRank,
      baseScore: preScore,
      finalScore: postScore,
      maxScoreGap,
      maxBoost,
      preTopScores,
      postTopScores
    };
  }

  private async hydrateFromPersistence(): Promise<void> {
    const blocks = await this.deps.blockStore.list();
    const sortedBlocks = [...blocks].sort((a, b) => a.endTime - b.endTime);
    if (sortedBlocks.length > 0) {
      this.firstMessageUtc = toUtcSeconds(sortedBlocks[0]?.startTime ?? this.nowMs());
      this.lastMessageUtc = toUtcSeconds(sortedBlocks[sortedBlocks.length - 1]?.endTime ?? this.nowMs());
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

function computeRank(scores: Map<string, number>, blockId: string, fallbackRank = -1): number {
  const entries = sortScoreEntries(scores);
  const index = entries.findIndex(([id]) => id === blockId);
  return index >= 0 ? index + 1 : fallbackRank;
}

function computeMaxScoreGap(scores: Map<string, number>, blockId: string, finalTopK: number): number {
  const entries = sortScoreEntries(scores);
  const rank = entries.findIndex(([id]) => id === blockId);
  if (rank < 0) return 0;
  const targetScore = entries[rank]?.[1] ?? 0;
  const thresholdIndex = Math.max(0, Math.min(entries.length - 1, finalTopK - 1));
  const thresholdScore = entries[thresholdIndex]?.[1] ?? targetScore;
  return Math.max(0, thresholdScore - targetScore);
}

function computeTopScores(
  scores: Map<string, number>,
  limit: number
): Array<{ blockId: string; score: number }> {
  return sortScoreEntries(scores)
    .slice(0, Math.max(1, limit))
    .map(([blockId, score]) => ({ blockId, score }));
}

function sortScoreEntries(scores: Map<string, number>): Array<[string, number]> {
  return [...scores.entries()].sort((a, b) => {
    const byScore = b[1] - a[1];
    if (byScore !== 0) return byScore;
    return a[0].localeCompare(b[0]);
  });
}

function countIntersect(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const item of left) {
    if (right.has(item)) count += 1;
  }
  return count;
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 0;
  const union = new Set<string>([...left, ...right]);
  if (union.size === 0) return 0;
  return countIntersect(left, right) / union.size;
}

function safeRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Compute per-signal weights from sliding-window value histories.
 *
 * Stable signals (low variance) get higher weight; noisy signals get lower weight.
 * When a signal history has fewer than 2 points the function falls back to equal
 * weight (1.0) for that signal, preserving the same behaviour as the old equal-weight
 * count when all histories are cold-start.
 *
 * Exported for unit testing.
 */
export function computeEntropySignalWeights(signalHistories: readonly number[][]): number[] {
  const WEIGHT_MIN = 0.5;
  const WEIGHT_MAX = 2.0;
  const VARIANCE_EPS = 0.01;

  const rawWeights = signalHistories.map((history) => {
    if (history.length < 2) return 1.0;
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const variance = history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length;
    return 1 / (variance + VARIANCE_EPS);
  });

  const minW = Math.min(...rawWeights);
  const maxW = Math.max(...rawWeights);

  if (minW === maxW) return rawWeights.map(() => 1.0);

  return rawWeights.map(
    (w) => WEIGHT_MIN + ((w - minW) / (maxW - minW)) * (WEIGHT_MAX - WEIGHT_MIN)
  );
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isKeywordSparseQuery(query: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const normalizedTokens = new Set(tokenize(query));
  const matched = keywords.filter((keyword) => normalizedTokens.has(keyword.toLowerCase())).length;
  return matched / keywords.length < QUERY_KEYWORD_DENSE_RATIO;
}

function computePredictionBoost(
  confidence: number,
  predictionBoostWeight: number,
  boostMultiplier: number,
  boostCap: number
): number {
  // Removed noisy console.info for prediction-boost
  const rawBoost = confidence * predictionBoostWeight * boostMultiplier * PREDICTION_BOOST_SCALE;
  return Math.min(Math.max(rawBoost, PREDICTION_BOOST_FLOOR), boostCap);
}

const PREFETCH_TTL_SECONDS = 30 * 60;
const PREFETCH_BOOST_RATIO = 0.6;
const hasLoggedPrePredictionScores = { value: false };
const QUERY_KEYWORD_DENSE_RATIO = 0.5;
const PREDICTION_BOOST_SCALE = 14;
const PREDICTION_BOOST_FLOOR = 0;
const DEFAULT_BOOST_MULTIPLIER = 4;
const KEYWORD_SPARSE_BOOST_MULTIPLIER = 8;
const PREFETCH_RETRIEVE_THRESHOLDS = {
  entropyRejectThreshold: 0.75,
  entropyAcceptThreshold: 0.5,
  marginThreshold: 0.05,
  semanticThreshold: 0.35
};
