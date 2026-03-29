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
  sqliteFilePath: string;
  lanceFilePath: string;
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
  vectorMinScore: 0.2,
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
    sqliteFilePath: process.env.MLEX_SQLITE_FILE ?? ".mlex/memory.db",
    lanceFilePath: process.env.MLEX_LANCE_FILE ?? ".mlex/lance-blocks.json",
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
  validateEnum("component.storageBackend", config.component.storageBackend, [
    "memory",
    "sqlite",
    "lance",
    "chroma"
  ]);
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
  return config;
}

function validateEnum(name: string, value: string, allowed: string[]): void {
  if (allowed.includes(value)) return;
  throw new Error(`Invalid ${name}: ${value}. Allowed values: ${allowed.join(", ")}`);
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
