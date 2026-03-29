import { access } from "node:fs/promises";

import { afterEach, describe, expect, test } from "vitest";

import { createRuntime, type Runtime } from "../src/container.js";
import { createId } from "../src/utils/id.js";
import { createTestRunDir } from "./helpers/testRunDir.js";

describe("Generic 50% baseline", () => {
  let runtime: Runtime | undefined;

  afterEach(async () => {
    if (!runtime) return;
    await runtime.close();
    runtime = undefined;
  });

  test("keeps at least 50% context-hit ratio with isolated sqlite run dir", async () => {
    const { runDir, sqliteFile } = await createTestRunDir("baseline.generic");

    runtime = createRuntime({
      manager: {
        predictionEnabled: true
      },
      component: {
        chunkStrategy: "fixed",
        storageBackend: "sqlite",
        sqliteFilePath: sqliteFile,
        rawStoreBackend: "sqlite",
        relationStoreBackend: "sqlite"
      }
    });

    const now = Date.now();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "支付重试导致重复下单，需要修复幂等键策略并复核重试队列。",
      timestamp: now - 3000
    });
    await runtime.memoryManager.sealCurrentBlock();

    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "assistant",
      text: "后续需要补充对账告警，检查定时任务的重入保护。",
      timestamp: now - 1000
    });
    await runtime.memoryManager.sealCurrentBlock();

    const queries = ["幂等键怎么修", "对账告警是什么", "重试队列问题", "定时任务重入"];
    let hitCount = 0;

    for (const query of queries) {
      const context = await runtime.memoryManager.getContext(query);
      const topScore = context.blocks[0]?.score ?? 0;
      if (context.blocks.length > 0 && topScore > 0) {
        hitCount += 1;
      }
    }

    const hitRatio = hitCount / queries.length;
    expect(
      hitRatio,
      `runDir=${runDir}, hitCount=${hitCount}, total=${queries.length}, ratio=${hitRatio}`
    ).toBeGreaterThanOrEqual(0.5);

    const normalizedRunDir = runDir.replace(/\\/g, "/");
    expect(normalizedRunDir).toMatch(/\.mlex\/test\/baseline\.generic\/[0-9T-]+Z$/);
    await access(sqliteFile);
  });
});
