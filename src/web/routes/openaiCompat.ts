import type { IncomingMessage, ServerResponse } from "node:http";

import type { ChatMessage, ILLMProvider, LlmUsage } from "../../agent/LLMProvider.js";
import type { AppConfig } from "../../config.js";
import type { createRuntime } from "../../container.js";
import type { IDebugTraceRecorder } from "../../debug/DebugTraceRecorder.js";
import type { I18n } from "../../i18n/index.js";
import type { Context } from "../../types.js";
import { createId } from "../../utils/id.js";
import {
  decideBridgeRouting,
  type BridgeExecutionResult,
  type BridgeMode,
  type OpenAIChatRequestBody
} from "../bridge/openaiCompatBridge.js";

interface SessionRuntimeSet {
  sessionId: string;
  privateRuntime: ReturnType<typeof createRuntime>;
  sharedRuntime: ReturnType<typeof createRuntime>;
}

interface NormalizedOpenAIChatRequest {
  message?: string;
  stream: boolean;
  includeUsage: boolean;
  sessionId: string;
  requestId?: string;
  model?: string;
}

interface OpenAiCompatPassthroughInput {
  req: IncomingMessage;
  res: ServerResponse;
  body: OpenAIChatRequestBody;
  request: NormalizedOpenAIChatRequest;
  requestId: string;
  bridgeMode: BridgeMode;
  hasOpenClawBridgeSignal: boolean;
  openaiCompatBypassAgent: boolean;
  signal: AbortSignal;
  runtime: ReturnType<typeof createRuntime>;
  traceRecorder?: IDebugTraceRecorder;
}

interface OpenAiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAiCompatHelpers {
  sendJson: (res: ServerResponse, statusCode: number, body: unknown) => void;
  readJson: <T>(req: IncomingMessage, i18n: I18n, maxBytes: number) => Promise<T>;
  normalizeOpenAIChatRequest: (body: OpenAIChatRequestBody) => NormalizedOpenAIChatRequest;
  normalizeRequestId: (requestId: string | undefined) => string;
  createRequestAbortSignal: (req: IncomingMessage, res: ServerResponse) => AbortSignal;
  isOpenClawBridgeRequest: (req: IncomingMessage, body: OpenAIChatRequestBody) => boolean;
  executeBridgePassthrough: (input: OpenAiCompatPassthroughInput) => Promise<BridgeExecutionResult>;
  resolveCurrentModelId: (config: AppConfig) => string;
  normalizeOpenAIProviderMessages: (
    body: OpenAIChatRequestBody,
    fallbackMessage: string | undefined
  ) => ChatMessage[];
  joinUsageParts: (parts: Array<string | undefined>) => string | undefined;
  resolveSystemFingerprint: (config: AppConfig) => string;
  applyOpenAiCompatHeaders: (
    res: ServerResponse,
    sessionId: string,
    requestId: string,
    promptText: string | undefined
  ) => void;
  sendOpenAiSseData: (res: ServerResponse, payload: unknown) => void;
  readProviderUsage: (provider: ILLMProvider) => LlmUsage | undefined;
  resolveOpenAiUsage: (
    providerUsage: LlmUsage | undefined,
    promptText: string | undefined,
    completionText: string | undefined
  ) => OpenAiUsage;
  prepareSharedContextForRequest: (runtimeSet: SessionRuntimeSet, message: string) => Promise<Context | undefined>;
  buildSharedExternalSystemContext: (sharedContext: Context | undefined) => string | undefined;
  appendSharedAssistantMirror: (runtimeSet: SessionRuntimeSet, assistantText: string) => Promise<void>;
  combineReplyAndProactive: (reply: string, proactiveText: string | undefined) => string;
  normalizeUserMessage: (message: string | undefined) => string | undefined;
}

export interface OpenAiCompatRouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  pathname: string;
  bodyLimit: number;
  i18n: I18n;
  defaultRuntime: SessionRuntimeSet;
  resolveRuntimeForSession: (sessionId: string) => SessionRuntimeSet;
  helpers: OpenAiCompatHelpers;
}

