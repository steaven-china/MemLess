import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { stat } from "node:fs/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import { join, parse } from "node:path";

import type { AppConfig, DeepPartial } from "../config.js";
import type { RuntimeOptions, RuntimeProactiveWakeupEvent } from "../container.js";
import { createRuntime } from "../container.js";
import type { IDebugTraceRecorder } from "../debug/DebugTraceRecorder.js";
import { ReadonlyFileService } from "../files/ReadonlyFileService.js";
import { createI18n, extractLocaleFromAcceptLanguage, pickLocale, type I18n } from "../i18n/index.js";
import { RelationType, type Context, type MemoryEvent } from "../types.js";
import type { IRawEventStore } from "../memory/raw/IRawEventStore.js";
import type { IRelationStore } from "../memory/relation/IRelationStore.js";
import type { IBlockStore } from "../memory/store/IBlockStore.js";
import type { ChatMessage, ILLMProvider, LlmUsage } from "../agent/LLMProvider.js";
import { renderAppHtml } from "./renderAppHtml.js";
import {
  type OpenAIChatMessage,
  type OpenAIChatMessagePart,
  type BridgeMode,
  type BridgeExecutionResult,
  type OpenClawSideBag,
  type OpenAIChatRequestBody,
  normalizeOpenAIChatRequest as normalizeOpenAIChatRequestBridge,
  isOpenClawBridgeRequest as isOpenClawBridgeRequestBridge,
  executeBridgePassthrough as executeBridgePassthroughBridge
} from "./bridge/openaiCompatBridge.js";
import { handleDebugRoute } from "./routes/debug.js";
import { handleFileRoute } from "./routes/files.js";
import { handleOpenAiCompatRoute } from "./routes/openaiCompat.js";
import { createId } from "../utils/id.js";

export interface WebServerOptions {
  host?: string;
  port?: number;
  runtimeOverrides?: DeepPartial<AppConfig>;
  runtimeOptions?: RuntimeOptions;
}

