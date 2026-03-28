import { Agent } from "./agent/Agent.js";
import { BuiltinAgentToolExecutor } from "./agent/AgentToolExecutor.js";
import { buildProvider } from "./agent/providerFactory.js";
import type { AppConfig, DeepPartial } from "./config.js";
import { loadConfig } from "./config.js";
import type { IDebugTraceRecorder } from "./debug/DebugTraceRecorder.js";
import { InMemoryDebugTraceRecorder, NoopDebugTraceRecorder } from "./debug/DebugTraceRecorder.js";
import { createI18n } from "./i18n/index.js";
import type { I18n } from "./i18n/index.js";
import type { Locale } from "./i18n/types.js";
import { InvertedIndex } from "./memory/InvertedIndex.js";
import { PartitionMemoryManager } from "./memory/PartitionMemoryManager.js";
import { RelationGraph } from "./memory/RelationGraph.js";
import { FixedTokenChunkStrategy } from "./memory/chunking/FixedTokenChunkStrategy.js";
import { HybridChunkStrategy } from "./memory/chunking/HybridChunkStrategy.js";
import type { IChunkStrategy } from "./memory/chunking/IChunkStrategy.js";
import { SemanticBoundaryChunkStrategy } from "./memory/chunking/SemanticBoundaryChunkStrategy.js";
import { HashEmbedder } from "./memory/embedder/HashEmbedder.js";
import { HistoryMatchCalculator } from "./memory/management/HistoryMatchCalculator.js";
import { buildTagger } from "./memory/tagger/taggerFactory.js";
import { normalizeAllowedAiTags } from "./memory/tagger/TagNormalizer.js";
import {
  CompressAction,
  ConflictAction,
  KeepRawAction
} from "./memory/management/RetentionActions.js";
import { RetentionPolicyEngine } from "./memory/management/RetentionPolicyEngine.js";
import { ContextAssembler } from "./memory/output/ContextAssembler.js";
import { HybridRetriever } from "./memory/output/HybridRetriever.js";
import { RawBacktracker } from "./memory/output/RawBacktracker.js";
import { GraphEmbedder } from "./memory/prediction/GraphEmbedder.js";
import type { IGraphEmbedder } from "./memory/prediction/GraphEmbedder.js";
import { Node2VecGraphEmbedder } from "./memory/prediction/Node2VecGraphEmbedder.js";
import { PredictorEngine } from "./memory/prediction/PredictorEngine.js";
import { TransEGraphEmbedder } from "./memory/prediction/TransEGraphEmbedder.js";
import { SealProcessor } from "./memory/processing/SealProcessor.js";
import { FileRawEventStore } from "./memory/raw/FileRawEventStore.js";
import { InMemoryRawEventStore } from "./memory/raw/InMemoryRawEventStore.js";
import { SQLiteRawEventStore } from "./memory/raw/SQLiteRawEventStore.js";
import type { IRawEventStore } from "./memory/raw/IRawEventStore.js";
import { FileRelationStore } from "./memory/relation/FileRelationStore.js";
import { InMemoryRelationStore } from "./memory/relation/InMemoryRelationStore.js";
import { SQLiteRelationStore } from "./memory/relation/SQLiteRelationStore.js";
import { KeywordRetriever } from "./memory/retrieval/KeywordRetriever.js";
import { FusionRetriever } from "./memory/retrieval/FusionRetriever.js";
import { GraphRetriever } from "./memory/retrieval/GraphRetriever.js";
import { VectorRetriever } from "./memory/retrieval/VectorRetriever.js";
import { SQLiteFileAccessRecorder } from "./memory/file/SQLiteFileAccessRecorder.js";
import { NoopFileAccessRecorder } from "./memory/file/NoopFileAccessRecorder.js";
import type { IFileAccessRecorder } from "./memory/file/FileAccessRecorder.js";
import { buildRelationExtractor } from "./memory/relation/relationExtractorFactory.js";
import type { IRelationStore } from "./memory/relation/IRelationStore.js";
import { SQLiteDatabase } from "./memory/sqlite/SQLiteDatabase.js";
import { ChromaBlockStore } from "./memory/store/ChromaBlockStore.js";
import { InMemoryBlockStore } from "./memory/store/InMemoryBlockStore.js";
import { LanceBlockStore } from "./memory/store/LanceBlockStore.js";
import { SQLiteBlockStore } from "./memory/store/SQLiteBlockStore.js";
import { HeuristicSummarizer } from "./memory/summarizer/HeuristicSummarizer.js";
import { BlockStoreVectorStore } from "./memory/vector/BlockStoreVectorStore.js";
import { InMemoryVectorStore } from "./memory/vector/InMemoryVectorStore.js";
import { HttpSearchProvider } from "./search/HttpSearchProvider.js";
import { HttpWebPageFetcher } from "./search/HttpWebPageFetcher.js";
import { SearchIngestScheduler } from "./search/SearchIngestScheduler.js";
import { ProactiveDialoguePlanner } from "./proactive/ProactiveDialoguePlanner.js";
import { ProactiveActuator } from "./proactive/ProactiveActuator.js";
import { ProactiveTimerScheduler } from "./proactive/ProactiveTimerScheduler.js";

