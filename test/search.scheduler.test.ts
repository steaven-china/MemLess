import { describe, expect, test, vi } from "vitest";

import type { IMemoryManager } from "../src/memory/IMemoryManager.js";
import type { BlockRef, Context, MemoryEvent } from "../src/types.js";
import { SearchIngestScheduler } from "../src/search/SearchIngestScheduler.js";
import type { ISearchProvider, SearchQuery, SearchResponse } from "../src/search/ISearchProvider.js";

class FakeMemoryManager implements IMemoryManager {
  public events: MemoryEvent[] = [];
  public sealed = 0;

  async addEvent(event: MemoryEvent): Promise<void> {
    this.events.push(event);
  }

  async sealCurrentBlock(): Promise<void> {
    this.sealed += 1;
  }

  createNewBlock(): void {}

  async retrieveBlocks(_query: string): Promise<BlockRef[]> {
    return [];
  }

  async getContext(_query: string): Promise<Context> {
    return {
      blocks: [],
      recentEvents: [],
      formatted: ""
    };
  }

  async tickProactiveWakeup(): Promise<void> {}
}

class MockSearchProvider implements ISearchProvider {
  public calls: SearchQuery[] = [];

  constructor(private readonly run: (input: SearchQuery) => Promise<SearchResponse>) {}

  async search(input: SearchQuery): Promise<SearchResponse> {
    this.calls.push(input);
    return this.run(input);
  }
}

describe("SearchIngestScheduler", () => {
  test("continues after provider error and seals block", async () => {
    const memoryManager = new FakeMemoryManager();
    const traces: Array<{ event: string; payload: unknown }> = [];
    const provider = new MockSearchProvider(async (input) => {
      if (input.query === "broken") {
        throw new Error("network down");
      }
      return {
        status: "ok",
        records: [
          {
            title: "ok",
            url: "https://example.com",
            snippet: "result",
            rank: 1,
            fetchedAt: Date.now()
          }
        ]
      };
    });

    const scheduler = new SearchIngestScheduler({
      memoryManager,
      searchProvider: provider,
      enabled: true,
      intervalMinutes: 60,
      seeds: ["broken", "healthy"],
      topK: 3,
      trace: (event, payload) => traces.push({ event, payload })
    });

    const setIntervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(() => ({
      ref() {
        return this;
      },
      unref() {
        return this;
      }
    }) as unknown as NodeJS.Timeout);

    try {
      scheduler.start();
      await vi.waitFor(() => {
        expect(memoryManager.sealed).toBe(1);
      });
    } finally {
      await scheduler.stop();
      setIntervalSpy.mockRestore();
    }

    expect(provider.calls.map((item) => item.query)).toEqual(["broken", "healthy"]);
    expect(memoryManager.events).toHaveLength(1);
    expect(memoryManager.events[0]?.text).toContain("scheduled search: healthy");
    expect(traces.some((item) => item.event === "seed.error")).toBe(true);
    expect(traces.some((item) => item.event === "tick.done")).toBe(true);
  });

  test("stop cancels interval timer", async () => {
    const memoryManager = new FakeMemoryManager();
    const provider = new MockSearchProvider(async () => ({
      status: "ok_empty",
      records: []
    }));

    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const fakeTimer = {
      ref() {
        return this;
      },
      unref() {
        return this;
      }
    } as unknown as NodeJS.Timeout;
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(() => fakeTimer);

    const scheduler = new SearchIngestScheduler({
      memoryManager,
      searchProvider: provider,
      enabled: true,
      intervalMinutes: 10,
      seeds: ["noop"],
      topK: 1
    });

    try {
      scheduler.start();
      await scheduler.stop();
    } finally {
      setIntervalSpy.mockRestore();
    }

    expect(clearIntervalSpy).toHaveBeenCalledWith(fakeTimer);
    clearIntervalSpy.mockRestore();
  });
});