export interface StartedWebServer {
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

interface ChatRequestBody {
  message?: string;
  sessionId?: string;
  requestId?: string;
}

interface LastContextState {
  query: string;
  at: number;
  context: Context;
}

interface DebugState {
  lastContextBySession: Map<string, LastContextState>;
  lastSharedContextBySession: Map<string, LastContextState>;
}

type ProactiveSubscriberMap = Map<string, Set<ServerResponse>>;

interface SessionRuntimeSet {
  sessionId: string;
  privateRuntime: ReturnType<typeof createRuntime>;
  sharedRuntime: ReturnType<typeof createRuntime>;
}

export function buildSessionScopedRuntimeOverrides(
  baseOverrides: DeepPartial<AppConfig> | undefined,
  sessionId: string
): DeepPartial<AppConfig> {
  const base = baseOverrides ?? {};
  if (sessionId === "default") {
    return base;
  }

  const suffix = toSessionStorageSuffix(sessionId);
  const baseComponent = base.component ?? {};
  const chromaCollectionBase = asString(baseComponent.chromaCollectionId) ?? "mlex_blocks";

  return {
    ...base,
    component: {
      ...baseComponent,
      sqliteFilePath: appendSuffixToFilePath(
        asString(baseComponent.sqliteFilePath) ?? ".mlex/memory.db",
        suffix
      ),
      lanceFilePath: appendSuffixToFilePath(
        asString(baseComponent.lanceFilePath) ?? ".mlex/lance-blocks.json",
        suffix
      ),
      lanceDbPath: appendSuffixToDirectoryPath(
        asString(baseComponent.lanceDbPath) ?? ".mlex/lancedb",
        suffix
      ),
      rawStoreFilePath: appendSuffixToFilePath(
        asString(baseComponent.rawStoreFilePath) ?? ".mlex/raw-events.json",
        suffix
      ),
      relationStoreFilePath: appendSuffixToFilePath(
        asString(baseComponent.relationStoreFilePath) ?? ".mlex/relations.json",
        suffix
      ),
      chromaCollectionId: `${chromaCollectionBase}_${suffix}`
    }
  };
}

function buildSharedRuntimeOverrides(
  baseOverrides: DeepPartial<AppConfig> | undefined
): DeepPartial<AppConfig> {
  const base = baseOverrides ?? {};
  const baseManager = base.manager ?? {};
  return {
    ...base,
    manager: {
      ...baseManager,
      proactiveWakeupEnabled: false,
      proactiveTimerEnabled: false
    }
  };
}

function toPrivateStorageScopeSessionId(sessionId: string): string {
  if (sessionId === "default") return "default-private";
  return sessionId;
}

export async function startWebServer(options: WebServerOptions = {}): Promise<StartedWebServer> {
  const fileService = new ReadonlyFileService({ rootPath: process.cwd() });
  const debugState: DebugState = {
    lastContextBySession: new Map<string, LastContextState>(),
    lastSharedContextBySession: new Map<string, LastContextState>()
  };
  const proactiveSubscribersBySession: ProactiveSubscriberMap = new Map();
  const baseRuntimeOptions = options.runtimeOptions;

  const emitProactiveWakeup = (sessionId: string, event: RuntimeProactiveWakeupEvent): void => {
    const payload = {
      sessionId,
      requestId: createId("req"),
      proactiveReply: event.text,
      triggerSource: event.triggerSource,
      at: event.at
    };
    broadcastProactiveEvent(proactiveSubscribersBySession, sessionId, payload);
  };

  const createPrivateRuntimeForSession = (sessionId: string): ReturnType<typeof createRuntime> => {
    const mergedRuntimeOptions: RuntimeOptions = {
      ...(baseRuntimeOptions ?? {}),
      onProactiveWakeup: async (event) => {
        try {
          await baseRuntimeOptions?.onProactiveWakeup?.(event);
        } finally {
          emitProactiveWakeup(sessionId, event);
        }
      }
    };
    return createRuntime(
      buildSessionScopedRuntimeOverrides(
        options.runtimeOverrides,
        toPrivateStorageScopeSessionId(sessionId)
      ),
      mergedRuntimeOptions
    );
  };

  const sharedRuntime = createRuntime(
    buildSharedRuntimeOverrides(options.runtimeOverrides),
    {
      ...(baseRuntimeOptions ?? {}),
      onProactiveWakeup: undefined
    }
  );

  const defaultRuntime: SessionRuntimeSet = {
    sessionId: "default",
    privateRuntime: createPrivateRuntimeForSession("default"),
    sharedRuntime
  };
  const runtimesBySession = new Map<string, SessionRuntimeSet>([["default", defaultRuntime]]);
  const MAX_SESSIONS = 64;
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 8787;

  const evictOldestSession = async (): Promise<void> => {
    let oldestKey: string | undefined;
    for (const key of runtimesBySession.keys()) {
      if (key === "default") continue;
      oldestKey = key;
      break;
    }
    if (!oldestKey) return;
    const evicted = runtimesBySession.get(oldestKey);
    runtimesBySession.delete(oldestKey);
    if (evicted) {
      try {
        await evicted.privateRuntime.close();
      } catch { /* best effort */ }
    }
  };

  const resolveRuntimeForSession = (sessionId: string): SessionRuntimeSet => {
    const existing = runtimesBySession.get(sessionId);
    if (existing) return existing;
    if (runtimesBySession.size >= MAX_SESSIONS) {
      void evictOldestSession();
    }
    const created: SessionRuntimeSet = {
      sessionId,
      privateRuntime: createPrivateRuntimeForSession(sessionId),
      sharedRuntime
    };
    runtimesBySession.set(sessionId, created);
    return created;
  };

  const server = createServer(async (req, res) => {
    const i18n = resolveRequestI18n(req, defaultRuntime.privateRuntime.config.component.locale);
    try {
      await routeRequest(
        req,
        res,
        defaultRuntime,
        resolveRuntimeForSession,
        debugState,
        fileService,
        proactiveSubscribersBySession,
        i18n
      );
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.statusCode, { error: error.message });
        return;
      }
      sendJson(res, 500, { error: i18n.t("core.error.unexpected_server_error") });
    }
  });

  await listen(server, requestedPort, host);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start web server: invalid address.");
  }
  return {
    host,
    port: address.port,
    url: `http://${host}:${address.port}`,
    close: async () => {
      for (const subscribers of proactiveSubscribersBySession.values()) {
        for (const subscriber of subscribers) {
          if (!subscriber.writableEnded) {
            subscriber.end();
          }
        }
      }
      proactiveSubscribersBySession.clear();
      await closeServer(server);
      const closed = new Set<ReturnType<typeof createRuntime>>();
      for (const runtimeSet of runtimesBySession.values()) {
        if (!closed.has(runtimeSet.privateRuntime)) {
          closed.add(runtimeSet.privateRuntime);
          await runtimeSet.privateRuntime.close();
        }
        if (!closed.has(runtimeSet.sharedRuntime)) {
          closed.add(runtimeSet.sharedRuntime);
          await runtimeSet.sharedRuntime.close();
        }
      }
    }
  };
}