type Factory<T> = () => T;

export class Container {
  private readonly factories = new Map<string, Factory<unknown>>();
  private readonly instances = new Map<string, unknown>();

  register<T>(name: string, factory: Factory<T>): void {
    this.factories.set(name, factory);
  }

  resolve<T>(name: string): T {
    if (this.instances.has(name)) {
      return this.instances.get(name) as T;
    }
    const factory = this.factories.get(name);
    if (!factory) {
      throw new Error(`Dependency not registered: ${name}`);
    }
    const instance = factory();
    this.instances.set(name, instance);
    return instance as T;
  }
}

export interface Runtime {
  config: AppConfig;
  container: Container;
  agent: Agent;
  memoryManager: PartitionMemoryManager;
  close(): Promise<void>;
}

export interface RuntimeOptions {
  agentSystemPrompt?: string;
  includeAgentsMd?: boolean;
  agentsMdPath?: string;
  workspaceRoot?: string;
  includeIntroductionWhenNoMemory?: boolean;
  introductionPath?: string;
  includeTagsIntro?: boolean;
  tagsIntroPath?: string;
  tagsTomlPath?: string;
  tagsTemplateVars?: Record<string, string>;
  enableAgentTools?: boolean;
}

export function createRuntime(
  overrides: DeepPartial<AppConfig> = {},
  options: RuntimeOptions = {}
): Runtime {
  const config = loadConfig(overrides);
  const envIncludeTagsIntro = parseOptionalBoolean(process.env.MLEX_INCLUDE_TAGS_INTRO);
  const envTagsIntroPath = normalizeEnvString(process.env.MLEX_TAGS_INTRO);
  const envTagsTomlPath = normalizeEnvString(process.env.MLEX_TAGS_TOML);
  const envTagsTemplateVars = parseEnvTagTemplateVars(process.env);
  const allowedAiTags = normalizeAllowedAiTags(config.component.allowedAiTags);
  const container = new Container();
  let sqliteDatabase: SQLiteDatabase | undefined;

  const getSQLiteDatabase = (): SQLiteDatabase => {
    if (!sqliteDatabase) {
      sqliteDatabase = new SQLiteDatabase({
        filePath: config.component.sqliteFilePath
      });
    }
    return sqliteDatabase;
  };

  registerCoreDependencies({
    config,
    container,
    getSQLiteDatabase,
    allowedAiTags
  });
  registerRuntimeDependencies({
    config,
    container,
    options,
    envIncludeTagsIntro,
    envTagsIntroPath,
    envTagsTomlPath,
    envTagsTemplateVars
  });

  const agent = container.resolve<Agent>("agent");
  const memoryManager = container.resolve<PartitionMemoryManager>("memoryManager");
  let closed = false;
  const scheduler = container.resolve<SearchIngestScheduler>("searchScheduler");
  const proactiveTimerScheduler = container.resolve<ProactiveTimerScheduler>("proactiveTimerScheduler");
  scheduler.start();
  proactiveTimerScheduler.start();

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;

    await scheduler.stop();
    await proactiveTimerScheduler.stop();
    await memoryManager.flushAsyncRelations();
    if (sqliteDatabase) {
      sqliteDatabase.close();
      sqliteDatabase = undefined;
    }
  };

  return {
    config,
    container,
    agent,
    memoryManager,
    close
  };
}

