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

export type BlockTag = "important" | "normal";

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

export type ProactiveAction = "noop" | "nudge_user" | "ask_followup" | "summarize";

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
  predictionTransitionDecay: number;
  predictionBoostWeight: number;
  searchAugmentMode: SearchAugmentMode;
  searchScheduleMinutes: number;
  searchTopK: number;
  proactiveWakeupEnabled: boolean;
  proactiveWakeupMinIntervalSeconds: number;
  proactiveWakeupMaxPerHour: number;
  proactiveWakeupRequireEvidence: boolean;
  proactiveTimerEnabled: boolean;
  proactiveTimerIntervalSeconds: number;
}