async function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  defaultRuntime: SessionRuntimeSet,
  resolveRuntimeForSession: (sessionId: string) => SessionRuntimeSet,
  debugState: DebugState,
  fileService: ReadonlyFileService,
  proactiveSubscribersBySession: ProactiveSubscriberMap,
  i18n: I18n
): Promise<void> {
  const bodyLimit = resolveBodyLimit(defaultRuntime.privateRuntime.config.component.webRequestBodyMaxBytes);
  const adminToken = normalizeAdminToken(defaultRuntime.privateRuntime.config.component.webAdminToken);
  const debugApiEnabled = defaultRuntime.privateRuntime.config.component.webDebugApiEnabled;
  const fileApiEnabled = defaultRuntime.privateRuntime.config.component.webFileApiEnabled;
  const exposeRawContext = defaultRuntime.privateRuntime.config.component.webExposeRawContext;
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/") {
    sendHtml(res, renderAppHtml(i18n));
    return;
  }

  if (method === "GET" && pathname === "/healthz") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "GET" && pathname === "/api/capabilities") {
    sendJson(res, 200, {
      debugApiEnabled,
      fileApiEnabled,
      rawContextEnabled: exposeRawContext,
      adminTokenRequired: Boolean(adminToken),
      debugTraceEnabled: defaultRuntime.privateRuntime.config.component.debugTraceEnabled,
      debugTraceMaxEntries: defaultRuntime.privateRuntime.config.component.debugTraceMaxEntries
    });
    return;
  }

  if (method === "GET" && pathname === "/api/proactive/stream") {
    const sessionId = normalizeSessionId(url.searchParams.get("sessionId") ?? undefined);
    resolveRuntimeForSession(sessionId);
    beginProactiveSseStream(req, res, sessionId, proactiveSubscribersBySession);
    return;
  }

  if (
    await handleOpenAiCompatRoute({
      req,
      res,
      method,
      pathname,
      bodyLimit,
      i18n,
      defaultRuntime,
      resolveRuntimeForSession,
      helpers: {
        sendJson,
        readJson,
        normalizeOpenAIChatRequest,
        normalizeRequestId,
        createRequestAbortSignal,
        isOpenClawBridgeRequest,
        executeBridgePassthrough,
        resolveCurrentModelId,
        normalizeOpenAIProviderMessages,
        joinUsageParts,
        resolveSystemFingerprint,
        applyOpenAiCompatHeaders,
        sendOpenAiSseData,
        readProviderUsage,
        resolveOpenAiUsage,
        prepareSharedContextForRequest,
        buildSharedExternalSystemContext,
        appendSharedAssistantMirror,
        combineReplyAndProactive,
        normalizeUserMessage
      }
    })
  ) {
    return;
  }

  if (method === "POST" && pathname === "/api/chat") {
    const body = await readJson<ChatRequestBody>(req, i18n, bodyLimit);
    const message = normalizeUserMessage(body.message);
    if (!message) {
      sendJson(res, 400, { error: i18n.t("web.api.error.message_required") });
      return;
    }
    const sessionId = normalizeSessionId(body.sessionId);
    const requestId = normalizeRequestId(body.requestId);
    const runtimeSet = resolveRuntimeForSession(sessionId);
    const sharedContext = await prepareSharedContextForRequest(runtimeSet, message);
    if (sharedContext) {
      debugState.lastSharedContextBySession.set(sessionId, {
        query: message,
        at: Date.now(),
        context: sharedContext
      });
    }
    const externalSystemContext = buildSharedExternalSystemContext(sharedContext);
    const signal = createRequestAbortSignal(req, res);
    const result = await runtimeSet.privateRuntime.agent.respond(message, {
      signal,
      externalSystemContext
    });
    await appendSharedAssistantMirror(
      runtimeSet,
      combineReplyAndProactive(result.text, result.proactiveText)
    );
    debugState.lastContextBySession.set(sessionId, {
      query: message,
      at: Date.now(),
      context: result.context
    });
    const latestReadFilePath = extractLatestReadonlyReadPath(result.context);
    const payload: Record<string, unknown> = {
      requestId,
      sessionId,
      reply: result.text,
      proactiveReply: result.proactiveText ?? null,
      context: result.context.formatted,
      blocks: result.context.blocks,
      prediction: result.context.prediction ?? null,
      latestReadFilePath
    };
    if (exposeRawContext) {
      payload.rawContext = result.context;
    }
    sendJson(res, 200, payload);
    return;
  }

  if (method === "POST" && pathname === "/api/chat/stream") {
    const body = await readJson<ChatRequestBody>(req, i18n, bodyLimit);
    const message = normalizeUserMessage(body.message);
    if (!message) {
      sendJson(res, 400, { error: i18n.t("web.api.error.message_required") });
      return;
    }

    const sessionId = normalizeSessionId(body.sessionId);
    const requestId = normalizeRequestId(body.requestId);
    const runtimeSet = resolveRuntimeForSession(sessionId);
    const sharedContext = await prepareSharedContextForRequest(runtimeSet, message);
    if (sharedContext) {
      debugState.lastSharedContextBySession.set(sessionId, {
        query: message,
        at: Date.now(),
        context: sharedContext
      });
    }
    const externalSystemContext = buildSharedExternalSystemContext(sharedContext);
    const signal = createRequestAbortSignal(req, res);

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    try {
      const result = await runtimeSet.privateRuntime.agent.respondStream(
        message,
        (token) => {
          if (signal.aborted || res.writableEnded) return;
          sendSseEvent(res, "token", { token, requestId, sessionId });
        },
        {
          signal,
          externalSystemContext
        }
      );
      await appendSharedAssistantMirror(
        runtimeSet,
        combineReplyAndProactive(result.text, result.proactiveText)
      );
      debugState.lastContextBySession.set(sessionId, {
        query: message,
        at: Date.now(),
        context: result.context
      });
      const latestReadFilePath = extractLatestReadonlyReadPath(result.context);
      const donePayload: Record<string, unknown> = {
        requestId,
        sessionId,
        reply: result.text,
        proactiveReply: result.proactiveText ?? null,
        context: result.context.formatted,
        blocks: result.context.blocks,
        prediction: result.context.prediction ?? null,
        latestReadFilePath
      };
      if (exposeRawContext) {
        donePayload.rawContext = result.context;
      }
      if (!res.writableEnded) {
        sendSseEvent(res, "done", donePayload);
        res.end();
      }
    } catch (error) {
      if (!res.writableEnded) {
        sendSseEvent(res, "error", {
          requestId,
          sessionId,
          error: error instanceof Error ? error.message : i18n.t("web.error.stream_unknown")
        });
        res.end();
      }
    }
    return;
  }

  if (method === "POST" && pathname === "/api/seal") {
    const sessionId = normalizeSessionId(url.searchParams.get("sessionId") ?? undefined);
    const runtimeSet = resolveRuntimeForSession(sessionId);
    await Promise.all([
      runtimeSet.privateRuntime.agent.sealMemory(),
      runtimeSet.sharedRuntime.agent.sealMemory()
    ]);
    sendJson(res, 200, { ok: true, sessionId });
    return;
  }

  if (
    await handleDebugRoute({
      req,
      res,
      method,
      pathname,
      url,
      i18n,
      debugApiEnabled,
      adminToken,
      defaultRuntime,
      resolveRuntimeForSession,
      debugState,
      helpers: {
        sendJson,
        requireFeatureEnabled,
        requireAdminAuthorization,
        normalizeSessionId,
        parsePositiveInt,
        buildDebugDatabaseSnapshot,
        buildDebugBlockDetail
      }
    })
  ) {
    return;
  }

  if (
    await handleFileRoute({
      req,
      res,
      method,
      pathname,
      url,
      i18n,
      fileApiEnabled,
      adminToken,
      fileService,
      helpers: {
        sendJson,
        requireFeatureEnabled,
        requireAdminAuthorization,
        parsePositiveInt
      }
    })
  ) {
    return;
  }

  sendJson(res, 404, { error: i18n.t("web.api.error.not_found") });
}