function registerCoreDependencies(input: {
  config: AppConfig;
  container: Container;
  getSQLiteDatabase: () => SQLiteDatabase;
  allowedAiTags: string[];
}): void {
  const { config, container, getSQLiteDatabase, allowedAiTags } = input;

  container.register("config", () => config);
  container.register("locale", () => config.component.locale as Locale);
  container.register("i18n", () => createI18n({ locale: config.component.locale }));
  container.register("debugTraceRecorder", () => {
    if (!config.component.debugTraceEnabled) {
      return new NoopDebugTraceRecorder();
    }
    return new InMemoryDebugTraceRecorder({
      enabled: true,
      maxEntries: Math.max(200, config.component.debugTraceMaxEntries)
    });
  });
  container.register("keywordIndex", () => new InvertedIndex());
  container.register("relationGraph", () => new RelationGraph());
  container.register("blockStore", () => buildBlockStore(config, getSQLiteDatabase, allowedAiTags));
  container.register("rawStore", () => buildRawStore(config, getSQLiteDatabase));
  container.register("relationStore", () => buildRelationStore(config, getSQLiteDatabase));
  container.register("vectorStore", () => {
    if (config.component.storageBackend === "memory") {
      return new InMemoryVectorStore();
    }
    return new BlockStoreVectorStore(container.resolve("blockStore"));
  });
  container.register("summarizer", () => new HeuristicSummarizer());
  container.register("embedder", () => new HashEmbedder(256));
  container.register("chunkStrategy", () => buildChunkStrategy(config));
  container.register("relationExtractor", () => {
    return buildRelationExtractor(config, container.resolve("debugTraceRecorder"));
  });
  container.register("tagger", () => {
    return buildTagger(config, container.resolve("debugTraceRecorder"));
  });
  container.register("historyMatchCalculator", () => {
    return new HistoryMatchCalculator(container.resolve("relationGraph"));
  });
  container.register("retentionPolicy", () => {
    return new RetentionPolicyEngine(
      {
        highMatchThreshold: config.manager.compressionHighMatchThreshold,
        lowMatchThreshold: config.manager.compressionLowMatchThreshold,
        softBand: config.manager.compressionSoftBand,
        preserveWeight: config.manager.compressionPreserveWeight,
        minRawTokens: config.manager.compressionMinRawTokens,
        conflictMarkerEnabled: config.manager.conflictMarkerEnabled
      },
      {
        compress: new CompressAction(),
        keepRaw: new KeepRawAction(),
        conflict: new ConflictAction()
      }
    );
  });
  container.register("sealProcessor", () => {
    return new SealProcessor({
      summarizer: container.resolve("summarizer"),
      embedder: container.resolve("embedder"),
      rawStore: container.resolve("rawStore"),
      historyMatchCalculator: container.resolve("historyMatchCalculator"),
      retentionPolicy: container.resolve("retentionPolicy"),
      tagger: container.resolve("tagger"),
      allowedAiTags
    });
  });
  container.register("contextAssembler", () => new ContextAssembler());
  container.register("rawBacktracker", () => new RawBacktracker(container.resolve("rawStore")));
  container.register("graphEmbedder", () => buildGraphEmbedder(config));
  container.register("predictor", () => {
    return new PredictorEngine({
      config: config.manager,
      relationGraph: container.resolve("relationGraph"),
      blockStore: container.resolve("blockStore"),
      graphEmbedder: container.resolve("graphEmbedder")
    });
  });
  container.register("keywordRetriever", () => {
    return new KeywordRetriever(container.resolve("keywordIndex"), container.resolve("blockStore"));
  });
  container.register("vectorRetriever", () => {
    return new VectorRetriever(
      container.resolve("vectorStore"),
      container.resolve("blockStore"),
      Math.max(-1, Math.min(1, config.manager.vectorMinScore))
    );
  });
  container.register("graphRetriever", () => {
    return new GraphRetriever(
      container.resolve("relationGraph"),
      container.resolve("relationStore"),
      container.resolve("blockStore")
    );
  });
  container.register("semanticRetriever", () => {
    return new FusionRetriever([
      {
        source: "keyword",
        retriever: container.resolve("keywordRetriever"),
        weight: config.manager.keywordWeight
      },
      {
        source: "vector",
        retriever: container.resolve("vectorRetriever"),
        weight: config.manager.vectorWeight
      }
    ]);
  });
  container.register("hybridRetriever", () => {
    return new HybridRetriever(
      config.manager,
      container.resolve("semanticRetriever"),
      container.resolve("graphRetriever")
    );
  });
  container.register("memoryManager", () => {
    return new PartitionMemoryManager({
      config: config.manager,
      keywordIndex: container.resolve("keywordIndex"),
      relationGraph: container.resolve("relationGraph"),
      relationStore: container.resolve("relationStore"),
      blockStore: container.resolve("blockStore"),
      rawStore: container.resolve("rawStore"),
      vectorStore: container.resolve("vectorStore"),
      embedder: container.resolve("embedder"),
      chunkStrategy: container.resolve("chunkStrategy"),
      hybridRetriever: container.resolve("hybridRetriever"),
      relationExtractor: container.resolve("relationExtractor"),
      sealProcessor: container.resolve("sealProcessor"),
      contextAssembler: container.resolve("contextAssembler"),
      backtracker: container.resolve("rawBacktracker"),
      predictor: container.resolve("predictor")
    });
  });
  container.register("provider", () =>
    buildProvider(config, container.resolve("debugTraceRecorder"), container.resolve<I18n>("i18n"))
  );
  container.register("searchProvider", () => {
    return new HttpSearchProvider({
      endpoint: config.component.searchEndpoint,
      apiKey: config.component.searchApiKey,
      providerName: config.component.searchProvider,
      timeoutMs: Math.max(1000, config.component.searchTimeoutMs)
    });
  });
  container.register("webPageFetcher", () => {
    return new HttpWebPageFetcher({
      endpoint: config.component.webFetchEndpoint,
      apiKey: config.component.webFetchApiKey,
      timeoutMs: Math.max(1000, config.component.searchTimeoutMs)
    });
  });
  container.register("searchScheduler", () => {
    const traceRecorder = container.resolve<IDebugTraceRecorder>("debugTraceRecorder");
    return new SearchIngestScheduler({
      memoryManager: container.resolve("memoryManager"),
      searchProvider: container.resolve("searchProvider"),
      enabled: config.manager.searchAugmentMode === "scheduled",
      intervalMinutes: Math.max(1, config.manager.searchScheduleMinutes),
      seeds: config.component.searchSeedQueries,
      topK: Math.max(1, config.manager.searchTopK),
      trace: (event, payload) => {
        traceRecorder.record("search.scheduler", event, payload);
      }
    });
  });
  container.register("fileAccessRecorder", () => {
    const sqliteEnabled =
      config.component.storageBackend === "sqlite" ||
      config.component.rawStoreBackend === "sqlite" ||
      config.component.relationStoreBackend === "sqlite";
    if (sqliteEnabled) {
      return new SQLiteFileAccessRecorder(getSQLiteDatabase());
    }
    return new NoopFileAccessRecorder();
  });
  container.register("proactivePlanner", () => {
    return new ProactiveDialoguePlanner({
      proactiveWakeupRequireEvidence: config.manager.proactiveWakeupRequireEvidence,
      proactiveWakeupMinIntervalSeconds: Math.max(0, config.manager.proactiveWakeupMinIntervalSeconds),
      proactiveWakeupMaxPerHour: Math.max(1, config.manager.proactiveWakeupMaxPerHour),
      i18n: container.resolve("i18n")
    });
  });
  container.register("proactiveActuator", () => {
    return new ProactiveActuator({
      memoryManager: container.resolve("memoryManager"),
      searchProvider: container.resolve("searchProvider"),
      webPageFetcher: container.resolve("webPageFetcher"),
      searchTopK: Math.max(1, config.manager.searchTopK),
      i18n: container.resolve("i18n")
    });
  });
}

