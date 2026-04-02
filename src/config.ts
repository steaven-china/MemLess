import type { ManagerConfig } from "./types.js";
import { loadUserTomlConfig } from "./config/toml.js";

export interface EnvironmentConfig {
  nodeEnv: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

export interface ServiceConfig {
  provider:
    | "rule-based"
    | "openai"
    | "deepseek-reasoner"
    | "anthropic-claude"
    | "google-gemini"
    | "openrouter"
    | "azure-openai"
    | "openai-compatible";
  openaiApiKey?: string;
  openaiBaseUrl: string;
  openaiModel: string;
  deepseekApiKey?: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  anthropicApiKey?: string;
  anthropicBaseUrl: string;
  anthropicModel: string;
  anthropicVersion: string;
  geminiApiKey?: string;
  geminiBaseUrl: string;
  geminiModel: string;
  openrouterApiKey?: string;
  openrouterBaseUrl: string;
  openrouterModel: string;
  openrouterAppName?: string;
  openrouterSiteUrl?: string;
  azureOpenaiApiKey?: string;
  azureOpenaiEndpoint?: string;
  azureOpenaiDeployment?: string;
  azureOpenaiApiVersion: string;
  azureOpenaiModel: string;
  openaiCompatibleApiKey?: string;
  openaiCompatibleBaseUrl?: string;
  openaiCompatibleModel: string;
}

export interface ComponentConfig {
  locale: "zh-CN" | "en-US";
  chunkStrategy: "fixed" | "semantic" | "hybrid";
  storageBackend: "memory" | "sqlite" | "lance" | "chroma";
  sqliteWorkerEnabled: boolean;
  sqliteFilePath: string;
  embedder: "hash" | "local" | "hybrid";
  embeddingModel: string;
  embeddingMirror?: string;
  localEmbedBatchWindowMs: number;
  localEmbedMaxBatchSize: number;
  localEmbedQueueMaxPending: number;
  localEmbedExecutionProvider: string;
  lanceFilePath: string;
  lanceDbPath: string;
  chromaBaseUrl?: string;
  chromaCollectionId?: string;
  chromaApiKey?: string;
  relationExtractor: "heuristic" | "openai" | "deepseek";
  relationModel: string;
  relationTimeoutMs: number;
  tagger: "heuristic" | "openai" | "deepseek";
  taggerModel: string;
  taggerTimeoutMs: number;
  taggerImportantThreshold: number;
  allowedAiTags: string[];
  includeTagsIntro: boolean;
  tagsIntroPath?: string;
  tagsTomlPath?: string;
  tagsTemplateVars: Record<string, string>;
  rawStoreBackend: "memory" | "file" | "sqlite";
  rawStoreFilePath: string;
  relationStoreBackend: "memory" | "file" | "sqlite";
  relationStoreFilePath: string;
  graphEmbeddingMethod: "node2vec" | "transe";
  searchProvider: "http";
  searchEndpoint?: string;
  searchApiKey?: string;
  webFetchEndpoint?: string;
  webFetchApiKey?: string;
  searchSeedQueries: string[];
  searchTimeoutMs: number;
  webDebugApiEnabled: boolean;
  webFileApiEnabled: boolean;
  webExposeRawContext: boolean;
  webRequestBodyMaxBytes: number;
  webAdminToken?: string;
  debugTraceEnabled: boolean;
  debugTraceMaxEntries: number;
}

export interface AppConfig {
  environment: EnvironmentConfig;
  service: ServiceConfig;
  manager: ManagerConfig;
  component: ComponentConfig;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const DEFAULT_LOCAL_EMBED_BATCH_WINDOW_MS = 5;
const DEFAULT_LOCAL_EMBED_MAX_BATCH_SIZE = 32;
const DEFAULT_LOCAL_EMBED_QUEUE_MAX_PENDING = 1024;
const DEFAULT_LOCAL_EMBED_EXECUTION_PROVIDER = "auto";

export const DEFAULT_MANAGER_CONFIG: ManagerConfig = {
  maxTokensPerBlock: 320,
  minTokensPerBlock: 120,
  proactiveSealEnabled: true,
  proactiveSealIdleSeconds: 300,
  proactiveSealTurnBoundary: true,
  proactiveSealMinTokens: 1,
  recentEventWindow: 6,
  semanticTopK: 6,
  finalTopK: 8,
  enableRelationExpansion: true,
  relationDepth: 1,
  graphExpansionTopK: 4,
  keywordWeight: 0.45,
  vectorWeight: 0.55,
  graphWeight: 0.3,
  // Set to 0 by default to work correctly with HashEmbedder (which produces
  // deterministic but non-semantic vectors).  When using a real semantic
  // embedding model (e.g. text-embedding-3-small), raise this to 0.15–0.25 to
  // filter out irrelevant low-similarity blocks from the vector retrieval path.
  vectorMinScore: 0,
  compressionHighMatchThreshold: 0.82,
  compressionLowMatchThreshold: 0.35,
  compressionSoftBand: 0.08,
  compressionPreserveWeight: 0.7,
  compressionMinRawTokens: 56,
  conflictMarkerEnabled: true,
  predictionEnabled: true,
  predictionTopK: 3,
  predictionWalkDepth: 2,
  predictionActiveThreshold: 0.45,
  predictionForceActiveTrigger: false,
  predictionTransitionDecay: 0.75,
  predictionBoostWeight: 0.25,
  predictionDenseBoostMultiplier: 0.054,
  predictionBoostCap: 0.14,
  predictionBaseScoreGateMax: 0.14,
  predictionDenseConfidenceGateMin: 0.5,
  embeddingSeed: undefined,
  searchAugmentMode: "lazy",
  searchScheduleMinutes: 30,
  searchTopK: 5,
  proactiveWakeupEnabled: false,
  proactiveWakeupMinIntervalSeconds: 600,
  proactiveWakeupMaxPerHour: 3,
  proactiveWakeupRequireEvidence: false,
  proactiveTimerEnabled: false,
  proactiveTimerIntervalSeconds: 300,
  lowEntropyTriggerEnabled: true,
  lowEntropyWindowSize: 6,
  lowEntropyMinSignals: 2,
  lowEntropyNoveltyMax: 0.2,
  lowEntropyRetrievalOverlapMin: 0.7,
  lowEntropyPredictionWeightMax: 0.02,
  lowEntropyRelationNewRateMax: 0.2,
  lowEntropyGraphCoverageMax: 0.3,
  lowEntropyRelationConfidenceMax: 0.3,
  lowEntropySoftStreakK: 2,
  lowEntropyHardStreakK: 4,
  lowEntropySoftCooldownSeconds: 300,
  lowEntropyHardCooldownSeconds: 900,
  topicShiftTriggerEnabled: true,
  topicShiftMinKeywords: 2,
  topicShiftMinTokens: 3,
  topicShiftQuerySimilaritySoftMax: 0.35,
  topicShiftQuerySimilarityHardMax: 0.2,
  topicShiftKeywordOverlapSoftMax: 0.3,
  topicShiftKeywordOverlapHardMax: 0.15,
  topicShiftRetrievalOverlapSoftMax: 0.35,
  topicShiftRetrievalOverlapHardMax: 0.2,
  topicShiftSoftCooldownSeconds: 180,
  topicShiftHardCooldownSeconds: 600,
  relationTriggerEnabled: true,
  relationTriggerWindowSize: 50,
  relationTriggerStreakRequired: 3,
  relationTriggerCooldownSeconds: 900,
  relationTriggerLowInfoThreshold: 0.25,
  relationTriggerHighEntropyThreshold: 0.75,
  relationTriggerShortChainMaxSize: 2,
  relationMinConfidence: 0.35,
  relationCandidatePromoteScore: 0.65,
  relationCandidateDecay: 0.85,
  relationConflictDetectionEnabled: true,
  chunkManifestEnabled: false,
  chunkAffectsRetrieval: false,
  chunkManifestTargetTokens: 1000,
  chunkManifestMaxTokens: 1400,
  chunkManifestMaxBlocks: 8,
  chunkManifestMaxGapMs: 900_000,
  chunkNeighborExpandEnabled: false,
  chunkNeighborWindow: 1,
  chunkNeighborScoreGate: 0.75,
  chunkMaxExpandedBlocks: 4,
  // Hybrid retrieval tuning defaults
  hybridPrescreenRatio: 0.05,
  hybridPrescreenMin: 20,
  hybridPrescreenMax: 100,
  hybridRerankMultiplier: 3,
  hybridRerankHardCap: 16,
  hybridHashEarlyStopMinGap: 0.12,
  hybridLocalRerankTimeoutMs: 350,
  hybridRerankTextMaxChars: 512,
  hybridLocalCacheMaxEntries: 2000,
  hybridLocalCacheTtlMs: 300_000,
  agentMaxToolRounds: 12
};

export interface LoadConfigOptions {
  userTomlPath?: string;
}

export function loadConfig(
  overrides: DeepPartial<AppConfig> = {},
  options: LoadConfigOptions = {}
): AppConfig {
  const shouldLoadUserToml = options.userTomlPath !== undefined || process.env.NODE_ENV !== "test";
  const userToml = shouldLoadUserToml ? loadUserTomlConfig({ filePath: options.userTomlPath }) : {};
  const environment: EnvironmentConfig = {
    nodeEnv: process.env.NODE_ENV ?? "development",
    logLevel: (process.env.LOG_LEVEL as EnvironmentConfig["logLevel"]) ?? "info"
  };

  const service: ServiceConfig = {
    provider: (process.env.MLEX_PROVIDER as ServiceConfig["provider"]) ?? "rule-based",
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? process.env.MLEX_DEEPSEEK_API_KEY,
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
    deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-reasoner",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
    anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest",
    anthropicVersion: process.env.ANTHROPIC_VERSION ?? "2023-06-01",
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiBaseUrl: process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com",
    geminiModel: process.env.GEMINI_MODEL ?? "gemini-1.5-pro",
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    openrouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    openrouterModel: process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
    openrouterAppName: process.env.OPENROUTER_APP_NAME,
    openrouterSiteUrl: process.env.OPENROUTER_SITE_URL,
    azureOpenaiApiKey: process.env.AZURE_OPENAI_API_KEY,
    azureOpenaiEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
    azureOpenaiDeployment: process.env.AZURE_OPENAI_DEPLOYMENT,
    azureOpenaiApiVersion: process.env.AZURE_OPENAI_API_VERSION ?? "2024-06-01",
    azureOpenaiModel: process.env.AZURE_OPENAI_MODEL ?? "gpt-4o-mini",
    openaiCompatibleApiKey: process.env.OPENAI_COMPATIBLE_API_KEY,
    openaiCompatibleBaseUrl: process.env.OPENAI_COMPATIBLE_BASE_URL,
    openaiCompatibleModel: process.env.OPENAI_COMPATIBLE_MODEL ?? "gpt-4o-mini"
  };

  const manager: ManagerConfig = {
    ...DEFAULT_MANAGER_CONFIG,
    maxTokensPerBlock: parseEnvNumber("MLEX_MAX_TOKENS", DEFAULT_MANAGER_CONFIG.maxTokensPerBlock),
    minTokensPerBlock: parseEnvNumber("MLEX_MIN_TOKENS", DEFAULT_MANAGER_CONFIG.minTokensPerBlock),
    proactiveSealEnabled:
      (process.env.MLEX_PROACTIVE_SEAL_ENABLED ?? "true").toLowerCase() !== "false",
    proactiveSealIdleSeconds: parseEnvNumber(
      "MLEX_PROACTIVE_SEAL_IDLE_SECONDS",
      DEFAULT_MANAGER_CONFIG.proactiveSealIdleSeconds
    ),
    proactiveSealTurnBoundary:
      (process.env.MLEX_PROACTIVE_SEAL_TURN_BOUNDARY ?? "true").toLowerCase() !== "false",
    proactiveSealMinTokens: parseEnvNumber(
      "MLEX_PROACTIVE_SEAL_MIN_TOKENS",
      DEFAULT_MANAGER_CONFIG.proactiveSealMinTokens
    ),
    recentEventWindow: parseEnvNumber(
      "MLEX_RECENT_WINDOW",
      DEFAULT_MANAGER_CONFIG.recentEventWindow
    ),
    semanticTopK: parseEnvNumber("MLEX_SEMANTIC_TOPK", DEFAULT_MANAGER_CONFIG.semanticTopK),
    finalTopK: parseEnvNumber("MLEX_FINAL_TOPK", DEFAULT_MANAGER_CONFIG.finalTopK),
    relationDepth: parseEnvNumber("MLEX_RELATION_DEPTH", DEFAULT_MANAGER_CONFIG.relationDepth),
    graphExpansionTopK: parseEnvNumber(
      "MLEX_GRAPH_TOPK",
      DEFAULT_MANAGER_CONFIG.graphExpansionTopK
    ),
    keywordWeight: parseEnvFloat("MLEX_KEYWORD_WEIGHT", DEFAULT_MANAGER_CONFIG.keywordWeight),
    vectorWeight: parseEnvFloat("MLEX_VECTOR_WEIGHT", DEFAULT_MANAGER_CONFIG.vectorWeight),
    graphWeight: parseEnvFloat("MLEX_GRAPH_WEIGHT", DEFAULT_MANAGER_CONFIG.graphWeight),
    vectorMinScore: parseEnvFloat("MLEX_VECTOR_MIN_SCORE", DEFAULT_MANAGER_CONFIG.vectorMinScore),
    compressionHighMatchThreshold: parseEnvFloat(
      "MLEX_COMPRESS_HIGH_MATCH",
      DEFAULT_MANAGER_CONFIG.compressionHighMatchThreshold
    ),
    compressionLowMatchThreshold: parseEnvFloat(
      "MLEX_COMPRESS_LOW_MATCH",
      DEFAULT_MANAGER_CONFIG.compressionLowMatchThreshold
    ),
    compressionSoftBand: parseEnvFloat(
      "MLEX_COMPRESS_SOFT_BAND",
      DEFAULT_MANAGER_CONFIG.compressionSoftBand
    ),
    compressionPreserveWeight: parseEnvFloat(
      "MLEX_COMPRESS_PRESERVE_WEIGHT",
      DEFAULT_MANAGER_CONFIG.compressionPreserveWeight
    ),
    compressionMinRawTokens: parseEnvNumber(
      "MLEX_COMPRESS_MIN_RAW_TOKENS",
      DEFAULT_MANAGER_CONFIG.compressionMinRawTokens
    ),
    conflictMarkerEnabled:
      (process.env.MLEX_CONFLICT_MARKER_ENABLED ?? "true").toLowerCase() !== "false",
    predictionEnabled: (process.env.MLEX_PREDICTION_ENABLED ?? "true").toLowerCase() !== "false",
    predictionTopK: parseEnvNumber("MLEX_PREDICTION_TOPK", DEFAULT_MANAGER_CONFIG.predictionTopK),
    predictionWalkDepth: parseEnvNumber(
      "MLEX_PREDICTION_WALK_DEPTH",
      DEFAULT_MANAGER_CONFIG.predictionWalkDepth
    ),
    predictionActiveThreshold: parseEnvFloat(
      "MLEX_PREDICTION_ACTIVE_THRESHOLD",
      DEFAULT_MANAGER_CONFIG.predictionActiveThreshold
    ),
    predictionForceActiveTrigger:
      (process.env.MLEX_PREDICTION_FORCE_ACTIVE_TRIGGER ?? "false").toLowerCase() === "true",
    predictionTransitionDecay: parseEnvFloat(
      "MLEX_PREDICTION_DECAY",
      DEFAULT_MANAGER_CONFIG.predictionTransitionDecay
    ),
    predictionBoostWeight: parseEnvFloat(
      "MLEX_PREDICTION_BOOST_WEIGHT",
      DEFAULT_MANAGER_CONFIG.predictionBoostWeight
    ),
    predictionDenseBoostMultiplier: parseEnvFloat(
      "MLEX_PREDICTION_DENSE_BOOST_MULTIPLIER",
      DEFAULT_MANAGER_CONFIG.predictionDenseBoostMultiplier
    ),
    predictionBoostCap: parseEnvFloat(
      "MLEX_PREDICTION_BOOST_CAP",
      DEFAULT_MANAGER_CONFIG.predictionBoostCap
    ),
    predictionBaseScoreGateMax: parseEnvFloat(
      "MLEX_PREDICTION_BASE_SCORE_GATE_MAX",
      DEFAULT_MANAGER_CONFIG.predictionBaseScoreGateMax
    ),
    predictionDenseConfidenceGateMin: parseEnvFloat(
      "MLEX_PREDICTION_DENSE_CONFIDENCE_GATE_MIN",
      DEFAULT_MANAGER_CONFIG.predictionDenseConfidenceGateMin
    ),
    embeddingSeed: parseOptionalEnvNumber("MLEX_EMBEDDING_SEED"),
    searchAugmentMode:
      (process.env.MLEX_SEARCH_AUGMENT_MODE as ManagerConfig["searchAugmentMode"]) ??
      DEFAULT_MANAGER_CONFIG.searchAugmentMode,
    searchScheduleMinutes: parseEnvNumber(
      "MLEX_SEARCH_SCHEDULE_MINUTES",
      DEFAULT_MANAGER_CONFIG.searchScheduleMinutes
    ),
    searchTopK: parseEnvNumber("MLEX_SEARCH_TOPK", DEFAULT_MANAGER_CONFIG.searchTopK),
    proactiveWakeupEnabled:
      (process.env.MLEX_PROACTIVE_WAKEUP_ENABLED ?? "false").toLowerCase() === "true",
    proactiveWakeupMinIntervalSeconds: parseEnvNumber(
      "MLEX_PROACTIVE_WAKEUP_MIN_INTERVAL_SECONDS",
      DEFAULT_MANAGER_CONFIG.proactiveWakeupMinIntervalSeconds
    ),
    proactiveWakeupMaxPerHour: parseEnvNumber(
      "MLEX_PROACTIVE_WAKEUP_MAX_PER_HOUR",
      DEFAULT_MANAGER_CONFIG.proactiveWakeupMaxPerHour
    ),
    proactiveWakeupRequireEvidence:
      (process.env.MLEX_PROACTIVE_WAKEUP_REQUIRE_EVIDENCE ?? "false").toLowerCase() === "true",
    proactiveTimerEnabled:
      (process.env.MLEX_PROACTIVE_TIMER_ENABLED ?? "false").toLowerCase() === "true",
    proactiveTimerIntervalSeconds: parseEnvNumber(
      "MLEX_PROACTIVE_TIMER_INTERVAL_SECONDS",
      DEFAULT_MANAGER_CONFIG.proactiveTimerIntervalSeconds
    ),
    lowEntropyTriggerEnabled:
      (process.env.MLEX_LOW_ENTROPY_TRIGGER_ENABLED ?? "true").toLowerCase() === "true",
    lowEntropyWindowSize: parseEnvNumber(
      "MLEX_LOW_ENTROPY_WINDOW_SIZE",
      DEFAULT_MANAGER_CONFIG.lowEntropyWindowSize
    ),
    lowEntropyMinSignals: parseEnvNumber(
      "MLEX_LOW_ENTROPY_MIN_SIGNALS",
      DEFAULT_MANAGER_CONFIG.lowEntropyMinSignals
    ),
    lowEntropyNoveltyMax: parseEnvFloat(
      "MLEX_LOW_ENTROPY_NOVELTY_MAX",
      DEFAULT_MANAGER_CONFIG.lowEntropyNoveltyMax
    ),
    lowEntropyRetrievalOverlapMin: parseEnvFloat(
      "MLEX_LOW_ENTROPY_RETRIEVAL_OVERLAP_MIN",
      DEFAULT_MANAGER_CONFIG.lowEntropyRetrievalOverlapMin
    ),
    lowEntropyPredictionWeightMax: parseEnvFloat(
      "MLEX_LOW_ENTROPY_PREDICTION_WEIGHT_MAX",
      DEFAULT_MANAGER_CONFIG.lowEntropyPredictionWeightMax
    ),
    lowEntropyRelationNewRateMax: parseEnvFloat(
      "MLEX_LOW_ENTROPY_RELATION_NEW_RATE_MAX",
      DEFAULT_MANAGER_CONFIG.lowEntropyRelationNewRateMax
    ),
    lowEntropyGraphCoverageMax: parseEnvFloat(
      "MLEX_LOW_ENTROPY_GRAPH_COVERAGE_MAX",
      DEFAULT_MANAGER_CONFIG.lowEntropyGraphCoverageMax
    ),
    lowEntropyRelationConfidenceMax: parseEnvFloat(
      "MLEX_LOW_ENTROPY_RELATION_CONFIDENCE_MAX",
      DEFAULT_MANAGER_CONFIG.lowEntropyRelationConfidenceMax
    ),
    lowEntropySoftStreakK: parseEnvNumber(
      "MLEX_LOW_ENTROPY_SOFT_STREAK_K",
      DEFAULT_MANAGER_CONFIG.lowEntropySoftStreakK
    ),
    lowEntropyHardStreakK: parseEnvNumber(
      "MLEX_LOW_ENTROPY_HARD_STREAK_K",
      DEFAULT_MANAGER_CONFIG.lowEntropyHardStreakK
    ),
    lowEntropySoftCooldownSeconds: parseEnvNumber(
      "MLEX_LOW_ENTROPY_SOFT_COOLDOWN_SECONDS",
      DEFAULT_MANAGER_CONFIG.lowEntropySoftCooldownSeconds
    ),
    lowEntropyHardCooldownSeconds: parseEnvNumber(
      "MLEX_LOW_ENTROPY_HARD_COOLDOWN_SECONDS",
      DEFAULT_MANAGER_CONFIG.lowEntropyHardCooldownSeconds
    ),
    topicShiftTriggerEnabled:
      (process.env.MLEX_TOPIC_SHIFT_TRIGGER_ENABLED ?? "true").toLowerCase() === "true",
    topicShiftMinKeywords: parseEnvNumber(
      "MLEX_TOPIC_SHIFT_MIN_KEYWORDS",
      DEFAULT_MANAGER_CONFIG.topicShiftMinKeywords
    ),
    topicShiftMinTokens: parseEnvNumber(
      "MLEX_TOPIC_SHIFT_MIN_TOKENS",
      DEFAULT_MANAGER_CONFIG.topicShiftMinTokens
    ),
    topicShiftQuerySimilaritySoftMax: parseEnvFloat(
      "MLEX_TOPIC_SHIFT_QUERY_SIMILARITY_SOFT_MAX",
      DEFAULT_MANAGER_CONFIG.topicShiftQuerySimilaritySoftMax
    ),
    topicShiftQuerySimilarityHardMax: parseEnvFloat(
      "MLEX_TOPIC_SHIFT_QUERY_SIMILARITY_HARD_MAX",
      DEFAULT_MANAGER_CONFIG.topicShiftQuerySimilarityHardMax
    ),
    topicShiftKeywordOverlapSoftMax: parseEnvFloat(
      "MLEX_TOPIC_SHIFT_KEYWORD_OVERLAP_SOFT_MAX",
      DEFAULT_MANAGER_CONFIG.topicShiftKeywordOverlapSoftMax
    ),
    topicShiftKeywordOverlapHardMax: parseEnvFloat(
      "MLEX_TOPIC_SHIFT_KEYWORD_OVERLAP_HARD_MAX",
      DEFAULT_MANAGER_CONFIG.topicShiftKeywordOverlapHardMax
    ),
    topicShiftRetrievalOverlapSoftMax: parseEnvFloat(
      "MLEX_TOPIC_SHIFT_RETRIEVAL_OVERLAP_SOFT_MAX",
      DEFAULT_MANAGER_CONFIG.topicShiftRetrievalOverlapSoftMax
    ),
    topicShiftRetrievalOverlapHardMax: parseEnvFloat(
      "MLEX_TOPIC_SHIFT_RETRIEVAL_OVERLAP_HARD_MAX",
      DEFAULT_MANAGER_CONFIG.topicShiftRetrievalOverlapHardMax
    ),
    topicShiftSoftCooldownSeconds: parseEnvNumber(
      "MLEX_TOPIC_SHIFT_SOFT_COOLDOWN_SECONDS",
      DEFAULT_MANAGER_CONFIG.topicShiftSoftCooldownSeconds
    ),
    topicShiftHardCooldownSeconds: parseEnvNumber(
      "MLEX_TOPIC_SHIFT_HARD_COOLDOWN_SECONDS",
      DEFAULT_MANAGER_CONFIG.topicShiftHardCooldownSeconds
    ),
    relationTriggerEnabled:
      (process.env.MLEX_RELATION_TRIGGER_ENABLED ?? "true").toLowerCase() === "true",
    relationTriggerWindowSize: parseEnvNumber(
      "MLEX_RELATION_TRIGGER_WINDOW_SIZE",
      DEFAULT_MANAGER_CONFIG.relationTriggerWindowSize
    ),
    relationTriggerStreakRequired: parseEnvNumber(
      "MLEX_RELATION_TRIGGER_STREAK_REQUIRED",
      DEFAULT_MANAGER_CONFIG.relationTriggerStreakRequired
    ),
    relationTriggerCooldownSeconds: parseEnvNumber(
      "MLEX_RELATION_TRIGGER_COOLDOWN_SECONDS",
      DEFAULT_MANAGER_CONFIG.relationTriggerCooldownSeconds
    ),
    relationTriggerLowInfoThreshold: parseEnvFloat(
      "MLEX_RELATION_TRIGGER_LOW_INFO_THRESHOLD",
      DEFAULT_MANAGER_CONFIG.relationTriggerLowInfoThreshold
    ),
    relationTriggerHighEntropyThreshold: parseEnvFloat(
      "MLEX_RELATION_TRIGGER_HIGH_ENTROPY_THRESHOLD",
      DEFAULT_MANAGER_CONFIG.relationTriggerHighEntropyThreshold
    ),
    relationTriggerShortChainMaxSize: parseEnvNumber(
      "MLEX_RELATION_TRIGGER_SHORT_CHAIN_MAX_SIZE",
      DEFAULT_MANAGER_CONFIG.relationTriggerShortChainMaxSize
    ),
    relationMinConfidence: parseEnvFloat(
      "MLEX_RELATION_MIN_CONFIDENCE",
      DEFAULT_MANAGER_CONFIG.relationMinConfidence
    ),
    relationCandidatePromoteScore: parseEnvFloat(
      "MLEX_RELATION_CANDIDATE_PROMOTE_SCORE",
      DEFAULT_MANAGER_CONFIG.relationCandidatePromoteScore
    ),
    relationCandidateDecay: parseEnvFloat(
      "MLEX_RELATION_CANDIDATE_DECAY",
      DEFAULT_MANAGER_CONFIG.relationCandidateDecay
    ),
    relationConflictDetectionEnabled:
      (process.env.MLEX_RELATION_CONFLICT_DETECTION_ENABLED ?? "true").toLowerCase() === "true",
    chunkManifestEnabled:
      (process.env.MLEX_CHUNK_MANIFEST_ENABLED ?? "false").toLowerCase() === "true",
    chunkAffectsRetrieval:
      (process.env.MLEX_CHUNK_AFFECTS_RETRIEVAL ?? "false").toLowerCase() === "true",
    chunkManifestTargetTokens: parseEnvNumber(
      "MLEX_CHUNK_MANIFEST_TARGET_TOKENS",
      DEFAULT_MANAGER_CONFIG.chunkManifestTargetTokens
    ),
    chunkManifestMaxTokens: parseEnvNumber(
      "MLEX_CHUNK_MANIFEST_MAX_TOKENS",
      DEFAULT_MANAGER_CONFIG.chunkManifestMaxTokens
    ),
    chunkManifestMaxBlocks: parseEnvNumber(
      "MLEX_CHUNK_MANIFEST_MAX_BLOCKS",
      DEFAULT_MANAGER_CONFIG.chunkManifestMaxBlocks
    ),
    chunkManifestMaxGapMs: parseEnvNumber(
      "MLEX_CHUNK_MANIFEST_MAX_GAP_MS",
      DEFAULT_MANAGER_CONFIG.chunkManifestMaxGapMs
    ),
    chunkNeighborExpandEnabled:
      (process.env.MLEX_CHUNK_NEIGHBOR_EXPAND_ENABLED ?? "false").toLowerCase() === "true",
    chunkNeighborWindow: parseEnvNumber(
      "MLEX_CHUNK_NEIGHBOR_WINDOW",
      DEFAULT_MANAGER_CONFIG.chunkNeighborWindow
    ),
    chunkNeighborScoreGate: parseEnvFloat(
      "MLEX_CHUNK_NEIGHBOR_SCORE_GATE",
      DEFAULT_MANAGER_CONFIG.chunkNeighborScoreGate
    ),
    chunkMaxExpandedBlocks: parseEnvNumber(
      "MLEX_CHUNK_MAX_EXPANDED_BLOCKS",
      DEFAULT_MANAGER_CONFIG.chunkMaxExpandedBlocks
    ),
    hybridPrescreenRatio: parseEnvFloat(
      "MLEX_HYBRID_PRESCREEN_RATIO",
      DEFAULT_MANAGER_CONFIG.hybridPrescreenRatio
    ),
    hybridPrescreenMin: parseEnvNumber(
      "MLEX_HYBRID_PRESCREEN_MIN",
      DEFAULT_MANAGER_CONFIG.hybridPrescreenMin
    ),
    hybridPrescreenMax: parseEnvNumber(
      "MLEX_HYBRID_PRESCREEN_MAX",
      DEFAULT_MANAGER_CONFIG.hybridPrescreenMax
    ),
    hybridRerankMultiplier: parseEnvFloat(
      "MLEX_HYBRID_RERANK_MULTIPLIER",
      DEFAULT_MANAGER_CONFIG.hybridRerankMultiplier
    ),
    hybridRerankHardCap: parseEnvNumber(
      "MLEX_HYBRID_RERANK_HARD_CAP",
      DEFAULT_MANAGER_CONFIG.hybridRerankHardCap
    ),
    hybridHashEarlyStopMinGap: parseEnvFloat(
      "MLEX_HYBRID_HASH_EARLY_STOP_MIN_GAP",
      DEFAULT_MANAGER_CONFIG.hybridHashEarlyStopMinGap
    ),
    hybridLocalRerankTimeoutMs: parseEnvNumber(
      "MLEX_HYBRID_LOCAL_RERANK_TIMEOUT_MS",
      DEFAULT_MANAGER_CONFIG.hybridLocalRerankTimeoutMs
    ),
    hybridRerankTextMaxChars: parseEnvNumber(
      "MLEX_HYBRID_RERANK_TEXT_MAX_CHARS",
      DEFAULT_MANAGER_CONFIG.hybridRerankTextMaxChars
    ),
    hybridLocalCacheMaxEntries: parseEnvNumber(
      "MLEX_HYBRID_LOCAL_CACHE_MAX",
      DEFAULT_MANAGER_CONFIG.hybridLocalCacheMaxEntries
    ),
    hybridLocalCacheTtlMs: parseEnvNumber(
      "MLEX_HYBRID_LOCAL_CACHE_TTL_MS",
      DEFAULT_MANAGER_CONFIG.hybridLocalCacheTtlMs
    ),
    agentMaxToolRounds: Math.max(
      1,
      parseEnvNumber("MLEX_AGENT_MAX_TOOL_ROUNDS", DEFAULT_MANAGER_CONFIG.agentMaxToolRounds)
    ),
    enableRelationExpansion:
      (process.env.MLEX_RELATION_EXPAND ?? "true").toLowerCase() !== "false"
  };

  const component: ComponentConfig = {
    locale:
      ((process.env.MLEX_LOCALE as ComponentConfig["locale"] | undefined) ?? "zh-CN") === "en-US"
        ? "en-US"
        : "zh-CN",
    chunkStrategy: (process.env.MLEX_CHUNK_STRATEGY as ComponentConfig["chunkStrategy"]) ?? "hybrid",
    storageBackend:
      (process.env.MLEX_STORAGE_BACKEND as ComponentConfig["storageBackend"]) ??
      (environment.nodeEnv === "test" ? "memory" : "sqlite"),
    sqliteWorkerEnabled:
      (process.env.MLEX_SQLITE_WORKER_ENABLED ?? "false").toLowerCase() === "true",
    sqliteFilePath: process.env.MLEX_SQLITE_FILE ?? ".mlex/memory.db",
    lanceFilePath: process.env.MLEX_LANCE_FILE ?? ".mlex/lance-blocks.json",
    lanceDbPath: process.env.MLEX_LANCE_DB_PATH ?? ".mlex/lancedb",
    embedder:
      (process.env.MLEX_EMBEDDER as ComponentConfig["embedder"]) ??
      (environment.nodeEnv === "test" ? "hash" : "local"),
    embeddingModel: process.env.MLEX_EMBEDDING_MODEL ?? "Xenova/multilingual-e5-small",
    embeddingMirror: process.env.MLEX_EMBEDDING_MIRROR,
    localEmbedBatchWindowMs: parseEnvNumber(
      "MLEX_LOCAL_EMBED_BATCH_WINDOW_MS",
      DEFAULT_LOCAL_EMBED_BATCH_WINDOW_MS
    ),
    localEmbedMaxBatchSize: parseEnvNumber(
      "MLEX_LOCAL_EMBED_MAX_BATCH_SIZE",
      DEFAULT_LOCAL_EMBED_MAX_BATCH_SIZE
    ),
    localEmbedQueueMaxPending: parseEnvNumber(
      "MLEX_LOCAL_EMBED_QUEUE_MAX_PENDING",
      DEFAULT_LOCAL_EMBED_QUEUE_MAX_PENDING
    ),
    localEmbedExecutionProvider:
      process.env.MLEX_LOCAL_EMBED_EXECUTION_PROVIDER ?? DEFAULT_LOCAL_EMBED_EXECUTION_PROVIDER,
    chromaBaseUrl: process.env.MLEX_CHROMA_BASE_URL,
    chromaCollectionId: process.env.MLEX_CHROMA_COLLECTION,
    chromaApiKey: process.env.MLEX_CHROMA_API_KEY,
    relationExtractor:
      (process.env.MLEX_RELATION_EXTRACTOR as ComponentConfig["relationExtractor"]) ?? "heuristic",
    relationModel: process.env.MLEX_RELATION_MODEL ?? "gpt-4.1-nano",
    relationTimeoutMs: parseEnvNumber("MLEX_RELATION_TIMEOUT_MS", 12000),
    tagger: (process.env.MLEX_TAGGER as ComponentConfig["tagger"]) ?? "heuristic",
    taggerModel: process.env.MLEX_TAGGER_MODEL ?? "gpt-4.1-nano",
    taggerTimeoutMs: parseEnvNumber("MLEX_TAGGER_TIMEOUT_MS", 10000),
    taggerImportantThreshold: parseEnvFloat("MLEX_TAGGER_IMPORTANT_THRESHOLD", 0.6),
    allowedAiTags: parseAllowedAiTags(process.env.MLEX_ALLOWED_AI_TAGS),
    includeTagsIntro: (process.env.MLEX_INCLUDE_TAGS_INTRO ?? "true").toLowerCase() !== "false",
    tagsIntroPath: process.env.MLEX_TAGS_INTRO,
    tagsTomlPath: process.env.MLEX_TAGS_TOML,
    tagsTemplateVars: parseTagTemplateVarsFromEnv(process.env),
    rawStoreBackend:
      (process.env.MLEX_RAW_STORE_BACKEND as ComponentConfig["rawStoreBackend"]) ??
      (environment.nodeEnv === "test" ? "memory" : "sqlite"),
    rawStoreFilePath: process.env.MLEX_RAW_STORE_FILE ?? ".mlex/raw-events.json",
    relationStoreBackend:
      (process.env.MLEX_RELATION_STORE_BACKEND as ComponentConfig["relationStoreBackend"]) ??
      (environment.nodeEnv === "test" ? "memory" : "sqlite"),
    relationStoreFilePath: process.env.MLEX_RELATION_STORE_FILE ?? ".mlex/relations.json",
    graphEmbeddingMethod:
      (process.env.MLEX_GRAPH_EMBEDDING_METHOD as ComponentConfig["graphEmbeddingMethod"]) ??
      "node2vec",
    searchProvider: (process.env.MLEX_SEARCH_PROVIDER as ComponentConfig["searchProvider"]) ?? "http",
    searchEndpoint: process.env.MLEX_SEARCH_ENDPOINT,
    searchApiKey: process.env.MLEX_SEARCH_API_KEY,
    webFetchEndpoint: process.env.MLEX_WEB_FETCH_ENDPOINT,
    webFetchApiKey: process.env.MLEX_WEB_FETCH_API_KEY,
    searchSeedQueries: parseEnvCsv("MLEX_SEARCH_SEED_QUERIES"),
    searchTimeoutMs: parseEnvNumber("MLEX_SEARCH_TIMEOUT_MS", 15000),
    webDebugApiEnabled:
      (process.env.MLEX_WEB_DEBUG_API_ENABLED ?? "false").toLowerCase() === "true",
    webFileApiEnabled:
      (process.env.MLEX_WEB_FILE_API_ENABLED ?? "false").toLowerCase() === "true",
    webExposeRawContext:
      (process.env.MLEX_WEB_EXPOSE_RAW_CONTEXT ?? "false").toLowerCase() === "true",
    webRequestBodyMaxBytes: parseEnvNumber("MLEX_WEB_REQUEST_BODY_MAX_BYTES", 256 * 1024),
    webAdminToken: process.env.MLEX_WEB_ADMIN_TOKEN,
    debugTraceEnabled:
      (process.env.MLEX_DEBUG_TRACE_ENABLED ?? "true").toLowerCase() !== "false",
    debugTraceMaxEntries: parseEnvNumber("MLEX_DEBUG_TRACE_MAX_ENTRIES", 2000)
  };

  const baseConfig: AppConfig = { environment, service, manager, component };
  const merged = deepMerge(deepMerge(baseConfig, userToml), overrides);
  return validateConfig(merged);
}

function validateConfig(config: AppConfig): AppConfig {
  validateEnum("service.provider", config.service.provider, [
    "rule-based",
    "openai",
    "deepseek-reasoner",
    "anthropic-claude",
    "google-gemini",
    "openrouter",
    "azure-openai",
    "openai-compatible"
  ]);
  validateEnum("component.locale", config.component.locale, ["zh-CN", "en-US"]);
  validateEnum("component.chunkStrategy", config.component.chunkStrategy, ["fixed", "semantic", "hybrid"]);
  validateEnum("component.embedder", config.component.embedder, ["hash", "local", "hybrid"]);
  validateEnum("component.storageBackend", config.component.storageBackend, [
    "memory",
    "sqlite",
    "lance",
    "chroma"
  ]);
  if (typeof config.component.sqliteWorkerEnabled !== "boolean") {
    throw new Error("Invalid component.sqliteWorkerEnabled: must be boolean");
  }
  validateEnum("component.rawStoreBackend", config.component.rawStoreBackend, [
    "memory",
    "file",
    "sqlite"
  ]);
  validateEnum("component.relationStoreBackend", config.component.relationStoreBackend, [
    "memory",
    "file",
    "sqlite"
  ]);
  validateEnum("component.graphEmbeddingMethod", config.component.graphEmbeddingMethod, [
    "node2vec",
    "transe"
  ]);
  validateEnum("component.relationExtractor", config.component.relationExtractor, [
    "heuristic",
    "openai",
    "deepseek"
  ]);
  validateEnum("component.tagger", config.component.tagger, ["heuristic", "openai", "deepseek"]);
  validateEnum("component.searchProvider", config.component.searchProvider, ["http"]);
  validateEnum("manager.searchAugmentMode", config.manager.searchAugmentMode, [
    "lazy",
    "auto",
    "scheduled",
    "predictive"
  ]);
  validateIntegerAtLeast(
    "manager.chunkManifestTargetTokens",
    config.manager.chunkManifestTargetTokens,
    1
  );
  validateIntegerAtLeast(
    "manager.chunkManifestMaxTokens",
    config.manager.chunkManifestMaxTokens,
    0
  );
  validateIntegerAtLeast("manager.chunkManifestMaxBlocks", config.manager.chunkManifestMaxBlocks, 0);
  validateIntegerAtLeast("manager.chunkManifestMaxGapMs", config.manager.chunkManifestMaxGapMs, 0);
  if (
    config.manager.chunkManifestMaxTokens > 0 &&
    config.manager.chunkManifestTargetTokens > config.manager.chunkManifestMaxTokens
  ) {
    throw new Error(
      `Invalid manager chunk manifest token bounds: target=${config.manager.chunkManifestTargetTokens}, max=${config.manager.chunkManifestMaxTokens}`
    );
  }
  validateIntegerAtLeast("manager.chunkNeighborWindow", config.manager.chunkNeighborWindow, 0);
  validateRange("manager.chunkNeighborScoreGate", config.manager.chunkNeighborScoreGate, 0, 1);
  validateIntegerAtLeast("manager.chunkMaxExpandedBlocks", config.manager.chunkMaxExpandedBlocks, 0);
  if (config.manager.chunkAffectsRetrieval) {
    throw new Error("Invalid manager.chunkAffectsRetrieval: current mode only supports false");
  }
  validateRange("manager.hybridPrescreenRatio", config.manager.hybridPrescreenRatio, 0, 1);
  validateIntegerAtLeast("manager.hybridPrescreenMin", config.manager.hybridPrescreenMin, 1);
  validateIntegerAtLeast("manager.hybridPrescreenMax", config.manager.hybridPrescreenMax, 1);
  if (config.manager.hybridPrescreenMin > config.manager.hybridPrescreenMax) {
    throw new Error(
      `Invalid manager hybrid prescreen bounds: min=${config.manager.hybridPrescreenMin}, max=${config.manager.hybridPrescreenMax}`
    );
  }
  validateAtLeast("manager.hybridRerankMultiplier", config.manager.hybridRerankMultiplier, 1);
  validateIntegerAtLeast("manager.hybridRerankHardCap", config.manager.hybridRerankHardCap, 1);
  validateRange(
    "manager.hybridHashEarlyStopMinGap",
    config.manager.hybridHashEarlyStopMinGap,
    0,
    1
  );
  validateIntegerAtLeast(
    "manager.hybridLocalRerankTimeoutMs",
    config.manager.hybridLocalRerankTimeoutMs,
    1
  );
  validateIntegerAtLeast(
    "manager.hybridRerankTextMaxChars",
    config.manager.hybridRerankTextMaxChars,
    16
  );
  validateIntegerAtLeast(
    "manager.hybridLocalCacheMaxEntries",
    config.manager.hybridLocalCacheMaxEntries,
    0
  );
  validateIntegerAtLeast("manager.hybridLocalCacheTtlMs", config.manager.hybridLocalCacheTtlMs, 0);
  validateIntegerAtLeast("manager.topicShiftMinKeywords", config.manager.topicShiftMinKeywords, 1);
  validateIntegerAtLeast("manager.topicShiftMinTokens", config.manager.topicShiftMinTokens, 1);
  validateRange(
    "manager.topicShiftQuerySimilaritySoftMax",
    config.manager.topicShiftQuerySimilaritySoftMax,
    0,
    1
  );
  validateRange(
    "manager.topicShiftQuerySimilarityHardMax",
    config.manager.topicShiftQuerySimilarityHardMax,
    0,
    1
  );
  validateRange(
    "manager.topicShiftKeywordOverlapSoftMax",
    config.manager.topicShiftKeywordOverlapSoftMax,
    0,
    1
  );
  validateRange(
    "manager.topicShiftKeywordOverlapHardMax",
    config.manager.topicShiftKeywordOverlapHardMax,
    0,
    1
  );
  validateRange(
    "manager.topicShiftRetrievalOverlapSoftMax",
    config.manager.topicShiftRetrievalOverlapSoftMax,
    0,
    1
  );
  validateRange(
    "manager.topicShiftRetrievalOverlapHardMax",
    config.manager.topicShiftRetrievalOverlapHardMax,
    0,
    1
  );
  validateIntegerAtLeast(
    "manager.topicShiftSoftCooldownSeconds",
    config.manager.topicShiftSoftCooldownSeconds,
    0
  );
  validateIntegerAtLeast(
    "manager.topicShiftHardCooldownSeconds",
    config.manager.topicShiftHardCooldownSeconds,
    0
  );
  if (
    config.manager.topicShiftQuerySimilarityHardMax > config.manager.topicShiftQuerySimilaritySoftMax
  ) {
    throw new Error(
      "Invalid manager topic-shift query similarity thresholds: hard max must be <= soft max."
    );
  }
  if (
    config.manager.topicShiftKeywordOverlapHardMax > config.manager.topicShiftKeywordOverlapSoftMax
  ) {
    throw new Error(
      "Invalid manager topic-shift keyword overlap thresholds: hard max must be <= soft max."
    );
  }
  if (
    config.manager.topicShiftRetrievalOverlapHardMax >
    config.manager.topicShiftRetrievalOverlapSoftMax
  ) {
    throw new Error(
      "Invalid manager topic-shift retrieval overlap thresholds: hard max must be <= soft max."
    );
  }
  validateIntegerAtLeast(
    "component.localEmbedBatchWindowMs",
    config.component.localEmbedBatchWindowMs,
    1
  );
  validateIntegerAtLeast(
    "component.localEmbedMaxBatchSize",
    config.component.localEmbedMaxBatchSize,
    1
  );
  validateIntegerAtLeast(
    "component.localEmbedQueueMaxPending",
    config.component.localEmbedQueueMaxPending,
    1
  );
  if (typeof config.component.localEmbedExecutionProvider !== "string") {
    throw new Error("Invalid component.localEmbedExecutionProvider: must be string");
  }
  if (config.component.localEmbedExecutionProvider.trim().length === 0) {
    throw new Error("Invalid component.localEmbedExecutionProvider: must be non-empty");
  }
  return config;
}

function validateEnum(name: string, value: string, allowed: string[]): void {
  if (allowed.includes(value)) return;
  throw new Error(`Invalid ${name}: ${value}. Allowed values: ${allowed.join(", ")}`);
}

function validateRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid ${name}: ${value}. Expected finite number in [${min}, ${max}].`);
  }
}

function validateAtLeast(name: string, value: number, min: number): void {
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`Invalid ${name}: ${value}. Expected finite number >= ${min}.`);
  }
}

function validateIntegerAtLeast(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`Invalid ${name}: ${value}. Expected integer >= ${min}.`);
  }
}

function parseEnvNumber(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseEnvFloat(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseOptionalEnvNumber(name: string): number | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseEnvCsv(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseAllowedAiTags(raw: string | undefined): string[] {
  const tags = (raw ?? "important,normal")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  const deduped = [...new Set(tags)];
  return deduped.length > 0 ? deduped : ["normal"];
}

function parseTagTemplateVarsFromEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("MLEX_TAG_VAR_")) continue;
    if (typeof value !== "string") continue;
    const name = key.slice("MLEX_TAG_VAR_".length).trim();
    if (!name) continue;
    output[name] = value;
  }
  return output;
}

function deepMerge<T extends object>(base: T, overrides: DeepPartial<T>): T {
  const output: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    if (isRecord(value) && isRecord(output[key])) {
      output[key] = deepMerge(
        output[key] as Record<string, unknown>,
        value as DeepPartial<Record<string, unknown>>
      );
      continue;
    }
    output[key] = value;
  }
  return output as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