async function buildDebugDatabaseSnapshot(
  runtime: ReturnType<typeof createRuntime>,
  lastContext: LastContextState | undefined
): Promise<Record<string, unknown>> {
  const blockStore = runtime.container.resolve<IBlockStore>("blockStore");
  const rawStore = runtime.container.resolve<IRawEventStore>("rawStore");
  const relationStore = runtime.container.resolve<IRelationStore>("relationStore");
  const traceRecorder = runtime.container.resolve<IDebugTraceRecorder>("debugTraceRecorder");

  const [blocks, relations, rawBlockIds] = await Promise.all([
    blockStore.list(),
    relationStore.listAll(),
    rawStore.listBlockIds()
  ]);
  const blocksByTime = [...blocks].sort((left, right) => left.startTime - right.startTime);
  const relationRowsByTime = relations
    .map((relation) => ({
      src: relation.src,
      dst: relation.dst,
      type: relation.type,
      timestamp: relation.timestamp,
      confidence: relation.confidence ?? null
    }))
    .sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return left.timestamp - right.timestamp;
      }
      const srcCmp = left.src.localeCompare(right.src);
      if (srcCmp !== 0) return srcCmp;
      const dstCmp = left.dst.localeCompare(right.dst);
      if (dstCmp !== 0) return dstCmp;
      return left.type.localeCompare(right.type);
    });

  const rawCountByBlock = new Map<string, number>();
  const rawEntries = await Promise.all(
    rawBlockIds.map(async (blockId) => ({
      blockId,
      events: (await rawStore.get(blockId)) ?? []
    }))
  );
  const rawEventsCount = rawEntries.reduce((sum, entry) => sum + entry.events.length, 0);
  for (const entry of rawEntries) {
    rawCountByBlock.set(entry.blockId, entry.events.length);
  }

  const contextBlocksByTime = [...(lastContext?.context.blocks ?? [])].sort((left, right) => {
    if (left.startTime !== right.startTime) return left.startTime - right.startTime;
    if (left.endTime !== right.endTime) return left.endTime - right.endTime;
    return left.id.localeCompare(right.id);
  });
  const contextBlockSet = new Set(contextBlocksByTime.map((block) => block.id));

  const retention = {
    raw: blocks.filter((block) => block.retentionMode === "raw").length,
    compressed: blocks.filter((block) => block.retentionMode === "compressed").length,
    conflict: blocks.filter((block) => block.retentionMode === "conflict").length
  };

  const storage = await buildStorageSnapshot(runtime.config);
  const proactive = runtime.memoryManager.getProactiveSignalDiagnostics();

  return {
    generatedAt: Date.now(),
    storage,
    counts: {
      blocks: blocksByTime.length,
      rawBuckets: rawBlockIds.length,
      rawEvents: rawEventsCount,
      relations: relationRowsByTime.length,
      traces: traceRecorder.size()
    },
    retention,
    proactive,
    blocks: blocksByTime
      .map((block, index) => ({
        order: index + 1,
        id: block.id,
        startTime: block.startTime,
        endTime: block.endTime,
        tokenCount: block.tokenCount,
        retentionMode: block.retentionMode,
        matchScore: block.matchScore,
        conflict: block.conflict,
        keywordCount: block.keywords.length,
        embeddingDim: block.embedding.length,
        persistedRawEvents: rawCountByBlock.get(block.id) ?? 0,
        inContext: contextBlockSet.has(block.id),
        summaryPreview: block.summary.slice(0, 120)
      })),
    relations: relationRowsByTime.map((relation, index) => ({
      order: index + 1,
      ...relation
    })),
    lastContext: lastContext
      ? {
          query: lastContext.query,
          at: lastContext.at,
          formatted: lastContext.context.formatted,
          blockCount: contextBlocksByTime.length,
          blocks: contextBlocksByTime.map((block, index) => ({
            order: index + 1,
            id: block.id,
            score: block.score,
            source: block.source,
            startTime: block.startTime,
            endTime: block.endTime,
            retentionMode: block.retentionMode ?? "raw",
            rawEventCount: block.rawEvents?.length ?? 0,
            summaryPreview: block.summary.slice(0, 120),
            block
          })),
          prediction: lastContext.context.prediction ?? null
        }
      : null
  };
}