function registerRuntimeDependencies(input: {
  config: AppConfig;
  container: Container;
  options: RuntimeOptions;
  envIncludeTagsIntro: boolean | undefined;
  envTagsIntroPath: string | undefined;
  envTagsTomlPath: string | undefined;
  envTagsTemplateVars: Record<string, string>;
}): void {
  const {
    config,
    container,
    options,
    envIncludeTagsIntro,
    envTagsIntroPath,
    envTagsTomlPath,
    envTagsTemplateVars
  } = input;

  container.register("toolExecutor", () => {
    return new BuiltinAgentToolExecutor({
      workspaceRoot: options.workspaceRoot ?? process.cwd(),
      memoryManager: container.resolve("memoryManager"),
      traceRecorder: container.resolve("debugTraceRecorder"),
      relationStore: container.resolve("relationStore"),
      fileAccessRecorder: container.resolve<IFileAccessRecorder>("fileAccessRecorder"),
      searchProvider: container.resolve("searchProvider"),
      webPageFetcher: container.resolve("webPageFetcher"),
      searchAugmentMode: config.manager.searchAugmentMode,
      searchTopK: config.manager.searchTopK,
      i18n: container.resolve("i18n")
    });
  });
  container.register("agent", () => {
    return new Agent(container.resolve("memoryManager"), container.resolve("provider"), {
      systemPrompt: options.agentSystemPrompt,
      includeAgentsMd: options.includeAgentsMd,
      agentsMdPath: options.agentsMdPath,
      workspaceRoot: options.workspaceRoot,
      includeIntroductionWhenNoMemory: options.includeIntroductionWhenNoMemory,
      introductionPath: options.introductionPath,
      includeTagsIntro: options.includeTagsIntro ?? envIncludeTagsIntro ?? config.component.includeTagsIntro,
      tagsIntroPath: options.tagsIntroPath ?? envTagsIntroPath ?? config.component.tagsIntroPath,
      tagsTomlPath: options.tagsTomlPath ?? envTagsTomlPath ?? config.component.tagsTomlPath,
      tagsTemplateVars: {
        ...(config.component.tagsTemplateVars ?? {}),
        ...envTagsTemplateVars,
        ...(options.tagsTemplateVars ?? {})
      },
      toolExecutor: options.enableAgentTools === false ? undefined : container.resolve("toolExecutor"),
      maxToolRounds: config.manager.agentMaxToolRounds,
      traceRecorder: container.resolve("debugTraceRecorder"),
      proactivePlanner:
        config.manager.searchAugmentMode === "predictive" && config.manager.proactiveWakeupEnabled
          ? container.resolve("proactivePlanner")
          : undefined,
      proactiveActuator:
        config.manager.searchAugmentMode === "predictive" && config.manager.proactiveWakeupEnabled
          ? container.resolve("proactiveActuator")
          : undefined,
      i18n: container.resolve("i18n")
    });
  });
  container.register("proactiveTimerScheduler", () => {
    return new ProactiveTimerScheduler({
      agent: container.resolve("agent"),
      enabled:
        config.manager.searchAugmentMode === "predictive" &&
        config.manager.proactiveWakeupEnabled &&
        config.manager.proactiveTimerEnabled,
      intervalSeconds: Math.max(1, config.manager.proactiveTimerIntervalSeconds)
    });
  });
}

