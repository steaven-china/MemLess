import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { stat } from "node:fs/promises";

import type { AppConfig, DeepPartial } from "../config.js";
import { createRuntime } from "../container.js";
import type { IDebugTraceRecorder } from "../debug/DebugTraceRecorder.js";
import { ReadonlyFileService } from "../files/ReadonlyFileService.js";
import { createI18n, extractLocaleFromAcceptLanguage, pickLocale, type I18n } from "../i18n/index.js";
import type { Context } from "../types.js";
import type { IRawEventStore } from "../memory/raw/IRawEventStore.js";
import type { IRelationStore } from "../memory/relation/IRelationStore.js";
import type { IBlockStore } from "../memory/store/IBlockStore.js";
import { renderAppHtml } from "./renderAppHtml.js";

export interface WebServerOptions {
  host?: string;
  port?: number;
  runtimeOverrides?: DeepPartial<AppConfig>;
}

export interface StartedWebServer {
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

interface ChatRequestBody {
  message?: string;
}

interface LastContextState {
  query: string;
  at: number;
  context: Context;
}

interface DebugState {
  lastContext?: LastContextState;
}

export async function startWebServer(options: WebServerOptions = {}): Promise<StartedWebServer> {
  const runtime = createRuntime(options.runtimeOverrides ?? {});
  const fileService = new ReadonlyFileService({ rootPath: process.cwd() });
  const debugState: DebugState = {};
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 8787;

  const server = createServer(async (req, res) => {
    const i18n = resolveRequestI18n(req, runtime.config.component.locale);
    try {
      await routeRequest(req, res, runtime, debugState, fileService, i18n);
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
      await closeServer(server);
      await runtime.close();
    }
  };
}

async function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: ReturnType<typeof createRuntime>,
  debugState: DebugState,
  fileService: ReadonlyFileService,
  i18n: I18n
): Promise<void> {
  const bodyLimit = resolveBodyLimit(runtime.config.component.webRequestBodyMaxBytes);
  const adminToken = normalizeAdminToken(runtime.config.component.webAdminToken);
  const debugApiEnabled = runtime.config.component.webDebugApiEnabled;
  const fileApiEnabled = runtime.config.component.webFileApiEnabled;
  const exposeRawContext = runtime.config.component.webExposeRawContext;
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
      debugTraceEnabled: runtime.config.component.debugTraceEnabled,
      debugTraceMaxEntries: runtime.config.component.debugTraceMaxEntries
    });
    return;
  }

  if (method === "POST" && pathname === "/api/chat") {
    const body = await readJson<ChatRequestBody>(req, i18n, bodyLimit);
    const message = normalizeUserMessage(body.message);
    if (!message) {
      sendJson(res, 400, { error: i18n.t("web.api.error.message_required") });
      return;
    }
    const result = await runtime.agent.respond(message);
    debugState.lastContext = {
      query: message,
      at: Date.now(),
      context: result.context
    };
    const payload: Record<string, unknown> = {
      reply: result.text,
      proactiveReply: result.proactiveText ?? null,
      context: result.context.formatted,
      blocks: result.context.blocks,
      prediction: result.context.prediction ?? null
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

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    try {
      const result = await runtime.agent.respondStream(message, (token) => {
        sendSseEvent(res, "token", { token });
      });
      debugState.lastContext = {
        query: message,
        at: Date.now(),
        context: result.context
      };
      const donePayload: Record<string, unknown> = {
        reply: result.text,
        proactiveReply: result.proactiveText ?? null,
        context: result.context.formatted,
        blocks: result.context.blocks,
        prediction: result.context.prediction ?? null
      };
      if (exposeRawContext) {
        donePayload.rawContext = result.context;
      }
      sendSseEvent(res, "done", donePayload);
      res.end();
    } catch (error) {
      sendSseEvent(res, "error", {
        error: error instanceof Error ? error.message : i18n.t("web.error.stream_unknown")
      });
      res.end();
    }
    return;
  }

  if (method === "POST" && pathname === "/api/seal") {
    await runtime.agent.sealMemory();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "GET" && pathname === "/api/debug/database") {
    requireFeatureEnabled(debugApiEnabled, i18n);
    requireAdminAuthorization(req, adminToken, i18n);
    const snapshot = await buildDebugDatabaseSnapshot(runtime, debugState.lastContext);
    sendJson(res, 200, snapshot);
    return;
  }

  if (method === "GET" && pathname === "/api/debug/traces") {
    requireFeatureEnabled(debugApiEnabled, i18n);
    requireAdminAuthorization(req, adminToken, i18n);
    const traceRecorder = runtime.container.resolve<IDebugTraceRecorder>("debugTraceRecorder");
    const limit = parsePositiveInt(url.searchParams.get("limit"), 500);
    sendJson(res, 200, {
      total: traceRecorder.size(),
      entries: traceRecorder.list(Math.min(limit, 5000))
    });
    return;
  }

  if (method === "POST" && pathname === "/api/debug/traces/clear") {
    requireFeatureEnabled(debugApiEnabled, i18n);
    requireAdminAuthorization(req, adminToken, i18n);
    const traceRecorder = runtime.container.resolve<IDebugTraceRecorder>("debugTraceRecorder");
    traceRecorder.clear();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "GET" && pathname === "/api/debug/block") {
    requireFeatureEnabled(debugApiEnabled, i18n);
    requireAdminAuthorization(req, adminToken, i18n);
    const blockId = url.searchParams.get("id")?.trim();
    if (!blockId) {
      sendJson(res, 400, { error: i18n.t("web.api.error.id_required") });
      return;
    }
    const detail = await buildDebugBlockDetail(runtime, blockId);
    if (!detail) {
      sendJson(res, 404, { error: i18n.t("web.api.error.block_not_found") });
      return;
    }
    sendJson(res, 200, detail);
    return;
  }

  if (method === "GET" && pathname === "/api/files/list") {
    requireFeatureEnabled(fileApiEnabled, i18n);
    requireAdminAuthorization(req, adminToken, i18n);
    const pathInput = url.searchParams.get("path") ?? ".";
    const maxEntries = parsePositiveInt(url.searchParams.get("maxEntries"), 200);
    try {
      const entries = await fileService.list(pathInput, maxEntries);
      sendJson(res, 200, { path: pathInput, entries });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 400, { error: message });
    }
    return;
  }

  if (method === "GET" && pathname === "/api/files/read") {
    requireFeatureEnabled(fileApiEnabled, i18n);
    requireAdminAuthorization(req, adminToken, i18n);
    const pathInput = url.searchParams.get("path")?.trim();
    if (!pathInput) {
      sendJson(res, 400, { error: i18n.t("web.api.error.path_required") });
      return;
    }
    const maxBytes = parsePositiveInt(url.searchParams.get("maxBytes"), 64 * 1024);
    try {
      const result = await fileService.read(pathInput, maxBytes);
      sendJson(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 400, { error: message });
    }
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
  if (provided === adminToken) return;
  throw new HttpError(401, i18n.t("web.api.error.unauthorized"));
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