async function buildDebugBlockDetail(
  runtime: ReturnType<typeof createRuntime>,
  blockId: string
): Promise<Record<string, unknown> | undefined> {
  const blockStore = runtime.container.resolve<IBlockStore>("blockStore");
  const rawStore = runtime.container.resolve<IRawEventStore>("rawStore");
  const relationStore = runtime.container.resolve<IRelationStore>("relationStore");
  const block = await blockStore.get(blockId);
  if (!block) return undefined;

  const [rawEvents, outgoing, incoming] = await Promise.all([
    rawStore.get(blockId),
    relationStore.listOutgoing(blockId),
    relationStore.listIncoming(blockId)
  ]);

  return {
    id: blockId,
    block,
    persistedRawEvents: rawEvents ?? [],
    outgoingRelations: outgoing,
    incomingRelations: incoming
  };
}

async function buildStorageSnapshot(config: AppConfig): Promise<Record<string, unknown>> {
  const storage: Record<string, unknown> = {
    storageBackend: config.component.storageBackend,
    rawStoreBackend: config.component.rawStoreBackend,
    relationStoreBackend: config.component.relationStoreBackend
  };

  if (config.component.storageBackend === "sqlite") {
    storage.sqliteFilePath = config.component.sqliteFilePath;
    storage.sqliteFileSizeBytes = await readFileSize(config.component.sqliteFilePath);
  }
  if (config.component.storageBackend === "lance") {
    storage.lanceDbPath = config.component.lanceDbPath;
    storage.lanceDbSizeBytes = await readFileSize(config.component.lanceDbPath);
    storage.lanceFilePath = config.component.lanceFilePath;
    storage.lanceFileSizeBytes = await readFileSize(config.component.lanceFilePath);
  }
  if (config.component.rawStoreBackend === "file") {
    storage.rawStoreFilePath = config.component.rawStoreFilePath;
    storage.rawStoreFileSizeBytes = await readFileSize(config.component.rawStoreFilePath);
  }
  if (config.component.relationStoreBackend === "file") {
    storage.relationStoreFilePath = config.component.relationStoreFilePath;
    storage.relationStoreFileSizeBytes = await readFileSize(config.component.relationStoreFilePath);
  }
  return storage;
}

async function readFileSize(path: string): Promise<number | null> {
  try {
    const result = await stat(path);
    return result.size;
  } catch {
    return null;
  }
}

function extractLatestReadonlyReadPath(context: Context): string | null {
  const events = context.recentEvents;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.role !== "tool") continue;
    if (!event.metadata || event.metadata.tool !== "readonly.read") continue;
    const path = event.metadata.path;
    if (typeof path === "string" && path.trim().length > 0) {
      return path;
    }
  }
  return null;
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

async function readJson<T>(req: IncomingMessage, i18n: I18n, maxBytes = 256 * 1024): Promise<T> {
  const byteLimit = resolveBodyLimit(maxBytes);
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.byteLength;
    if (totalBytes > byteLimit) {
      throw new HttpError(413, i18n.t("web.api.error.request_too_large", { size: totalBytes, max: byteLimit }));
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) {
    return {} as T;
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {} as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, i18n.t("web.api.error.invalid_json"));
  }
}

