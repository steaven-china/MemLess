import { describe, expect, test, vi } from "vitest";

import type { Agent } from "../src/agent/Agent.js";
import { ProactiveTimerScheduler } from "../src/proactive/ProactiveTimerScheduler.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ProactiveTimerScheduler", () => {
  test("forwards timer proactive message to callback", async () => {
    const onWakeup = vi.fn();
    const scheduler = new ProactiveTimerScheduler({
      agent: {
        async tickProactiveWakeup(): Promise<string> {
          return "timer proactive";
        }
      } as unknown as Agent,
      enabled: true,
      intervalSeconds: 60,
      onWakeup
    });

    scheduler.start();
    await sleep(20);
    await scheduler.stop();

    expect(onWakeup).toHaveBeenCalledWith("timer proactive");
  });

  test("captures callback error via onError", async () => {
    const onError = vi.fn();
    const scheduler = new ProactiveTimerScheduler({
      agent: {
        async tickProactiveWakeup(): Promise<string> {
          return "timer proactive";
        }
      } as unknown as Agent,
      enabled: true,
      intervalSeconds: 60,
      onWakeup: async () => {
        throw new Error("sink failure");
      },
      onError
    });

    scheduler.start();
    await sleep(20);
    await scheduler.stop();

    expect(onError).toHaveBeenCalledTimes(1);
  });
});
