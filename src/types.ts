export type BlockId = string;

export type EventRole = "system" | "user" | "assistant" | "tool";

export interface MemoryEvent {
  id: string;
  role: EventRole;
  text: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export type RetentionMode = "compressed" | "raw" | "conflict";

export type BlockTag = string;

export enum RelationType {
  CAUSES = "CAUSES",
  FOLLOWS = "FOLLOWS",
  PARENT_TASK = "PARENT_TASK",
  CHILD_TASK = "CHILD_TASK",
  ALTERNATIVE = "ALTERNATIVE",
  CONTEXT = "CONTEXT",
  SNAPSHOT_OF_FILE = "SNAPSHOT_OF_FILE",
  FILE_MENTIONS_BLOCK = "FILE_MENTIONS_BLOCK"
}

export type RelationLabel = RelationType | (string & {});

export interface BlockRef {
  id: BlockId;
  score: number;
  source: "keyword" | "vector" | "graph" | "fusion";
  summary: string;
  startTime: number;
  endTime: number;
  keywords: string[];
  tags?: BlockTag[];
  rawEvents?: MemoryEvent[];
  retentionMode?: RetentionMode;
  matchScore?: number;
  conflict?: boolean;
}

export interface PredictedIntent {
  blockId: BlockId;
  label: string;
  confidence: number;
}

export interface PredictionResult {
  vector: number[];
  intents: PredictedIntent[];
  activeTrigger: boolean;
  transitionProbabilities: Array<{ blockId: BlockId; probability: number }>;
  predictionWeight?: number;
  rerankShift?: number;
  deltaRank?: number;
  baseScore?: number;
  finalScore?: number;
  maxScoreGap?: number;
  maxBoost?: number;
  preTopScores?: Array<{ blockId: BlockId; score: number }>;
  postTopScores?: Array<{ blockId: BlockId; score: number }>;
}

export type ProactiveSignalMode = "inject" | "prefetch" | "none";

export type ProactiveEvidenceNeed = "none" | "search_optional" | "search_required";

export type ProactiveTriggerSource = "user" | "timer";

export interface ProactiveSignal {
  allowWakeup: boolean;
  mode: ProactiveSignalMode;
  intents: PredictedIntent[];
  reason: string;
  evidenceNeedHint: ProactiveEvidenceNeed;
  triggerSource: ProactiveTriggerSource;
  timerEnabled: boolean;
  timerIntervalSeconds: number;
}

export type ProactiveAction = "noop" | "nudge_user" | "ask_followup";

export interface ProactivePlan {
  action: ProactiveAction;
  shouldSearchEvidence: boolean;
  searchQueries: string[];
  messageSeed: string;
  reason: string;
}

export interface Context {
  blocks: BlockRef[];
  recentEvents: MemoryEvent[];
  formatted: string;
  prediction?: PredictionResult;
  proactiveSignal?: ProactiveSignal;
}

export type TraverseDirection = "incoming" | "outgoing" | "both";

export interface DirectionalIntent {
  direction: TraverseDirection;
  relationTypes: RelationType[];
  depth: number;
}

export type SearchAugmentMode = "lazy" | "auto" | "scheduled" | "predictive";

export interface ManagerConfig {
  maxTokensPerBlock: number;
  minTokensPerBlock: number;
  proactiveSealEnabled: boolean;
  proactiveSealIdleSeconds: number;
  proactiveSealTurnBoundary: boolean;
  proactiveSealMinTokens: number;
  recentEventWindow: number;
  semanticTopK: number;
  finalTopK: number;
  enableRelationExpansion: boolean;
  relationDepth: number;
  graphExpansionTopK: number;
  keywordWeight: number;
  vectorWeight: number;
  graphWeight: number;
  vectorMinScore: number;
  compressionHighMatchThreshold: number;
  compressionLowMatchThreshold: number;
  compressionSoftBand: number;
  compressionPreserveWeight: number;
  compressionMinRawTokens: number;
  conflictMarkerEnabled: boolean;
  predictionEnabled: boolean;
  predictionTopK: number;
  predictionWalkDepth: number;
  predictionActiveThreshold: number;
  predictionForceActiveTrigger: boolean;
  predictionTransitionDecay: number;
  predictionBoostWeight: number;
  predictionDenseBoostMultiplier: number;
  predictionBoostCap: number;
  predictionBaseScoreGateMax: number;
  predictionDenseConfidenceGateMin: number;
  embeddingSeed?: number;
  searchAugmentMode: SearchAugmentMode;
  searchScheduleMinutes: number;
  searchTopK: number;
  proactiveWakeupEnabled: boolean;
  proactiveWakeupMinIntervalSeconds: number;
  proactiveWakeupMaxPerHour: number;
  proactiveWakeupRequireEvidence: boolean;
  proactiveTimerEnabled: boolean;
  proactiveTimerIntervalSeconds: number;
  lowEntropyTriggerEnabled: boolean;
  lowEntropyWindowSize: number;
  lowEntropyMinSignals: number;
  lowEntropyNoveltyMax: number;
  lowEntropyRetrievalOverlapMin: number;
  lowEntropyPredictionWeightMax: number;
  lowEntropyRelationNewRateMax: number;
  lowEntropyGraphCoverageMax: number;
  lowEntropyRelationConfidenceMax: number;
  lowEntropySoftStreakK: number;
  lowEntropyHardStreakK: number;
  lowEntropySoftCooldownSeconds: number;
  lowEntropyHardCooldownSeconds: number;
  topicShiftTriggerEnabled: boolean;
  topicShiftMinKeywords: number;
  topicShiftMinTokens: number;
  topicShiftQuerySimilaritySoftMax: number;
  topicShiftQuerySimilarityHardMax: number;
  topicShiftKeywordOverlapSoftMax: number;
  topicShiftKeywordOverlapHardMax: number;
  topicShiftRetrievalOverlapSoftMax: number;
  topicShiftRetrievalOverlapHardMax: number;
  topicShiftSoftCooldownSeconds: number;
  topicShiftHardCooldownSeconds: number;
  relationTriggerEnabled: boolean;
  relationTriggerWindowSize: number;
  relationTriggerStreakRequired: number;
  relationTriggerCooldownSeconds: number;
  relationTriggerLowInfoThreshold: number;
  relationTriggerHighEntropyThreshold: number;
  relationTriggerShortChainMaxSize: number;
  relationMinConfidence: number;
  relationCandidatePromoteScore: number;
  relationCandidateDecay: number;
  relationConflictDetectionEnabled: boolean;
  // Hybrid retrieval tuning
  hybridPrescreenRatio: number;
  hybridPrescreenMin: number;
  hybridPrescreenMax: number;
  hybridRerankMultiplier: number;
  hybridRerankHardCap: number;
  hybridHashEarlyStopMinGap: number;
  hybridLocalRerankTimeoutMs: number;
  hybridRerankTextMaxChars: number;
  hybridLocalCacheMaxEntries: number;
  hybridLocalCacheTtlMs: number;
  agentMaxToolRounds: number;
}