function normalizeUserMessage(message: string | undefined): string | undefined {
  if (typeof message !== "string") return undefined;
  const normalized = message.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function resolveCurrentModelId(config: AppConfig): string {
  const service = config.service;
  if (service.provider === "openai") return service.openaiModel;
  if (service.provider === "deepseek-reasoner") return service.deepseekModel;
  if (service.provider === "anthropic-claude") return service.anthropicModel;
  if (service.provider === "google-gemini") return service.geminiModel;
  if (service.provider === "openrouter") return service.openrouterModel;
  if (service.provider === "azure-openai") return service.azureOpenaiModel;
  if (service.provider === "openai-compatible") return service.openaiCompatibleModel;
  return "mlex-agent";
}

function normalizeOpenAIChatRequest(body: OpenAIChatRequestBody): {
  message?: string;
  stream: boolean;
  includeUsage: boolean;
  sessionId: string;
  requestId?: string;
  model?: string;
} {
  return normalizeOpenAIChatRequestBridge(body);
}

function isOpenClawBridgeRequest(req: IncomingMessage, body: OpenAIChatRequestBody): boolean {
  return isOpenClawBridgeRequestBridge(req, body);
}

interface OpenAiCompatPassthroughInput {
  req: IncomingMessage;
  res: ServerResponse;
  body: OpenAIChatRequestBody;
  request: ReturnType<typeof normalizeOpenAIChatRequest>;
  requestId: string;
  bridgeMode: BridgeMode;
  hasOpenClawBridgeSignal: boolean;
  openaiCompatBypassAgent: boolean;
  signal: AbortSignal;
  runtime: ReturnType<typeof createRuntime>;
  traceRecorder?: IDebugTraceRecorder;
}

async function executeBridgePassthrough(input: OpenAiCompatPassthroughInput): Promise<BridgeExecutionResult> {
  return executeBridgePassthroughBridge({
    ...input,
    resolveCurrentModelId,
    applyOpenAiCompatHeaders,
    traceRecorder: input.traceRecorder
  });
}

function resolveOpenClawSideBag(body: OpenAIChatRequestBody): OpenClawSideBag | undefined {
  return firstDefinedRecord<OpenClawSideBag>([
    body.sidecar,
    body.sidebag,
    body.openclaw?.sidecar,
    body.openclaw?.sidebag,
    body.metadata?.sidecar,
    body.metadata?.sidebag,
    body.metadata?.openclaw?.sidecar,
    body.metadata?.openclaw?.sidebag
  ]);
}

function asObjectRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function firstDefinedString(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = normalizeUserMessage(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function firstDefinedRecord<T extends object>(values: Array<T | undefined>): T | undefined {
  for (const value of values) {
    if (value && typeof value === "object") return value;
  }
  return undefined;
}

function readProviderUsage(provider: ILLMProvider): LlmUsage | undefined {
  if (typeof provider.getLastUsage !== "function") return undefined;
  return provider.getLastUsage();
}

function normalizeOpenAIProviderMessages(
  body: OpenAIChatRequestBody,
  fallbackMessage: string | undefined
): ChatMessage[] {
  const sideBag = resolveOpenClawSideBag(body);
  const candidates: Array<OpenAIChatMessage[] | undefined> = [
    body.messages,
    sideBag?.messages,
    extractOpenAIInputMessages(body.input),
    extractOpenAIInputMessages(sideBag?.input)
  ];
  for (const candidate of candidates) {
    const normalized = toProviderMessages(candidate);
    if (normalized.length > 0) {
      return normalized;
    }
  }

  const fallback = normalizeUserMessage(fallbackMessage);
  if (fallback) {
    return [{ role: "user", content: fallback }];
  }
  return [];
}

function extractOpenAIInputMessages(input: unknown): OpenAIChatMessage[] | undefined {
  if (!input) return undefined;
  if (typeof input === "string") {
    const text = normalizeUserMessage(input);
    return text ? [{ role: "user", content: text }] : undefined;
  }
  if (Array.isArray(input)) {
    const output: OpenAIChatMessage[] = [];
    for (const entry of input) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const role = toNormalizedString(record.role);
      const content =
        normalizeInputMessageContent(record.content) ??
        firstDefinedString([
          toNormalizedString(record.text),
          toNormalizedString(record.input_text),
          toNormalizedString(record.value)
        ]);
      if (role || content !== undefined) {
        output.push({
          role,
          content
        });
        continue;
      }
      const looseText = firstDefinedString([
        toNormalizedString(record.text),
        toNormalizedString(record.input_text),
        toNormalizedString(record.value)
      ]);
      if (!looseText) continue;
      output.push({
        role: "user",
        content: looseText
      });
    }
    return output.length > 0 ? output : undefined;
  }
  if (typeof input === "object") {
    const record = input as Record<string, unknown>;
    const role = toNormalizedString(record.role);
    const content =
      normalizeInputMessageContent(record.content) ??
      firstDefinedString([
        toNormalizedString(record.text),
        toNormalizedString(record.input_text),
        toNormalizedString(record.value)
      ]);
    if (role || content !== undefined) {
      return [{ role, content }];
    }
    const looseText = extractOpenAILooseText(record);
    if (looseText) {
      return [{ role: "user", content: looseText }];
    }
  }
  return undefined;
}

function normalizeInputMessageContent(value: unknown): OpenAIChatMessage["content"] | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const output: OpenAIChatMessagePart[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      output.push({
        type: toNormalizedString(record.type),
        text: toNormalizedString(record.text),
        content: toNormalizedString(record.content),
        value: toNormalizedString(record.value)
      });
    }
    return output.length > 0 ? output : undefined;
  }
  return undefined;
}

function toProviderMessages(messages: OpenAIChatMessage[] | undefined): ChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const output: ChatMessage[] = [];
  for (const entry of messages) {
    if (!entry || typeof entry !== "object") continue;
    const role = normalizeProviderRole(entry.role);
    const content = extractOpenAIMessageText(entry.content);
    if (!role || !content) continue;
    output.push({ role, content });
  }
  return output;
}

function normalizeProviderRole(role: string | undefined): ChatMessage["role"] | undefined {
  const normalized = normalizeUserMessage(role)?.toLowerCase();
  if (normalized === "system") return "system";
  if (normalized === "user") return "user";
  if (normalized === "assistant") return "assistant";
  if (normalized === "developer") return "system";
  return undefined;
}

function extractOpenAIRequestMessage(messages: OpenAIChatMessage[] | undefined): string | undefined {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (entry.role !== "user") continue;
    const content = extractOpenAIMessageText(entry.content);
    if (content) return content;
  }
  return undefined;
}

function extractOpenAIMessageText(content: OpenAIChatMessage["content"]): string | undefined {
  if (typeof content === "string") {
    return normalizeUserMessage(content);
  }
  if (!Array.isArray(content)) {
    return undefined;
  }

  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const type = normalizeUserMessage(part.type);
    if (type && type !== "text" && type !== "input_text") continue;
    const text = normalizeUserMessage(part.text ?? part.content ?? part.value);
    if (text) parts.push(text);
  }
  const joined = parts.join("\n").trim();
  return joined.length > 0 ? joined : undefined;
}

function extractOpenAIInputText(input: unknown): string | undefined {
  if (typeof input === "string") {
    return normalizeUserMessage(input);
  }
  if (Array.isArray(input)) {
    const asMessages = input.filter(
      (entry): entry is OpenAIChatMessage =>
        Boolean(entry) &&
        typeof entry === "object" &&
        ("role" in entry || "content" in entry)
    );
    const messageText = extractOpenAIRequestMessage(asMessages);
    if (messageText) return messageText;

    const partText = extractOpenAIMessageText(input as OpenAIChatMessagePart[]);
    if (partText) return partText;

    const looseText = input
      .map((entry) => extractOpenAILooseText(entry))
      .filter((entry): entry is string => Boolean(entry))
      .join("\n")
      .trim();
    return looseText.length > 0 ? looseText : undefined;
  }
  if (!input || typeof input !== "object") {
    return undefined;
  }
  return extractOpenAILooseText(input);
}

