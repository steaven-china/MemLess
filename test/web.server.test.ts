import { afterEach, describe, expect, test } from "vitest";

import { startWebServer, type StartedWebServer } from "../src/web/server.js";

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
      body: JSON.stringify({ message: "你好" })
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      reply?: string;
      proactiveReply?: string | null;
      context?: string;
      blocks?: unknown[];
      prediction?: unknown;
      rawContext?: unknown;
    };
    expect(typeof data.reply).toBe("string");
    expect((data.reply ?? "").length).toBeGreaterThan(0);
    expect(typeof data.context).toBe("string");
    expect(data.proactiveReply === null || typeof data.proactiveReply === "string").toBe(true);
    expect(Array.isArray(data.blocks)).toBe(true);
    expect(data.prediction === undefined || typeof data.prediction === "object").toBe(true);
    expect(typeof data.rawContext).toBe("object");
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
      body: JSON.stringify({ message: "请输出 stream 测试" })
    });
    expect(response.status).toBe(200);
    const contentType = response.headers.get("content-type") ?? "";
    expect(contentType.includes("text/event-stream")).toBe(true);
    const text = await response.text();
    expect(text).toContain("event: done");
    expect(text).toContain("\"context\"");
    expect(text).toContain("\"prediction\"");
    expect(text).toContain("\"rawContext\"");
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
      storage?: Record<string, unknown>;
    };
    expect(typeof debugData.storage).toBe("object");
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
