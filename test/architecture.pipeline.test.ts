import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, test } from "vitest";

import { createRuntime } from "../src/container.js";
import type { Context } from "../src/types.js";
import { createId } from "../src/utils/id.js";

describe("Architecture pipeline", () => {
  test("applies retention policy and backtracks compressed raw events", async () => {
    const runtime = createRuntime({
      manager: {
        compressionHighMatchThreshold: 0.2,
        compressionLowMatchThreshold: 0.05,
        predictionEnabled: true,
        predictionActiveThreshold: 0.1
      },
      component: {
        chunkStrategy: "fixed"
      }
    });

    const now = Date.now();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "支付重试导致重复下单，修复幂等键策略并清理旧任务。",
      timestamp: now
    });
    await runtime.memoryManager.sealCurrentBlock();

    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "assistant",
      text: "支付重试导致重复下单，需要继续检查幂等键策略与重试队列。",
      timestamp: now + 10
    });
    await runtime.memoryManager.sealCurrentBlock();
    await runtime.memoryManager.flushAsyncRelations();

    const blockStore = runtime.container.resolve<{
      list: () => Promise<
        Array<{
          id: string;
          retentionMode: string;
          rawEvents: Array<{ text: string }>;
        }>
      >;
    }>("blockStore");
    const blocks = await blockStore.list();
    const compressed = blocks.find((block) => block.retentionMode === "compressed");
    expect(compressed).toBeDefined();
    expect(compressed?.rawEvents.length ?? 0).toBe(0);

    const context = (await runtime.memoryManager.getContext("幂等键重试策略")) as Context;
    const hydrated = context.blocks.find((block) => block.id === compressed?.id);
    expect((hydrated?.rawEvents?.length ?? 0)).toBeGreaterThan(0);
    expect(context.prediction).toBeDefined();
  });

  test("persists blocks/raw-events/relations with file backends across restarts", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-arch-"));
    const lanceDbDir = join(folder, "lancedb");
    const rawFile = join(folder, "raw-events.json");
    const relationFile = join(folder, "relations.json");

    const runtime1 = createRuntime({
      component: {
        storageBackend: "lance",
        lanceDbPath: lanceDbDir,
        rawStoreBackend: "file",
        rawStoreFilePath: rawFile,
        relationStoreBackend: "file",
        relationStoreFilePath: relationFile
      },
      manager: {
        predictionEnabled: true
      }
    });

    const now = Date.now();
    await runtime1.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "任务A：先完成需求分析。",
      timestamp: now
    });
    await runtime1.memoryManager.sealCurrentBlock();
    await runtime1.memoryManager.addEvent({
      id: createId("event"),
      role: "assistant",
      text: "任务B：根据分析结果实施开发。",
      timestamp: now + 20
    });
    await runtime1.memoryManager.sealCurrentBlock();
    await runtime1.memoryManager.flushAsyncRelations();

    const runtime2 = createRuntime({
      component: {
        storageBackend: "lance",
        lanceDbPath: lanceDbDir,
        rawStoreBackend: "file",
        rawStoreFilePath: rawFile,
        relationStoreBackend: "file",
        relationStoreFilePath: relationFile
      },
      manager: {
        predictionEnabled: true
      }
    });

    const context = await runtime2.memoryManager.getContext("下一步是什么");
    expect(context.blocks.length).toBeGreaterThan(0);

    const relationPayload = JSON.parse(await fs.readFile(relationFile, "utf8")) as Array<{
      type?: string;
    }>;
    expect(relationPayload.some((relation) => relation.type === "FOLLOWS")).toBe(true);

    const rawPayload = JSON.parse(await fs.readFile(rawFile, "utf8")) as Record<string, unknown>;
    expect(Object.keys(rawPayload).length).toBeGreaterThan(0);
  }, { timeout: 30_000 });

  test("persists blocks/raw-events/relations with sqlite backends across restarts", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-arch-sqlite-"));
    const sqliteFile = join(folder, "memory.db");

    const runtime1 = createRuntime({
      component: {
        storageBackend: "sqlite",
        sqliteFilePath: sqliteFile,
        rawStoreBackend: "sqlite",
        relationStoreBackend: "sqlite"
      },
      manager: {
        predictionEnabled: true
      }
    });

    const now = Date.now();
    await runtime1.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "任务A：先完成需求分析。",
      timestamp: now
    });
    await runtime1.memoryManager.sealCurrentBlock();
    await runtime1.memoryManager.addEvent({
      id: createId("event"),
      role: "assistant",
      text: "任务B：根据分析结果实施开发。",
      timestamp: now + 20
    });
    await runtime1.memoryManager.sealCurrentBlock();
    await runtime1.memoryManager.flushAsyncRelations();

    const runtime2 = createRuntime({
      component: {
        storageBackend: "sqlite",
        sqliteFilePath: sqliteFile,
        rawStoreBackend: "sqlite",
        relationStoreBackend: "sqlite"
      },
      manager: {
        predictionEnabled: true
      }
    });

    const context = await runtime2.memoryManager.getContext("下一步是什么");
    expect(context.blocks.length).toBeGreaterThan(0);
    expect(context.blocks.some((block) => (block.tags ?? []).length > 0)).toBe(true);

    const db = new DatabaseSync(sqliteFile);
    const blockCount = (db.prepare("SELECT COUNT(*) AS count FROM blocks").get() as { count: number })
      .count;
    const rawCount = (
      db.prepare("SELECT COUNT(*) AS count FROM raw_events").get() as {
        count: number;
      }
    ).count;
    const followsCount = (
      db.prepare("SELECT COUNT(*) AS count FROM relations WHERE type = 'FOLLOWS'").get() as {
        count: number;
      }
    ).count;
    db.close();

    expect(blockCount).toBeGreaterThan(0);
    expect(rawCount).toBeGreaterThan(0);
    expect(followsCount).toBeGreaterThan(0);
  });
});