function extractOpenAILooseText(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return firstDefinedString([
    toNormalizedString(record.text),
    toNormalizedString(record.input_text),
    toNormalizedString(record.content),
    toNormalizedString(record.value),
    toNormalizedString(record.query),
    toNormalizedString(record.prompt)
  ]);
}

function toNormalizedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return normalizeUserMessage(value);
}

function safeJsonParse<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function combineReplyAndProactive(reply: string, proactiveText: string | undefined): string {
  const proactive = normalizeUserMessage(proactiveText);
  if (!proactive) return reply;
  return `${reply}\n\n${proactive}`;
}

function resolveOpenAiUsage(
  providerUsage:
    | {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      }
    | undefined,
  promptText: string | undefined,
  completionText: string | undefined
): {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
} {
  if (!providerUsage) {
    return estimateOpenAiUsage(promptText, completionText);
  }

  const promptTokens = normalizeNonNegativeNumber(providerUsage.promptTokens);
  const completionTokens = normalizeNonNegativeNumber(providerUsage.completionTokens);
  const totalTokens =
    normalizeNonNegativeNumber(providerUsage.totalTokens) || promptTokens + completionTokens;

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens
  };
}

function estimateOpenAiUsage(promptText: string | undefined, completionText: string | undefined): {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
} {
  const promptTokens = estimateTokenCount(promptText);
  const completionTokens = estimateTokenCount(completionText);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens
  };
}

function estimateTokenCount(text: string | undefined): number {
  const normalized = normalizeUserMessage(text);
  if (!normalized) return 0;
  const charCount = Array.from(normalized).length;
  return Math.max(1, Math.ceil(charCount / 4));
}

function normalizeNonNegativeNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function joinUsageParts(parts: Array<string | undefined>): string | undefined {
  const normalized = parts
    .map((part) => normalizeUserMessage(part))
    .filter((part): part is string => Boolean(part));
  if (normalized.length === 0) return undefined;
  return normalized.join("\n\n");
}

function applyOpenAiCompatHeaders(
  res: ServerResponse,
  sessionId: string,
  requestId: string,
  promptText: string | undefined
): void {
  const metrics = resolvePromptContextMetrics(promptText);
  res.setHeader("x-mlex-session-id", sessionId);
  res.setHeader("x-mlex-request-id", requestId);
  res.setHeader("x-mlex-context-length", String(metrics.tokens));
  res.setHeader("x-mlex-context-tokens", String(metrics.tokens));
  res.setHeader("x-mlex-context-chars", String(metrics.chars));
}

function resolvePromptContextMetrics(promptText: string | undefined): {
  tokens: number;
  chars: number;
} {
  const normalized = normalizeUserMessage(promptText);
  if (!normalized) {
    return { tokens: 0, chars: 0 };
  }
  return {
    tokens: estimateTokenCount(normalized),
    chars: Array.from(normalized).length
  };
}

async function prepareSharedContextForRequest(
  runtimeSet: SessionRuntimeSet,
  message: string
): Promise<Context | undefined> {
  const normalized = normalizeUserMessage(message);
  if (!normalized) return undefined;

  try {
    await runtimeSet.sharedRuntime.memoryManager.addEvent(
      createSharedMirrorEvent("user", normalized, runtimeSet.sessionId, Date.now())
    );
    return await runtimeSet.sharedRuntime.agent.getContext(normalized);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[web] shared-context prepare failed: ${reason}`);
    return undefined;
  }
}

async function appendSharedAssistantMirror(
  runtimeSet: SessionRuntimeSet,
  assistantText: string
): Promise<void> {
  const normalized = normalizeUserMessage(assistantText);
  if (!normalized) return;
  try {
    await runtimeSet.sharedRuntime.memoryManager.addEvent(
      createSharedMirrorEvent("assistant", normalized, runtimeSet.sessionId, Date.now())
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[web] shared-context assistant mirror failed: ${reason}`);
  }
}

function buildSharedExternalSystemContext(sharedContext: Context | undefined): string | undefined {
  if (!sharedContext) return undefined;
  const formatted = normalizeUserMessage(sharedContext.formatted);
  if (!formatted) return undefined;
  const maxChars = 24_000;
  const clipped =
    formatted.length <= maxChars
      ? formatted
      : `${formatted.slice(0, maxChars)}\n...[truncated shared context]`;
  return [
    "=== SHARED MEMORY (CROSS-SESSION) ===",
    "The following context is global/shared across sessions and should be used as auxiliary memory.",
    clipped
  ].join("\n");
}

function resolveSystemFingerprint(config: AppConfig): string {
  const seed = [
    config.service.provider,
    resolveCurrentModelId(config),
    config.component.embedder,
    config.component.chunkStrategy
  ].join("|");
  return `fp_${createHash("sha1").update(seed).digest("hex").slice(0, 12)}`;
}

function createSharedMirrorEvent(
  role: MemoryEvent["role"],
  text: string,
  sessionId: string,
  timestamp: number
): MemoryEvent {
  return {
    id: createId("event"),
    role,
    text,
    timestamp,
    metadata: {
      scope: "shared",
      sourceSessionId: sessionId
    }
  };
}