function buildChunkStrategy(config: AppConfig): IChunkStrategy {
  const fixed = new FixedTokenChunkStrategy(config.manager.maxTokensPerBlock);
  const semantic = new SemanticBoundaryChunkStrategy({
    maxTokens: config.manager.maxTokensPerBlock,
    minTokens: config.manager.minTokensPerBlock
  });

  if (config.component.chunkStrategy === "fixed") return fixed;
  if (config.component.chunkStrategy === "semantic") return semantic;
  return new HybridChunkStrategy(fixed, semantic);
}

function buildBlockStore(
  config: AppConfig,
  getSQLiteDatabase: () => SQLiteDatabase,
  allowedAiTags: string[]
) {
  if (config.component.storageBackend === "sqlite") {
    return new SQLiteBlockStore(getSQLiteDatabase(), allowedAiTags);
  }
  if (config.component.storageBackend === "lance") {
    return new LanceBlockStore({ filePath: config.component.lanceFilePath }, allowedAiTags);
  }
  if (config.component.storageBackend === "chroma") {
    if (!config.component.chromaBaseUrl || !config.component.chromaCollectionId) {
      throw new Error("MLEX_CHROMA_BASE_URL and MLEX_CHROMA_COLLECTION are required for chroma");
    }
    return new ChromaBlockStore(
      {
        baseUrl: config.component.chromaBaseUrl,
        collectionId: config.component.chromaCollectionId,
        apiKey: config.component.chromaApiKey
      },
      allowedAiTags
    );
  }
  return new InMemoryBlockStore();
}

function buildRawStore(
  config: AppConfig,
  getSQLiteDatabase: () => SQLiteDatabase
): IRawEventStore {
  if (config.component.rawStoreBackend === "sqlite") {
    return new SQLiteRawEventStore(getSQLiteDatabase());
  }
  if (config.component.rawStoreBackend === "file") {
    return new FileRawEventStore({ filePath: config.component.rawStoreFilePath });
  }
  return new InMemoryRawEventStore();
}

function buildRelationStore(
  config: AppConfig,
  getSQLiteDatabase: () => SQLiteDatabase
): IRelationStore {
  if (config.component.relationStoreBackend === "sqlite") {
    return new SQLiteRelationStore(getSQLiteDatabase());
  }
  if (config.component.relationStoreBackend === "file") {
    return new FileRelationStore({ filePath: config.component.relationStoreFilePath });
  }
  return new InMemoryRelationStore();
}

function buildGraphEmbedder(config: AppConfig): IGraphEmbedder {
  if (config.component.graphEmbeddingMethod === "transe") {
    return new TransEGraphEmbedder();
  }
  if (config.component.graphEmbeddingMethod === "node2vec") {
    return new Node2VecGraphEmbedder();
  }
  return new GraphEmbedder();
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}

function normalizeEnvString(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseEnvTagTemplateVars(env: NodeJS.ProcessEnv): Record<string, string> {
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
