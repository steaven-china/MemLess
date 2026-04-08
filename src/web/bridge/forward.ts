import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, resolve } from "node:path";
import { Readable } from "node:stream";

import type { AppConfig } from "../../config.js";
import type { createRuntime } from "../../container.js";
import type { IDebugTraceRecorder } from "../../debug/DebugTraceRecorder.js";
import type { IRelationStore } from "../../memory/relation/IRelationStore.js";
import { RelationType } from "../../types.js";
import { normalizeOpenAIChatRequest, resolveOpenClawSideBag } from "./normalize.js";
import type { NormalizedOpenAIChatRequest, OpenAIChatRequestBody } from "./types.js";
import { asObjectRecord, firstDefinedString, normalizeText, safeJsonParse, toNormalizedString } from "./utils.js";
import type { BridgeMode } from "./orchestrator.js";

export interface OpenAiCompatPassthroughInput {
  req: IncomingMessage;
  res: ServerResponse;
  body: OpenAIChatRequestBody;
  request: NormalizedOpenAIChatRequest;
  requestId: string;
  bridgeMode?: BridgeMode;
  signal: AbortSignal;
  runtime: ReturnType<typeof createRuntime>;
  resolveCurrentModelId: (config: AppConfig) => string;
  applyOpenAiCompatHeaders: (
    res: ServerResponse,
    sessionId: string,
    requestId: string,
    promptUsageSource: string | undefined
  ) => void;
  traceRecorder?: IDebugTraceRecorder;
}

interface OpenAiCompatPassthroughTarget {
  endpoint: string;
  headers: Record<string, string>;
  includeModelInBody: boolean;
}

export async function tryHandleOpenAiCompatPassthrough(
  input: OpenAiCompatPassthroughInput
): Promise<boolean> {
  const traceRecorder = input.traceRecorder ?? resolveBridgeTraceRecorder(input.runtime);
  const target = resolveOpenAiCompatPassthroughTarget(input.runtime.config);
  if (!target) {
    traceRecorder?.record("web.bridge", "forward.unavailable", {
      sessionId: input.request.sessionId,
      requestId: input.requestId,
      bridgeMode: input.bridgeMode,
      provider: input.runtime.config.service.provider
    });
    return false;
  }

  const payload = buildOpenAiCompatPassthroughPayload(
    input.body,
    input.request,
    input.resolveCurrentModelId(input.runtime.config),
    target.includeModelInBody
  );
  const promptUsageSource = normalizeOpenAIChatRequest(payload as OpenAIChatRequestBody).message;
  const forwardStartAt = Date.now();
  traceRecorder?.record("web.bridge", "forward.start", {
    sessionId: input.request.sessionId,
    requestId: input.requestId,
    bridgeMode: input.bridgeMode,
    stream: input.request.stream,
    provider: input.runtime.config.service.provider,
    hasMessage: Boolean(input.request.message),
    hasToolCalls: payloadContainsToolCalls(payload)
  });

  let projectedFilePaths = 0;
  try {
    projectedFilePaths = await recordBridgeFileQueryRelations(input.runtime, payload, input.request.sessionId);
    if (projectedFilePaths > 0) {
      traceRecorder?.record("web.bridge", "relation.projected", {
        sessionId: input.request.sessionId,
        requestId: input.requestId,
        bridgeMode: input.bridgeMode,
        projectedFilePaths
      });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    traceRecorder?.record("web.bridge", "relation.project.fail", {
      sessionId: input.request.sessionId,
      requestId: input.requestId,
      bridgeMode: input.bridgeMode,
      reason
    });
    console.warn(`[web] bridge relation projection failed: ${reason}`);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.endpoint, {
      method: "POST",
      headers: target.headers,
      body: JSON.stringify(payload),
      signal: input.signal
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    traceRecorder?.record("web.bridge", "forward.fail", {
      sessionId: input.request.sessionId,
      requestId: input.requestId,
      bridgeMode: input.bridgeMode,
      provider: input.runtime.config.service.provider,
      reason
    });
    throw error;
  }

  input.res.statusCode = upstream.status;
  copyResponseHeadersFromUpstream(input.res, upstream);
  input.applyOpenAiCompatHeaders(
    input.res,
    input.request.sessionId,
    input.requestId,
    promptUsageSource
  );
  traceRecorder?.record("web.bridge", "forward.ok", {
    sessionId: input.request.sessionId,
    requestId: input.requestId,
    bridgeMode: input.bridgeMode,
    provider: input.runtime.config.service.provider,
    statusCode: upstream.status,
    durationMs: Date.now() - forwardStartAt,
    projectedFilePaths
  });

  if (!upstream.body) {
    const text = await upstream.text();
    input.res.end(text);
    return true;
  }

  const readable = Readable.fromWeb(upstream.body as ReadableStream<Uint8Array>);
  readable.on("error", () => {
    if (!input.res.writableEnded) {
      input.res.end();
    }
  });
  readable.pipe(input.res);
  return true;
}

function payloadContainsToolCalls(payload: Record<string, unknown>): boolean {
  const messages = payload.messages;
  if (!Array.isArray(messages)) return false;
  return messages.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const toolCalls = (entry as Record<string, unknown>).tool_calls;
    return Array.isArray(toolCalls) && toolCalls.length > 0;
  });
}