function normalizeSessionId(sessionId: string | undefined): string {
  if (typeof sessionId !== "string") return "default";
  const normalized = sessionId.trim();
  return normalized.length > 0 ? normalized : "default";
}

function toSessionStorageSuffix(sessionId: string): string {
  const normalized = sessionId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const hash = createHash("sha1").update(sessionId).digest("hex").slice(0, 8);
  const label = normalized.length > 0 ? normalized : "session";
  return `${label}-${hash}`;
}

function appendSuffixToFilePath(filePath: string, suffix: string): string {
  const parsed = parse(filePath);
  const fileName = parsed.name.length > 0 ? parsed.name : "data";
  const nextName = `${fileName}.${suffix}${parsed.ext}`;
  if (parsed.dir.length === 0) {
    return nextName;
  }
  return join(parsed.dir, nextName);
}

function appendSuffixToDirectoryPath(directoryPath: string, suffix: string): string {
  return join(directoryPath, suffix);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeRequestId(requestId: string | undefined): string {
  if (typeof requestId !== "string") return createId("req");
  const normalized = requestId.trim();
  return normalized.length > 0 ? normalized : createId("req");
}

function createRequestAbortSignal(req: IncomingMessage, res: ServerResponse): AbortSignal {
  const controller = new AbortController();
  const abort = (): void => {
    if (controller.signal.aborted) return;
    controller.abort();
  };
  req.once("aborted", abort);
  req.once("close", abort);
  res.once("close", abort);
  res.once("finish", abort);
  return controller.signal;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

function sendHtml(res: ServerResponse, html: string): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

function sendSseEvent(res: ServerResponse, event: string, payload: unknown): void {
  const data = JSON.stringify(payload);
  res.write(`event: ${event}\n`);
  res.write(`data: ${data}\n\n`);
}

function sendOpenAiSseData(res: ServerResponse, payload: unknown): void {
  if (payload === "[DONE]") {
    res.write("data: [DONE]\n\n");
    return;
  }
  const data = JSON.stringify(payload);
  res.write(`data: ${data}\n\n`);
}

function beginProactiveSseStream(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  subscribersBySession: ProactiveSubscriberMap
): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  sendSseEvent(res, "ready", { sessionId, at: Date.now() });

  const subscribers = subscribersBySession.get(sessionId) ?? new Set<ServerResponse>();
  subscribers.add(res);
  subscribersBySession.set(sessionId, subscribers);

  const cleanup = (): void => {
    const current = subscribersBySession.get(sessionId);
    if (!current) return;
    current.delete(res);
    if (current.size === 0) {
      subscribersBySession.delete(sessionId);
    }
  };

  req.once("aborted", cleanup);
  req.once("close", cleanup);
  res.once("close", cleanup);
  res.once("finish", cleanup);
}

function broadcastProactiveEvent(
  subscribersBySession: ProactiveSubscriberMap,
  sessionId: string,
  payload: Record<string, unknown>
): void {
  const subscribers = subscribersBySession.get(sessionId);
  if (!subscribers || subscribers.size === 0) return;

  for (const subscriber of [...subscribers]) {
    if (subscriber.writableEnded || subscriber.destroyed) {
      subscribers.delete(subscriber);
      continue;
    }
    try {
      sendSseEvent(subscriber, "proactive", payload);
    } catch {
      subscribers.delete(subscriber);
    }
  }

  if (subscribers.size === 0) {
    subscribersBySession.delete(sessionId);
  }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: unknown): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

function requireFeatureEnabled(enabled: boolean, i18n: I18n): void {
  if (enabled) return;
  throw new HttpError(404, i18n.t("web.api.error.not_found"));
}

function normalizeAdminToken(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireAdminAuthorization(req: IncomingMessage, adminToken: string | undefined, i18n: I18n): void {
  if (!adminToken) return;
  const provided = extractAdminToken(req);
  if (provided && safeTokenEqual(provided, adminToken)) return;
  throw new HttpError(401, i18n.t("web.api.error.unauthorized"));
}

function safeTokenEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.byteLength !== bufB.byteLength) return false;
  return timingSafeEqual(bufA, bufB);
}

function extractAdminToken(req: IncomingMessage): string | undefined {
  const direct = readHeaderValue(req.headers["x-mlex-admin-token"]);
  if (direct) return direct;

  const authHeader = readHeaderValue(req.headers.authorization);
  if (!authHeader) return undefined;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return undefined;
  const token = match[1]?.trim();
  return token && token.length > 0 ? token : undefined;
}

function readHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return undefined;
  const joined = value.find((item) => item.trim().length > 0);
  return joined?.trim();
}

function resolveRequestI18n(req: IncomingMessage, fallbackLocale: string): I18n {
  const locale = pickLocale(
    [
      readHeaderValue(req.headers["x-mlex-locale"]),
      extractLocaleFromAcceptLanguage(readHeaderValue(req.headers["accept-language"])),
      fallbackLocale
    ],
    "zh-CN"
  );
  return createI18n({ locale });
}

function resolveBodyLimit(rawLimit: number): number {
  if (!Number.isFinite(rawLimit)) return 256 * 1024;
  const normalized = Math.floor(rawLimit);
  if (normalized <= 0) return 256 * 1024;
  return Math.min(4 * 1024 * 1024, Math.max(1024, normalized));
}