export async function handleOpenAiCompatRoute(input: OpenAiCompatRouteContext): Promise<boolean> {
  const { req, res, method, pathname, bodyLimit, i18n, defaultRuntime, resolveRuntimeForSession, helpers } = input;
  if (method === "GET" && pathname === "/v1/models") {
    const modelId = helpers.resolveCurrentModelId(defaultRuntime.privateRuntime.config);
    helpers.sendJson(res, 200, {
      object: "list",
      data: [
        {
          id: modelId,
          object: "model",
          created: 0,
          owned_by: "mlex"
        }
      ]
    });
    return true;
  }

  if (method !== "POST" || pathname !== "/v1/chat/completions") {
    return false;
  }

  const body = await helpers.readJson<OpenAIChatRequestBody>(req, i18n, bodyLimit);
  const request = helpers.normalizeOpenAIChatRequest(body);
  const requestId = helpers.normalizeRequestId(request.requestId);
  const signal = helpers.createRequestAbortSignal(req, res);
  const completionId = createId("chatcmpl");
  const created = Math.floor(Date.now() / 1000);
  const compatComponent = defaultRuntime.privateRuntime.config.component;
  const bridgeMode = compatComponent.bridgeMode;
  const hasOpenClawBridgeSignal = helpers.isOpenClawBridgeRequest(req, body);
  const bridgeDecision = decideBridgeRouting({
    openaiCompatBypassAgent: compatComponent.openaiCompatBypassAgent,
    bridgeMode,
    hasOpenClawBridgeSignal
  });
  const bypassNativeAgent = bridgeDecision.bypassNativeAgent;
  const bridgeTraceRecorder =
    defaultRuntime.privateRuntime.container.resolve<IDebugTraceRecorder>("debugTraceRecorder");
  if (hasOpenClawBridgeSignal || bypassNativeAgent) {
    bridgeTraceRecorder.record("web.bridge", "detected", {
      sessionId: request.sessionId,
      requestId,
      bridgeMode,
      provider: defaultRuntime.privateRuntime.config.service.provider,
      hasOpenClawBridgeSignal,
      openaiCompatBypassAgent: compatComponent.openaiCompatBypassAgent,
      bypassNativeAgent,
      decisionReason: bridgeDecision.reason
    });
  }

  if (bypassNativeAgent) {
    const compatRuntime = resolveRuntimeForSession(request.sessionId).privateRuntime;
    const bridgeExecution = await helpers.executeBridgePassthrough({
      req,
      res,
      body,
      request,
      requestId,
      bridgeMode,
      hasOpenClawBridgeSignal,
      openaiCompatBypassAgent: compatComponent.openaiCompatBypassAgent,
      signal,
      runtime: compatRuntime,
      traceRecorder: bridgeTraceRecorder
    });
    if (bridgeExecution.handled) return true;
    if (bridgeExecution.errorCode) {
      helpers.sendJson(res, 502, {
        error: {
          message: bridgeExecution.errorMessage ?? "OpenAI-compatible bridge passthrough failed.",
          type: "bridge_error",
          code: bridgeExecution.errorCode
        }
      });
      return true;
    }

    const provider = compatRuntime.container.resolve<ILLMProvider>("provider");
    const providerMessages = helpers.normalizeOpenAIProviderMessages(body, request.message);
    if (providerMessages.length === 0) {
      helpers.sendJson(res, 400, {
        error: {
          message: i18n.t("web.api.error.message_required"),
          type: "invalid_request_error"
        }
      });
      return true;
    }
    const promptUsageSource = helpers.joinUsageParts(providerMessages.map((entry) => entry.content));
    const model = request.model ?? helpers.resolveCurrentModelId(compatRuntime.config);
    const systemFingerprint = helpers.resolveSystemFingerprint(compatRuntime.config);

    if (request.stream) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      helpers.applyOpenAiCompatHeaders(res, request.sessionId, requestId, promptUsageSource);
      helpers.sendOpenAiSseData(res, {
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model,
        system_fingerprint: systemFingerprint,
        choices: [
          {
            index: 0,
            delta: { role: "assistant" },
            finish_reason: null
          }
        ]
      });

      try {
        let content = "";
        if (provider.generateStream) {
          content = await provider.generateStream(
            providerMessages,
            (token) => {
              if (signal.aborted || res.writableEnded) return;
              if (typeof token !== "string" || token.length === 0) return;
              helpers.sendOpenAiSseData(res, {
                id: completionId,
                object: "chat.completion.chunk",
                created,
                model,
                system_fingerprint: systemFingerprint,
                choices: [
                  {
                    index: 0,
                    delta: { content: token },
                    finish_reason: null
                  }
                ]
              });
            },
            { signal }
          );
        } else {
          content = await provider.generate(providerMessages, { signal });
          if (!signal.aborted && !res.writableEnded && content.length > 0) {
            helpers.sendOpenAiSseData(res, {
              id: completionId,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: systemFingerprint,
              choices: [
                {
                  index: 0,
                  delta: { content },
                  finish_reason: null
                }
              ]
            });
          }
        }

        const usage = helpers.resolveOpenAiUsage(helpers.readProviderUsage(provider), promptUsageSource, content);
        if (!signal.aborted && !res.writableEnded) {
          helpers.sendOpenAiSseData(res, {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            system_fingerprint: systemFingerprint,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: "stop"
              }
            ]
          });
          if (request.includeUsage) {
            helpers.sendOpenAiSseData(res, {
              id: completionId,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: systemFingerprint,
              choices: [],
              usage
            });
          }
          helpers.sendOpenAiSseData(res, "[DONE]");
          res.end();
        }
      } catch (error) {
        if (!res.writableEnded) {
          helpers.sendOpenAiSseData(res, {
            error: {
              message: error instanceof Error ? error.message : i18n.t("web.error.stream_unknown"),
              type: "server_error"
            }
          });
          helpers.sendOpenAiSseData(res, "[DONE]");
          res.end();
        }
      }
      return true;
    }

    const content = await provider.generate(providerMessages, { signal });
    const usage = helpers.resolveOpenAiUsage(helpers.readProviderUsage(provider), promptUsageSource, content);
    helpers.applyOpenAiCompatHeaders(res, request.sessionId, requestId, promptUsageSource);
    helpers.sendJson(res, 200, {
      id: completionId,
      object: "chat.completion",
      created,
      model,
      system_fingerprint: systemFingerprint,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content
          },
          finish_reason: "stop"
        }
      ],
      usage
    });
    return true;
  }

  if (!request.message) {
    helpers.sendJson(res, 400, {
      error: {
        message: i18n.t("web.api.error.message_required"),
        type: "invalid_request_error"
      }
    });
    return true;
  }

  const runtimeSet = resolveRuntimeForSession(request.sessionId);
  const model = request.model ?? helpers.resolveCurrentModelId(runtimeSet.privateRuntime.config);
  const systemFingerprint = helpers.resolveSystemFingerprint(runtimeSet.privateRuntime.config);
  const sharedContext = await helpers.prepareSharedContextForRequest(runtimeSet, request.message);
  const externalSystemContext = helpers.buildSharedExternalSystemContext(sharedContext);
  const promptUsageSource = helpers.joinUsageParts([request.message, externalSystemContext]);

  if (request.stream) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    helpers.applyOpenAiCompatHeaders(res, request.sessionId, requestId, promptUsageSource);
    helpers.sendOpenAiSseData(res, {
      id: completionId,
      object: "chat.completion.chunk",
      created,
      model,
      system_fingerprint: systemFingerprint,
      choices: [
        {
          index: 0,
          delta: { role: "assistant" },
          finish_reason: null
        }
      ]
    });
    try {
      const result = await runtimeSet.privateRuntime.agent.respondStream(
        request.message,
        (token) => {
          if (signal.aborted || res.writableEnded) return;
          if (typeof token !== "string" || token.length === 0) return;
          const content = token;
          helpers.sendOpenAiSseData(res, {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            system_fingerprint: systemFingerprint,
            choices: [
              {
                index: 0,
                delta: { content },
                finish_reason: null
              }
            ]
          });
        },
        {
          signal,
          externalSystemContext
        }
      );
      await helpers.appendSharedAssistantMirror(
        runtimeSet,
        helpers.combineReplyAndProactive(result.text, result.proactiveText)
      );
      const completionContent = helpers.combineReplyAndProactive(result.text, result.proactiveText);
      const usage = helpers.resolveOpenAiUsage(result.llmUsage, promptUsageSource, completionContent);
      const proactiveText = helpers.normalizeUserMessage(result.proactiveText);
      if (!signal.aborted && !res.writableEnded && proactiveText) {
        helpers.sendOpenAiSseData(res, {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model,
          system_fingerprint: systemFingerprint,
          choices: [
            {
              index: 0,
              delta: { content: `\n\n${proactiveText}` },
              finish_reason: null
            }
          ]
        });
      }
      if (!signal.aborted && !res.writableEnded) {
        helpers.sendOpenAiSseData(res, {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model,
          system_fingerprint: systemFingerprint,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop"
            }
          ]
        });
        if (request.includeUsage) {
          helpers.sendOpenAiSseData(res, {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            system_fingerprint: systemFingerprint,
            choices: [],
            usage
          });
        }
        helpers.sendOpenAiSseData(res, "[DONE]");
        res.end();
      }
    } catch (error) {
      if (!res.writableEnded) {
        helpers.sendOpenAiSseData(res, {
          error: {
            message: error instanceof Error ? error.message : i18n.t("web.error.stream_unknown"),
            type: "server_error"
          }
        });
        helpers.sendOpenAiSseData(res, "[DONE]");
        res.end();
      }
    }
    return true;
  }

  const result = await runtimeSet.privateRuntime.agent.respond(request.message, {
    signal,
    externalSystemContext
  });
  await helpers.appendSharedAssistantMirror(
    runtimeSet,
    helpers.combineReplyAndProactive(result.text, result.proactiveText)
  );
  const content = helpers.combineReplyAndProactive(result.text, result.proactiveText);
  const usage = helpers.resolveOpenAiUsage(result.llmUsage, promptUsageSource, content);
  helpers.applyOpenAiCompatHeaders(res, request.sessionId, requestId, promptUsageSource);
  helpers.sendJson(res, 200, {
    id: completionId,
    object: "chat.completion",
    created,
    model,
    system_fingerprint: systemFingerprint,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content
        },
        finish_reason: "stop"
      }
    ],
    usage
  });
  return true;
}