function resolveBridgeTraceRecorder(
  runtime: ReturnType<typeof createRuntime>
): IDebugTraceRecorder | undefined {
  try {
    return runtime.container.resolve<IDebugTraceRecorder>("debugTraceRecorder");
  } catch {
    return undefined;
  }
}

function resolveOpenAiCompatPassthroughTarget(
  config: AppConfig
): OpenAiCompatPassthroughTarget | undefined {
  const service = config.service;
  if (service.provider === "openai-compatible") {
    if (!service.openaiCompatibleApiKey || !service.openaiCompatibleBaseUrl) return undefined;
    return {
      endpoint: buildOpenAiCompatEndpoint(service.openaiCompatibleBaseUrl, "/chat/completions"),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${service.openaiCompatibleApiKey}`
      },
      includeModelInBody: true
    };
  }
  if (service.provider === "openai") {
    if (!service.openaiApiKey) return undefined;
    return {
      endpoint: buildOpenAiCompatEndpoint(service.openaiBaseUrl, "/chat/completions"),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${service.openaiApiKey}`
      },
      includeModelInBody: true
    };
  }
  if (service.provider === "deepseek-reasoner") {
    if (!service.deepseekApiKey) return undefined;
    return {
      endpoint: buildOpenAiCompatEndpoint(service.deepseekBaseUrl, "/chat/completions"),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${service.deepseekApiKey}`
      },
      includeModelInBody: true
    };
  }
  if (service.provider === "openrouter") {
    if (!service.openrouterApiKey) return undefined;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${service.openrouterApiKey}`
    };
    const appName = normalizeText(service.openrouterAppName);
    if (appName) {
      headers["X-Title"] = appName;
    }
    const siteUrl = normalizeText(service.openrouterSiteUrl);
    if (siteUrl) {
      headers["HTTP-Referer"] = siteUrl;
    }
    return {
      endpoint: buildOpenAiCompatEndpoint(service.openrouterBaseUrl, "/chat/completions"),
      headers,
      includeModelInBody: true
    };
  }
  if (service.provider === "azure-openai") {
    if (!service.azureOpenaiApiKey || !service.azureOpenaiEndpoint || !service.azureOpenaiDeployment) {
      return undefined;
    }
    return {
      endpoint: buildOpenAiCompatEndpoint(
        service.azureOpenaiEndpoint,
        `/openai/deployments/${encodeURIComponent(service.azureOpenaiDeployment)}/chat/completions`,
        {
          "api-version": service.azureOpenaiApiVersion
        }
      ),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${service.azureOpenaiApiKey}`
      },
      includeModelInBody: false
    };
  }
  return undefined;
}

function buildOpenAiCompatEndpoint(
  baseUrl: string,
  requestPath: string,
  query?: Record<string, string | undefined>
): string {
  const endpoint = new URL(requestPath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    endpoint.searchParams.set(key, value);
  }
  return endpoint.toString();
}

function buildOpenAiCompatPassthroughPayload(
  body: OpenAIChatRequestBody,
  request: NormalizedOpenAIChatRequest,
  fallbackModel: string,
  includeModelInBody: boolean
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...(body as Record<string, unknown>)
  };
  const sideBag = resolveOpenClawSideBag(body);

  if (payload.messages === undefined && Array.isArray(sideBag?.messages)) {
    payload.messages = sideBag.messages;
  }
  if (payload.input === undefined && sideBag?.input !== undefined) {
    payload.input = sideBag.input;
  }
  if (payload.prompt === undefined && sideBag?.prompt !== undefined) {
    payload.prompt = sideBag.prompt;
  }
  if (payload.query === undefined && sideBag?.query !== undefined) {
    payload.query = sideBag.query;
  }
  if (payload.stream === undefined && typeof sideBag?.stream === "boolean") {
    payload.stream = sideBag.stream;
  }

  const streamOptions = asObjectRecord(payload.stream_options);
  const includeUsageFromSidebag = sideBag?.include_usage === true || sideBag?.includeUsage === true;
  if (includeUsageFromSidebag) {
    if (streamOptions) {
      if (streamOptions.include_usage === undefined && streamOptions.includeUsage === undefined) {
        streamOptions.include_usage = true;
      }
      payload.stream_options = streamOptions;
    } else {
      payload.stream_options = { include_usage: true };
    }
  }

  if (includeModelInBody) {
    const currentModel = toNormalizedString(payload.model);
    if (!currentModel) {
      payload.model = request.model ?? fallbackModel;
    }
  } else {
    delete payload.model;
  }

  if (!Array.isArray(payload.messages) && request.message) {
    payload.messages = [{ role: "user", content: request.message }];
  }

  delete payload.sidecar;
  delete payload.sidebag;
  delete payload.openclaw;
  const metadata = asObjectRecord(payload.metadata);
  if (metadata) {
    delete metadata.sidecar;
    delete metadata.sidebag;
    delete metadata.openclaw;
    if (Object.keys(metadata).length === 0) {
      delete payload.metadata;
    } else {
      payload.metadata = metadata;
    }
  }

  return payload;
}

function copyResponseHeadersFromUpstream(res: ServerResponse, upstream: Response): void {
  for (const [key, value] of upstream.headers.entries()) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === "content-length") continue;
    try {
      res.setHeader(key, value);
    } catch {
      continue;
    }
  }
}

async function recordBridgeFileQueryRelations(
  runtime: ReturnType<typeof createRuntime>,
  payload: Record<string, unknown>,
  sessionId: string
): Promise<number> {
  const filePaths = extractBridgeFileQueryPaths(payload);
  if (filePaths.length === 0) return 0;

  const relationStore = runtime.container.resolve<IRelationStore>("relationStore");
  const activeBlockId = runtime.memoryManager.getActiveBlockId?.();
  const baseTime = Date.now();
  let projected = 0;

  for (let index = 0; index < filePaths.length; index += 1) {
    const normalizedPath = normalizeBridgeFilePath(filePaths[index]);
    if (!normalizedPath) continue;
    const fileEntityId = `file:${normalizedPath}`;
    const snapshotId = `snapshot:${normalizedPath}#bridge-${createHash("sha1")
      .update(`${sessionId}|${normalizedPath}|${baseTime}|${index}`)
      .digest("hex")
      .slice(0, 12)}`;
    const timestamp = baseTime + index * 2;

    await relationStore.add({
      src: snapshotId,
      dst: fileEntityId,
      type: RelationType.SNAPSHOT_OF_FILE,
      timestamp,
      confidence: 1
    });

    if (activeBlockId) {
      await relationStore.add({
        src: fileEntityId,
        dst: activeBlockId,
        type: RelationType.FILE_MENTIONS_BLOCK,
        timestamp: timestamp + 1,
        confidence: 0.75
      });
    }
    projected += 1;
  }
  return projected;
}

function extractBridgeFileQueryPaths(payload: Record<string, unknown>): string[] {
  const output = new Set<string>();
  const messages = extractBridgeMessages(payload);
  for (const message of messages) {
    const entry = asObjectRecord(message);
    if (!entry) continue;

    const messageToolName = resolveToolName(entry);
    if (isBridgeFileReadToolName(messageToolName)) {
      collectPathsFromUnknown(entry, output);
    }

    const toolCalls = entry.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const toolCall of toolCalls) {
        const callEntry = asObjectRecord(toolCall);
        if (!callEntry) continue;
        const functionEntry = asObjectRecord(callEntry.function);
        const callToolName = resolveToolName(functionEntry ?? callEntry);
        if (!isBridgeFileReadToolName(callToolName)) continue;
        collectPathsFromUnknown(callEntry, output);
      }
    }
  }
  return [...output];
}

function extractBridgeMessages(payload: Record<string, unknown>): unknown[] {
  const messages = payload.messages;
  if (Array.isArray(messages)) return messages;

  const input = payload.input;
  if (Array.isArray(input)) return input;
  if (input && typeof input === "object") return [input];
  return [];
}

function resolveToolName(value: Record<string, unknown> | undefined): string | undefined {
  if (!value) return undefined;
  return firstDefinedString([
    toNormalizedString(value.name),
    toNormalizedString(value.tool),
    toNormalizedString(value.toolName)
  ]);
}

function isBridgeFileReadToolName(name: string | undefined): boolean {
  const normalized = name?.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "cat" || normalized === "read_file") return true;
  if (normalized.includes("readonly.read")) return true;
  if (normalized.includes("workspace.read")) return true;
  if (normalized.includes("file.read")) return true;
  return normalized.includes("read") && normalized.includes("file");
}

function collectPathsFromUnknown(value: unknown, output: Set<string>, depth = 0): void {
  if (!value || depth > 10) return;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return;
    const parsed = safeJsonParse<unknown>(trimmed);
    if (parsed) {
      collectPathsFromUnknown(parsed, output, depth + 1);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPathsFromUnknown(entry, output, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  addPathCandidate(record.path, output);
  addPathCandidate(record.filePath, output);
  addPathCandidate(record.filepath, output);
  addPathCandidate(record.targetPath, output);

  if (Array.isArray(record.paths)) {
    for (const item of record.paths) {
      addPathCandidate(item, output);
    }
  }

  for (const nested of [record.args, record.arguments, record.function, record.content]) {
    collectPathsFromUnknown(nested, output, depth + 1);
  }
}

function addPathCandidate(value: unknown, output: Set<string>): void {
  if (typeof value !== "string") return;
  const normalized = normalizeText(value);
  if (!normalized) return;
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) return;
  output.add(normalized);
}

function normalizeBridgeFilePath(pathInput: string | undefined): string | undefined {
  const normalized = normalizeText(pathInput);
  if (!normalized) return undefined;
  const absolutePath = isAbsolute(normalized) ? normalized : resolve(process.cwd(), normalized);
  return absolutePath.replace(/\\/g, "/");
}
