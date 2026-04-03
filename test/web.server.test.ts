import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, test } from "vitest";

import {
  buildSessionScopedRuntimeOverrides,
  startWebServer,
  type StartedWebServer
} from "../src/web/server.js";

describe("Web server", () => {
  let started: StartedWebServer | undefined;

  afterEach(async () => {
    if (started) {
      await started.close();
      started = undefined;
    }
  });

  test("serves health and home page", async () => {
    started = await startWebServer({ host: "127.0.0.1", port: 0 });

    const health = await fetch(`${started.url}/healthz`);
    expect(health.status).toBe(200);
    const healthJson = (await health.json()) as { ok?: boolean };
    expect(healthJson.ok).toBe(true);

    const home = await fetch(started.url);
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain("MLEX Minimal Web");
    expect(html).toContain("/trace-clear");
    expect(html).toContain("/api/debug/traces");
    expect(html).toContain('replyText + "\\n\\n" + proactiveText');
    expect(html).toContain('textSoFar + "\\n\\n" + proactive');
    expect(html).toContain("/api/proactive/stream?sessionId=");
    expect(html).toContain('source.addEventListener("proactive"');
    expect(html).toContain('id="statusTip"');
    expect(html).toContain("showStatusTip(buildProactiveStatusTip");
    expect(html).toContain("mlex.web.transcript.");
    expect(html).toContain("window.sessionStorage");
    expect(html).toContain('id="sessionBtn"');
    expect(html).toContain('id="sessionModal"');
    expect(html).toContain('id="sessionRows"');
  });

  test("builds session-scoped runtime overrides for non-default sessions", () => {
    const base = {
      component: {
        sqliteFilePath: ".mlex/memory.db",
        rawStoreFilePath: ".mlex/raw-events.json",
        relationStoreFilePath: ".mlex/relations.json",
        lanceFilePath: ".mlex/lance-blocks.json",
        lanceDbPath: ".mlex/lancedb",
        chromaCollectionId: "mlex_blocks"
      }
    };

    const scoped = buildSessionScopedRuntimeOverrides(base, "session-A");

    expect(scoped).not.toBe(base);
    expect(scoped.component?.sqliteFilePath).toMatch(/memory\.session-a-[a-f0-9]{8}\.db$/);
    expect(scoped.component?.rawStoreFilePath).toMatch(/raw-events\.session-a-[a-f0-9]{8}\.json$/);
    expect(scoped.component?.relationStoreFilePath).toMatch(/relations\.session-a-[a-f0-9]{8}\.json$/);
    expect(scoped.component?.lanceFilePath).toMatch(/lance-blocks\.session-a-[a-f0-9]{8}\.json$/);
    expect(scoped.component?.lanceDbPath).toMatch(/[\\/]lancedb[\\/]session-a-[a-f0-9]{8}$/);
    expect(scoped.component?.chromaCollectionId).toMatch(/^mlex_blocks_session-a-[a-f0-9]{8}$/);
  });

  test("keeps default session runtime overrides unchanged", () => {
    const base = {
      component: {
        sqliteFilePath: ".mlex/memory.db"
      }
    };
    const scoped = buildSessionScopedRuntimeOverrides(base, "default");
    expect(scoped).toBe(base);
    expect(scoped.component?.sqliteFilePath).toBe(".mlex/memory.db");
  });

  test("exposes web capabilities", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      runtimeOverrides: {
        component: {
          webDebugApiEnabled: true,
          webFileApiEnabled: true,
          webExposeRawContext: true,
          webAdminToken: "abc123"
        }
      }
    });

    const response = await fetch(`${started.url}/api/capabilities`);
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      debugApiEnabled?: boolean;
      fileApiEnabled?: boolean;
      rawContextEnabled?: boolean;
      adminTokenRequired?: boolean;
    };
    expect(data.debugApiEnabled).toBe(true);
    expect(data.fileApiEnabled).toBe(true);
    expect(data.rawContextEnabled).toBe(true);
    expect(data.adminTokenRequired).toBe(true);
  });

  test("exposes OpenAI-compatible model list", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      runtimeOverrides: {
        service: {
          provider: "rule-based"
        }
      }
    });

    const response = await fetch(`${started.url}/v1/models`);
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      object?: string;
      data?: Array<{ id?: string; object?: string; owned_by?: string }>;
    };
    expect(data.object).toBe("list");
    expect(Array.isArray(data.data)).toBe(true);
    expect((data.data?.length ?? 0)).toBeGreaterThan(0);
    expect(typeof data.data?.[0]?.id).toBe("string");
    expect(data.data?.[0]?.object).toBe("model");
    expect(data.data?.[0]?.owned_by).toBe("mlex");
  });

  test("supports OpenAI-compatible chat completion (non-stream)", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0
    });

    const response = await fetch(`${started.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mlex-test-model",
        session_id: "openclaw-s1",
        request_id: "openclaw-r1",
        messages: [
          { role: "system", content: "你是助手" },
          { role: "user", content: "给我一句简短回复" }
        ]
      })
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      id?: string;
      object?: string;
      model?: string;
      system_fingerprint?: string;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
      choices?: Array<{
        index?: number;
        message?: { role?: string; content?: string };
        finish_reason?: string;
      }>;
    };
    expect(typeof data.id).toBe("string");
    expect(data.object).toBe("chat.completion");
    expect(data.model).toBe("mlex-test-model");
    expect(typeof data.system_fingerprint).toBe("string");
    expect((data.system_fingerprint ?? "").startsWith("fp_")).toBe(true);
    expect(Array.isArray(data.choices)).toBe(true);
    expect(data.choices?.[0]?.index).toBe(0);
    expect(data.choices?.[0]?.message?.role).toBe("assistant");
    expect(typeof data.choices?.[0]?.message?.content).toBe("string");
    expect((data.choices?.[0]?.message?.content ?? "").length).toBeGreaterThan(0);
    expect(data.choices?.[0]?.finish_reason).toBe("stop");
    expect(typeof data.usage?.prompt_tokens).toBe("number");
    expect(typeof data.usage?.completion_tokens).toBe("number");
    expect(data.usage?.total_tokens).toBe((data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0));
    expect(response.headers.get("x-mlex-session-id")).toBe("openclaw-s1");
    expect(response.headers.get("x-mlex-request-id")).toBe("openclaw-r1");
    const contextLength = Number.parseInt(response.headers.get("x-mlex-context-length") ?? "0", 10);
    const contextTokens = Number.parseInt(response.headers.get("x-mlex-context-tokens") ?? "0", 10);
    const contextChars = Number.parseInt(response.headers.get("x-mlex-context-chars") ?? "0", 10);
    expect(contextLength).toBeGreaterThan(0);
    expect(contextTokens).toBeGreaterThan(0);
    expect(contextChars).toBeGreaterThan(0);
    expect(contextLength).toBe(contextTokens);
  });

  test("prefers upstream provider usage over local estimate", async () => {
    let upstream: Server | undefined;
    let upstreamUrl = "";
    try {
      upstream = createServer(async (req, res) => {
        const targetPath = req.url?.split("?")[0] ?? "";
        if (req.method === "POST" && (targetPath === "/chat/completions" || targetPath === "/v1/chat/completions")) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify({
              id: "upstream-cmpl-1",
              model: "upstream-model",
              usage: {
                prompt_tokens: 901,
                completion_tokens: 99,
                total_tokens: 1000
              },
              choices: [
                {
                  message: {
                    content: "upstream answer"
                  },
                  finish_reason: "stop"
                }
              ]
            })
          );
          return;
        }
        res.statusCode = 404;
        res.end("not found");
      });
      await new Promise<void>((resolve, reject) => {
        upstream!.once("error", reject);
        upstream!.listen(0, "127.0.0.1", () => resolve());
      });
      const address = upstream.address();
      if (!address || typeof address === "string") {
        throw new Error("mock upstream address is invalid");
      }
      upstreamUrl = `http://127.0.0.1:${address.port}/v1`;

      started = await startWebServer({
        host: "127.0.0.1",
        port: 0,
        runtimeOverrides: {
          service: {
            provider: "openai-compatible",
            openaiCompatibleApiKey: "mock-key",
            openaiCompatibleBaseUrl: upstreamUrl,
            openaiCompatibleModel: "mock-model"
          }
        }
      });

      const response = await fetch(`${started.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello usage priority" }]
        })
      });
      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };
      expect(data.usage).toEqual({
        prompt_tokens: 901,
        completion_tokens: 99,
        total_tokens: 1000
      });
    } finally {
      if (upstream) {
        await new Promise<void>((resolve) => upstream!.close(() => resolve()));
      }
    }
  });

  test("can bypass MLEX native agent for OpenAI-compatible endpoint", async () => {
    let upstream: Server | undefined;
    const observedBodies: unknown[] = [];
    try {
      upstream = createServer(async (req, res) => {
        const targetPath = req.url?.split("?")[0] ?? "";
        if (req.method === "POST" && (targetPath === "/chat/completions" || targetPath === "/v1/chat/completions")) {
          const chunks: Buffer[] = [];
          req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          await new Promise<void>((resolve) => req.on("end", () => resolve()));
          const raw = Buffer.concat(chunks).toString("utf8");
          observedBodies.push(JSON.parse(raw) as unknown);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify({
              id: "upstream-direct-1",
              model: "upstream-direct-model",
              usage: {
                prompt_tokens: 17,
                completion_tokens: 3,
                total_tokens: 20
              },
              choices: [
                {
                  message: {
                    content: "upstream direct response"
                  },
                  finish_reason: "stop"
                }
              ]
            })
          );
          return;
        }
        res.statusCode = 404;
        res.end("not found");
      });
      await new Promise<void>((resolve, reject) => {
        upstream!.once("error", reject);
        upstream!.listen(0, "127.0.0.1", () => resolve());
      });
      const address = upstream.address();
      if (!address || typeof address === "string") {
        throw new Error("mock upstream address is invalid");
      }
      const upstreamUrl = `http://127.0.0.1:${address.port}/v1`;

      started = await startWebServer({
        host: "127.0.0.1",
        port: 0,
        runtimeOverrides: {
          service: {
            provider: "openai-compatible",
            openaiCompatibleApiKey: "mock-key",
            openaiCompatibleBaseUrl: upstreamUrl,
            openaiCompatibleModel: "mock-model"
          },
          component: {
            openaiCompatBypassAgent: true
          }
        }
      });

      const response = await fetch(`${started.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: "openclaw-bypass-s1",
          messages: [
            { role: "system", content: "system rules from OpenClaw" },
            { role: "user", content: "user asks for direct mode" }
          ]
        })
      });
      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };
      expect(data.choices?.[0]?.message?.content).toBe("upstream direct response");
      expect(data.usage).toEqual({
        prompt_tokens: 17,
        completion_tokens: 3,
        total_tokens: 20
      });

      expect(observedBodies).toHaveLength(1);
      const upstreamBody = observedBodies[0] as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      expect(Array.isArray(upstreamBody.messages)).toBe(true);
      expect(upstreamBody.messages?.[0]).toEqual({
        role: "system",
        content: "system rules from OpenClaw"
      });
      expect(upstreamBody.messages?.[1]).toEqual({
        role: "user",
        content: "user asks for direct mode"
      });
    } finally {
      if (upstream) {
        await new Promise<void>((resolve) => upstream!.close(() => resolve()));
      }
    }
  });

  test("auto-bypasses MLEX native agent for OpenClaw bridge payload", async () => {
    let upstream: Server | undefined;
    const observedBodies: unknown[] = [];
    try {
      upstream = createServer(async (req, res) => {
        const targetPath = req.url?.split("?")[0] ?? "";
        if (req.method === "POST" && (targetPath === "/chat/completions" || targetPath === "/v1/chat/completions")) {
          const chunks: Buffer[] = [];
          req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          await new Promise<void>((resolve) => req.on("end", () => resolve()));
          const raw = Buffer.concat(chunks).toString("utf8");
          observedBodies.push(JSON.parse(raw) as unknown);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify({
              id: "upstream-bridge-1",
              model: "upstream-bridge-model",
              usage: {
                prompt_tokens: 13,
                completion_tokens: 2,
                total_tokens: 15
              },
              choices: [
                {
                  message: {
                    content: "bridge direct response"
                  },
                  finish_reason: "stop"
                }
              ]
            })
          );
          return;
        }
        res.statusCode = 404;
        res.end("not found");
      });
      await new Promise<void>((resolve, reject) => {
        upstream!.once("error", reject);
        upstream!.listen(0, "127.0.0.1", () => resolve());
      });
      const address = upstream.address();
      if (!address || typeof address === "string") {
        throw new Error("mock upstream address is invalid");
      }
      const upstreamUrl = `http://127.0.0.1:${address.port}/v1`;

      started = await startWebServer({
        host: "127.0.0.1",
        port: 0,
        runtimeOverrides: {
          service: {
            provider: "openai-compatible",
            openaiCompatibleApiKey: "mock-key",
            openaiCompatibleBaseUrl: upstreamUrl,
            openaiCompatibleModel: "mock-model"
          },
          component: {
            openaiCompatBypassAgent: false
          }
        }
      });

      const response = await fetch(`${started.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openclaw: {
            sidecar: {
              session_id: "openclaw-auto-bypass-s1",
              messages: [{ role: "user", content: "route me as bridge" }]
            }
          }
        })
      });
      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      expect(data.choices?.[0]?.message?.content).toBe("bridge direct response");
      expect(observedBodies).toHaveLength(1);
      const upstreamBody = observedBodies[0] as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      expect(upstreamBody.messages?.[0]).toEqual({
        role: "user",
        content: "route me as bridge"
      });
    } finally {
      if (upstream) {
        await new Promise<void>((resolve) => upstream!.close(() => resolve()));
      }
    }
  });

  test("bridge passthrough preserves tool_calls payload without requiring user message", async () => {
    let upstream: Server | undefined;
    const observedBodies: unknown[] = [];
    try {
      upstream = createServer(async (req, res) => {
        const targetPath = req.url?.split("?")[0] ?? "";
        if (req.method === "POST" && (targetPath === "/chat/completions" || targetPath === "/v1/chat/completions")) {
          const chunks: Buffer[] = [];
          req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          await new Promise<void>((resolve) => req.on("end", () => resolve()));
          observedBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify({
              id: "upstream-tool-loop-1",
              model: "upstream-model",
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "tool loop passthrough ok"
                  },
                  finish_reason: "stop"
                }
              ]
            })
          );
          return;
        }
        res.statusCode = 404;
        res.end("not found");
      });
      await new Promise<void>((resolve, reject) => {
        upstream!.once("error", reject);
        upstream!.listen(0, "127.0.0.1", () => resolve());
      });
      const address = upstream.address();
      if (!address || typeof address === "string") {
        throw new Error("mock upstream address is invalid");
      }
      const upstreamUrl = `http://127.0.0.1:${address.port}/v1`;

      started = await startWebServer({
        host: "127.0.0.1",
        port: 0,
        runtimeOverrides: {
          service: {
            provider: "openai-compatible",
            openaiCompatibleApiKey: "mock-key",
            openaiCompatibleBaseUrl: upstreamUrl,
            openaiCompatibleModel: "mock-model"
          },
          component: {
            openaiCompatBypassAgent: false
          }
        }
      });

      const response = await fetch(`${started.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openclaw: {
            sidecar: {
              session_id: "openclaw-tool-loop-s1"
            }
          },
          messages: [
            {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "readonly.read",
                    arguments: "{\"path\":\"README.md\"}"
                  }
                }
              ]
            }
          ]
        })
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("x-mlex-session-id")).toBe("openclaw-tool-loop-s1");
      expect(response.headers.get("x-mlex-context-length")).toBe("0");
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      expect(data.choices?.[0]?.message?.content).toBe("tool loop passthrough ok");

      expect(observedBodies).toHaveLength(1);
      const upstreamBody = observedBodies[0] as {
        messages?: Array<{ tool_calls?: unknown[] }>;
      };
      expect(Array.isArray(upstreamBody.messages)).toBe(true);
      expect(Array.isArray(upstreamBody.messages?.[0]?.tool_calls)).toBe(true);
    } finally {
      if (upstream) {
        await new Promise<void>((resolve) => upstream!.close(() => resolve()));
      }
    }
  });

  test("bridge file query projects relations without storing tool events in memory", async () => {
    let upstream: Server | undefined;
    try {
      upstream = createServer(async (req, res) => {
        const targetPath = req.url?.split("?")[0] ?? "";
        if (req.method === "POST" && (targetPath === "/chat/completions" || targetPath === "/v1/chat/completions")) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify({
              id: "upstream-relation-1",
              model: "upstream-model",
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "relation projection ok"
                  },
                  finish_reason: "stop"
                }
              ]
            })
          );
          return;
        }
        res.statusCode = 404;
        res.end("not found");
      });
      await new Promise<void>((resolve, reject) => {
        upstream!.once("error", reject);
        upstream!.listen(0, "127.0.0.1", () => resolve());
      });
      const address = upstream.address();
      if (!address || typeof address === "string") {
        throw new Error("mock upstream address is invalid");
      }
      const upstreamUrl = `http://127.0.0.1:${address.port}/v1`;

      started = await startWebServer({
        host: "127.0.0.1",
        port: 0,
        runtimeOverrides: {
          service: {
            provider: "openai-compatible",
            openaiCompatibleApiKey: "mock-key",
            openaiCompatibleBaseUrl: upstreamUrl,
            openaiCompatibleModel: "mock-model"
          },
          component: {
            webDebugApiEnabled: true
          }
        }
      });

      const completionResponse = await fetch(`${started.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openclaw: {
            sidecar: {
              session_id: "openclaw-rel-s1"
            }
          },
          messages: [
            {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_file_1",
                  type: "function",
                  function: {
                    name: "readonly.read",
                    arguments: "{\"path\":\"README.md\"}"
                  }
                }
              ]
            }
          ]
        })
      });
      expect(completionResponse.status).toBe(200);

      const debugResponse = await fetch(
        `${started.url}/api/debug/database?sessionId=openclaw-rel-s1`
      );
      expect(debugResponse.status).toBe(200);
      const debugData = (await debugResponse.json()) as {
        counts?: { rawEvents?: number; relations?: number };
        relations?: Array<{ type?: string; src?: string; dst?: string }>;
      };
      expect(debugData.counts?.rawEvents ?? 0).toBe(0);
      expect((debugData.counts?.relations ?? 0)).toBeGreaterThan(0);
      expect(
        debugData.relations?.some(
          (relation) =>
            relation.type === "SNAPSHOT_OF_FILE" &&
            String(relation.src ?? "").startsWith("snapshot:") &&
            String(relation.dst ?? "").startsWith("file:")
        )
      ).toBe(true);

      const defaultSessionDebugResponse = await fetch(`${started.url}/api/debug/database`);
      expect(defaultSessionDebugResponse.status).toBe(200);
      const defaultSessionData = (await defaultSessionDebugResponse.json()) as {
        relations?: Array<{ type?: string; src?: string; dst?: string }>;
      };
      expect(
        defaultSessionData.relations?.some(
          (relation) =>
            relation.type === "SNAPSHOT_OF_FILE" &&
            String(relation.src ?? "").startsWith("snapshot:") &&
            String(relation.dst ?? "").startsWith("file:")
        ) ?? false
      ).toBe(false);
    } finally {
      if (upstream) {
        await new Promise<void>((resolve) => upstream!.close(() => resolve()));
      }
    }
  });

  test("supports OpenAI-compatible chat completion stream", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0
    });

    const response = await fetch(`${started.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mlex-stream-model",
        stream: true,
        stream_options: {
          include_usage: true
        },
        metadata: {
          session_id: "openclaw-meta-s1",
          request_id: "openclaw-meta-r1"
        },
        messages: [{ role: "user", content: "请输出一个流式回复" }]
      })
    });
    expect(response.status).toBe(200);
    const contentType = response.headers.get("content-type") ?? "";
    expect(contentType.includes("text/event-stream")).toBe(true);
    expect(response.headers.get("x-mlex-session-id")).toBe("openclaw-meta-s1");
    expect(response.headers.get("x-mlex-request-id")).toBe("openclaw-meta-r1");
    const contextLength = Number.parseInt(response.headers.get("x-mlex-context-length") ?? "0", 10);
    const contextTokens = Number.parseInt(response.headers.get("x-mlex-context-tokens") ?? "0", 10);
    const contextChars = Number.parseInt(response.headers.get("x-mlex-context-chars") ?? "0", 10);
    expect(contextLength).toBeGreaterThan(0);
    expect(contextTokens).toBeGreaterThan(0);
    expect(contextChars).toBeGreaterThan(0);
    expect(contextLength).toBe(contextTokens);
    const text = await response.text();
    expect(text).toContain("\"object\":\"chat.completion.chunk\"");
    expect(text).toContain("\"delta\":{\"role\":\"assistant\"}");
    expect(text).toContain("\"finish_reason\":\"stop\"");
    expect(text).toContain("\"choices\":[]");
    expect(text).toContain("\"usage\":{\"prompt_tokens\":");
    expect(text).toContain("data: [DONE]");
  });

  test("accepts OpenClaw-compatible prompt fallback without messages", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0
    });

    const response = await fetch(`${started.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mlex-test-model",
        user: "openclaw-user-session",
        prompt: "请用一句话说明你是谁"
      })
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      object?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };
    expect(data.object).toBe("chat.completion");
    expect(typeof data.choices?.[0]?.message?.content).toBe("string");
    expect((data.choices?.[0]?.message?.content ?? "").length).toBeGreaterThan(0);
    expect((data.usage?.total_tokens ?? 0)).toBeGreaterThan(0);
    expect(response.headers.get("x-mlex-session-id")).toBe("openclaw-user-session");
  });

  test("accepts OpenClaw-compatible input array fallback", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0
    });

    const response = await fetch(`${started.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mlex-test-model",
        metadata: {
          sessionId: "openclaw-input-s1"
        },
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: "请回复：兼容 input 数组成功" }]
          }
        ]
      })
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      object?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    expect(data.object).toBe("chat.completion");
    expect(typeof data.choices?.[0]?.message?.content).toBe("string");
    expect((data.choices?.[0]?.message?.content ?? "").length).toBeGreaterThan(0);
    expect(response.headers.get("x-mlex-session-id")).toBe("openclaw-input-s1");
  });

  test("accepts OpenClaw sidecar/sidebag fallback payload", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0
    });

    const response = await fetch(`${started.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        openclaw: {
          sidecar: {
            session_id: "openclaw-sidecar-s1",
            request_id: "openclaw-sidecar-r1",
            input: [
              {
                role: "user",
                content: [{ type: "input_text", text: "请回复：侧袋适配成功" }]
              }
            ]
          }
        }
      })
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      object?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    expect(data.object).toBe("chat.completion");
    expect(typeof data.choices?.[0]?.message?.content).toBe("string");
    expect((data.choices?.[0]?.message?.content ?? "").length).toBeGreaterThan(0);
    expect(response.headers.get("x-mlex-session-id")).toBe("openclaw-sidecar-s1");
    expect(response.headers.get("x-mlex-request-id")).toBe("openclaw-sidecar-r1");
  });

  test("rejects OpenAI-compatible completion requests without usable user text", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0
    });

    const response = await fetch(`${started.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mlex-test-model",
        messages: [{ role: "system", content: "only system" }]
      })
    });
    expect(response.status).toBe(400);
    const data = (await response.json()) as {
      error?: { message?: string; type?: string };
    };
    expect(data.error?.type).toBe("invalid_request_error");
    expect(typeof data.error?.message).toBe("string");
    expect((data.error?.message ?? "").length).toBeGreaterThan(0);
  });

  test("handles chat request", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      runtimeOverrides: {
        component: {
          webExposeRawContext: true
        }
      }
    });

    const response = await fetch(`${started.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "你好", sessionId: "web-test-s1", requestId: "req-chat-1" })
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      requestId?: string;
      sessionId?: string;
      reply?: string;
      proactiveReply?: string | null;
      context?: string;
      blocks?: unknown[];
      prediction?: unknown;
      rawContext?: unknown;
      latestReadFilePath?: string | null;
    };
    expect(data.requestId).toBe("req-chat-1");
    expect(data.sessionId).toBe("web-test-s1");
    expect(typeof data.reply).toBe("string");
    expect((data.reply ?? "").length).toBeGreaterThan(0);
    expect(typeof data.context).toBe("string");
    expect(data.proactiveReply === null || typeof data.proactiveReply === "string").toBe(true);
    expect(Array.isArray(data.blocks)).toBe(true);
    expect(data.prediction === undefined || typeof data.prediction === "object").toBe(true);
    expect(typeof data.rawContext).toBe("object");
    expect(data.latestReadFilePath === null || typeof data.latestReadFilePath === "string").toBe(true);
  });

  test("streams sse events with done payload", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      runtimeOverrides: {
        component: {
          webExposeRawContext: true
        }
      }
    });

    const response = await fetch(`${started.url}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "请输出 stream 测试",
        sessionId: "web-test-sse",
        requestId: "req-stream-1"
      })
    });
    expect(response.status).toBe(200);
    const contentType = response.headers.get("content-type") ?? "";
    expect(contentType.includes("text/event-stream")).toBe(true);
    const text = await response.text();
    expect(text).toContain("event: done");
    expect(text).toContain("\"requestId\":\"req-stream-1\"");
    expect(text).toContain("\"sessionId\":\"web-test-sse\"");
    expect(text).toContain("\"context\"");
    expect(text).toContain("\"prediction\"");
    expect(text).toContain("\"rawContext\"");
    expect(text).toContain("\"latestReadFilePath\"");
  });

  test("opens proactive sse stream and emits ready event", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0
    });

    const controller = new AbortController();
    const response = await fetch(`${started.url}/api/proactive/stream?sessionId=web-proactive-s1`, {
      signal: controller.signal
    });
    expect(response.status).toBe(200);
    const contentType = response.headers.get("content-type") ?? "";
    expect(contentType.includes("text/event-stream")).toBe(true);
    expect(response.body).toBeTruthy();

    const reader = response.body!.getReader();
    const chunk = await reader.read();
    controller.abort();

    const decoded = new TextDecoder("utf-8").decode(chunk.value ?? new Uint8Array());
    expect(decoded).toContain("event: ready");
    expect(decoded).toContain("\"sessionId\":\"web-proactive-s1\"");
  });

  test("isolates debug lastContext by session", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      runtimeOverrides: {
        component: {
          webDebugApiEnabled: true
        }
      }
    });

    const chatA = await fetch(`${started.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "sessionA: first", sessionId: "session-A", requestId: "req-a-1" })
    });
    expect(chatA.status).toBe(200);

    const chatB = await fetch(`${started.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "sessionB: first", sessionId: "session-B", requestId: "req-b-1" })
    });
    expect(chatB.status).toBe(200);

    const debugA = await fetch(`${started.url}/api/debug/database?sessionId=session-A`);
    expect(debugA.status).toBe(200);
    const debugAData = (await debugA.json()) as {
      sessionId?: string;
      lastContext?: { query?: string } | null;
    };
    expect(debugAData.sessionId).toBe("session-A");
    expect(debugAData.lastContext?.query).toBe("sessionA: first");

    const debugB = await fetch(`${started.url}/api/debug/database?sessionId=session-B`);
    expect(debugB.status).toBe(200);
    const debugBData = (await debugB.json()) as {
      sessionId?: string;
      lastContext?: { query?: string } | null;
    };
    expect(debugBData.sessionId).toBe("session-B");
    expect(debugBData.lastContext?.query).toBe("sessionB: first");
  });

  test("keeps private blocks per session and exposes shared blocks across sessions", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      runtimeOverrides: {
        component: {
          webDebugApiEnabled: true
        }
      }
    });

    const chatA = await fetch(`${started.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "shared/private test: session A", sessionId: "scope-A" })
    });
    expect(chatA.status).toBe(200);
    const sealA = await fetch(`${started.url}/api/seal?sessionId=scope-A`, { method: "POST" });
    expect(sealA.status).toBe(200);

    const chatB = await fetch(`${started.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "shared/private test: session B", sessionId: "scope-B" })
    });
    expect(chatB.status).toBe(200);
    const sealB = await fetch(`${started.url}/api/seal?sessionId=scope-B`, { method: "POST" });
    expect(sealB.status).toBe(200);

    const debugA = await fetch(`${started.url}/api/debug/database?sessionId=scope-A`);
    const debugB = await fetch(`${started.url}/api/debug/database?sessionId=scope-B`);
    expect(debugA.status).toBe(200);
    expect(debugB.status).toBe(200);

    const debugAData = (await debugA.json()) as {
      counts?: { blocks?: number };
      shared?: { counts?: { blocks?: number } };
    };
    const debugBData = (await debugB.json()) as {
      counts?: { blocks?: number };
      shared?: { counts?: { blocks?: number } };
    };

    expect((debugAData.counts?.blocks ?? 0)).toBeGreaterThan(0);
    expect((debugBData.counts?.blocks ?? 0)).toBeGreaterThan(0);
    expect((debugAData.shared?.counts?.blocks ?? 0)).toBeGreaterThan(0);
    expect(debugAData.shared?.counts?.blocks).toBe(debugBData.shared?.counts?.blocks);
  });

  test("returns latestReadFilePath even when rawContext is disabled", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      runtimeOverrides: {
        component: {
          webExposeRawContext: false
        }
      }
    });

    const response = await fetch(`${started.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "请告诉我当前上下文" })
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      rawContext?: unknown;
      latestReadFilePath?: string | null;
    };
    expect(data.rawContext).toBeUndefined();
    expect(data.latestReadFilePath === null || typeof data.latestReadFilePath === "string").toBe(true);
  });

  test("exposes debug database snapshot and block detail", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      runtimeOverrides: {
        component: {
          webDebugApiEnabled: true
        }
      }
    });

    await fetch(`${started.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "任务A：先做需求分析。" })
    });
    await fetch(`${started.url}/api/seal`, { method: "POST" });
    await fetch(`${started.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "任务B：继续设计与实现。" })
    });
    await fetch(`${started.url}/api/seal`, { method: "POST" });

    const debugResponse = await fetch(`${started.url}/api/debug/database`);
    expect(debugResponse.status).toBe(200);
    const debugData = (await debugResponse.json()) as {
      counts?: { blocks?: number; traces?: number };
      blocks?: Array<{ id?: string; order?: number; startTime?: number }>;
      relations?: Array<{ order?: number; timestamp?: number }>;
      proactive?: {
        latest?: { reason?: string } | null;
        recent?: unknown[];
        nonTriggerReasons?: unknown[];
      };
      storage?: Record<string, unknown>;
    };
    expect(typeof debugData.storage).toBe("object");
    expect(typeof debugData.proactive).toBe("object");
    expect(Array.isArray(debugData.proactive?.recent)).toBe(true);
    expect(Array.isArray(debugData.proactive?.nonTriggerReasons)).toBe(true);
    if (debugData.proactive?.latest) {
      expect(typeof debugData.proactive.latest.reason).toBe("string");
    }
    expect((debugData.counts?.blocks ?? 0)).toBeGreaterThan(0);
    expect(Array.isArray(debugData.blocks)).toBe(true);
    expect((debugData.blocks?.[0]?.order ?? 0)).toBeGreaterThan(0);
    if ((debugData.blocks?.length ?? 0) >= 2) {
      const firstStart = debugData.blocks?.[0]?.startTime ?? 0;
      const lastStart = debugData.blocks?.[debugData.blocks.length - 1]?.startTime ?? 0;
      expect(firstStart).toBeLessThanOrEqual(lastStart);
    }
    if ((debugData.relations?.length ?? 0) >= 2) {
      const firstTs = debugData.relations?.[0]?.timestamp ?? 0;
      const lastTs = debugData.relations?.[debugData.relations.length - 1]?.timestamp ?? 0;
      expect(firstTs).toBeLessThanOrEqual(lastTs);
    }

    const firstBlockId = debugData.blocks?.[0]?.id;
    expect(typeof firstBlockId).toBe("string");

    const detailResponse = await fetch(
      `${started.url}/api/debug/block?id=${encodeURIComponent(firstBlockId as string)}`
    );
    expect(detailResponse.status).toBe(200);
    const detailData = (await detailResponse.json()) as {
      id?: string;
      block?: Record<string, unknown>;
    };
    expect(detailData.id).toBe(firstBlockId);
    expect(typeof detailData.block).toBe("object");

    const tracesResponse = await fetch(`${started.url}/api/debug/traces?limit=50`);
    expect(tracesResponse.status).toBe(200);
    const tracesData = (await tracesResponse.json()) as {
      total?: number;
      entries?: Array<{ category?: string; event?: string }>;
    };
    expect(typeof tracesData.total).toBe("number");
    expect(Array.isArray(tracesData.entries)).toBe(true);
    expect((tracesData.entries?.length ?? 0)).toBeGreaterThan(0);

    const clearResponse = await fetch(`${started.url}/api/debug/traces/clear`, {
      method: "POST"
    });
    expect(clearResponse.status).toBe(200);

    const tracesAfterClearResponse = await fetch(`${started.url}/api/debug/traces?limit=50`);
    expect(tracesAfterClearResponse.status).toBe(200);
    const tracesAfterClear = (await tracesAfterClearResponse.json()) as {
      total?: number;
      entries?: unknown[];
    };
    expect(tracesAfterClear.total).toBe(0);
    expect((tracesAfterClear.entries?.length ?? 0)).toBe(0);
  });

  test("supports readonly file list/read endpoints", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      runtimeOverrides: {
        component: {
          webFileApiEnabled: true
        }
      }
    });

    const listResponse = await fetch(`${started.url}/api/files/list?path=.`);
    expect(listResponse.status).toBe(200);
    const listData = (await listResponse.json()) as {
      entries?: Array<{ path?: string; type?: string }>;
    };
    expect(Array.isArray(listData.entries)).toBe(true);
    expect((listData.entries?.length ?? 0)).toBeGreaterThan(0);

    const readResponse = await fetch(`${started.url}/api/files/read?path=README.md&maxBytes=128`);
    expect(readResponse.status).toBe(200);
    const readData = (await readResponse.json()) as {
      text?: string;
      truncated?: boolean;
      totalBytes?: number;
      bytes?: number;
    };
    expect(typeof readData.text).toBe("string");
    expect((readData.text ?? "").length).toBeGreaterThan(0);
    expect(typeof readData.truncated).toBe("boolean");
    expect(typeof readData.totalBytes).toBe("number");
    expect(typeof readData.bytes).toBe("number");

    const readAllResponse = await fetch(`${started.url}/api/files/read?path=README.md`);
    expect(readAllResponse.status).toBe(200);
    const readAllData = (await readAllResponse.json()) as {
      truncated?: boolean;
      totalBytes?: number;
      bytes?: number;
    };
    expect(readAllData.truncated).toBe(false);
    expect(readAllData.totalBytes).toBe(readAllData.bytes);

    const traversalResponse = await fetch(`${started.url}/api/files/read?path=../oops.txt`);
    expect(traversalResponse.status).toBe(400);
  });

  test("blocks debug and readonly-file APIs by default", async () => {
    started = await startWebServer({ host: "127.0.0.1", port: 0 });

    const debugResponse = await fetch(`${started.url}/api/debug/database`);
    expect(debugResponse.status).toBe(404);

    const listResponse = await fetch(`${started.url}/api/files/list?path=.`);
    expect(listResponse.status).toBe(404);
  });

  test("protects debug APIs with admin token when configured", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      runtimeOverrides: {
        component: {
          webDebugApiEnabled: true,
          webAdminToken: "test-token"
        }
      }
    });

    const denied = await fetch(`${started.url}/api/debug/database`);
    expect(denied.status).toBe(401);

    const allowed = await fetch(`${started.url}/api/debug/database`, {
      headers: {
        "x-mlex-admin-token": "test-token"
      }
    });
    expect(allowed.status).toBe(200);
  });

  test("supports interrupted-resume prompt on next request in same session", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0
    });

    const interruptedContext = {
      sessionId: "web-resume-s1",
      originalQuestion: "请解释一下关系预测为什么会触发",
      partialText: "先看第一点。再看第二点。第三点是权衡。第四点是扩展。",
      at: Date.now()
    };

    const resumedMessage = [
      "你正在继续一次被打断的对话。",
      "[打断前用户问题]",
      interruptedContext.originalQuestion,
      "",
      "[已输出但被打断的前文（节选）]",
      "先看第一点。 再看第二点。 第三点是权衡。",
      "",
      "[用户打断后新输入]",
      "请继续并给一个最小例子",
      "",
      "请遵循：优先延续原回答；若新输入要求转向，先衔接一句再转答；避免重复已输出内容。"
    ].join("\n");

    const response = await fetch(`${started.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: resumedMessage,
        sessionId: interruptedContext.sessionId,
        requestId: "req-resume-1"
      })
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      requestId?: string;
      sessionId?: string;
      reply?: string;
      context?: string;
    };
    expect(data.requestId).toBe("req-resume-1");
    expect(data.sessionId).toBe("web-resume-s1");
    expect(typeof data.reply).toBe("string");
    expect((data.reply ?? "").length).toBeGreaterThan(0);
    expect(typeof data.context).toBe("string");
  });

  test("stream endpoint remains healthy after client abort", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0
    });

    const controller = new AbortController();
    const streamPromise = fetch(`${started.url}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "请开始一个较长回答",
        sessionId: "abort-session-1",
        requestId: "req-abort-1"
      }),
      signal: controller.signal
    });
    controller.abort();
    await expect(streamPromise).rejects.toHaveProperty("name", "AbortError");

    const afterAbort = await fetch(`${started.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "中断后继续",
        sessionId: "abort-session-1",
        requestId: "req-abort-2"
      })
    });
    expect(afterAbort.status).toBe(200);
    const data = (await afterAbort.json()) as { requestId?: string; sessionId?: string };
    expect(data.requestId).toBe("req-abort-2");
    expect(data.sessionId).toBe("abort-session-1");
  });

  test("defaults sessionId and requestId when omitted", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0
    });

    const response = await fetch(`${started.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "no ids provided" })
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as { requestId?: string; sessionId?: string };
    expect(typeof data.requestId).toBe("string");
    expect((data.requestId ?? "").length).toBeGreaterThan(0);
    expect(data.sessionId).toBe("default");
  });

  test("rejects oversized chat payloads", async () => {
    started = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      runtimeOverrides: {
        component: {
          webRequestBodyMaxBytes: 80
        }
      }
    });

    const largeBody = JSON.stringify({ message: "x".repeat(5000) });
    const response = await fetch(`${started.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: largeBody
    });
    expect(response.status).toBe(413);
  });
});
