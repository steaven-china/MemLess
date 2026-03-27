import { describe, expect, test } from "vitest";

import type { IMemoryManager } from "../src/memory/IMemoryManager.js";
import { ProactiveActuator } from "../src/proactive/ProactiveActuator.js";
import type { ISearchProvider, SearchQuery, SearchRecord, SearchResponse } from "../src/search/ISearchProvider.js";
import type { IWebPageFetcher, WebPageFetchResult } from "../src/search/IWebPageFetcher.js";
import type { BlockRef, Context, MemoryEvent, ProactivePlan } from "../src/types.js";

class FakeMemoryManager implements IMemoryManager {
  public events: MemoryEvent[] = [];

  async addEvent(event: MemoryEvent): Promise<void> {
    this.events.push(event);
  }

  async getContext(_query: string): Promise<Context> {
    return {
      blocks: [],
      recentEvents: [],
      formatted: ""
    };
  }

  async sealCurrentBlock(): Promise<void> {}

  createNewBlock(): void {}

  async retrieveBlocks(): Promise<BlockRef[]> {
    return [];
  }

  async tickProactiveWakeup(): Promise<void> {}
}

class MockSearchProvider implements ISearchProvider {
  public calls: SearchQuery[] = [];

  constructor(private readonly records: SearchRecord[]) {}

  async search(input: SearchQuery): Promise<SearchResponse> {
    this.calls.push(input);
    return {
      records: this.records,
      status: this.records.length > 0 ? "ok" : "ok_empty"
    };
  }
}

class MockWebPageFetcher implements IWebPageFetcher {
  public calls: string[] = [];

  constructor(private readonly page: WebPageFetchResult) {}

  async fetch(url: string): Promise<WebPageFetchResult> {
    this.calls.push(url);
    return this.page;
  }
}

const basePlan: ProactivePlan = {
  action: "ask_followup",
  shouldSearchEvidence: false,
  searchQueries: [],
  messageSeed: "我建议先推进任务A。",
  reason: "inject_ready"
};

describe("ProactiveActuator", () => {
  test("returns undefined for noop plan", async () => {
    const memory = new FakeMemoryManager();
    const actuator = new ProactiveActuator({
      memoryManager: memory,
      searchTopK: 3
    });

    const text = await actuator.execute({ ...basePlan, action: "noop" });

    expect(text).toBeUndefined();
    expect(memory.events).toHaveLength(0);
  });

  test("records evidence events and proactive assistant message", async () => {
    const memory = new FakeMemoryManager();
    const search = new MockSearchProvider([
      {
        title: "Retry guide",
        url: "https://example.com/retry",
        snippet: "idempotency",
        rank: 1,
        fetchedAt: Date.now()
      }
    ]);
    const fetcher = new MockWebPageFetcher({
      url: "https://example.com/retry",
      title: "Retry guide",
      content: "content".repeat(600),
      fetchedAt: Date.now(),
      status: "ok"
    });
    const actuator = new ProactiveActuator({
      memoryManager: memory,
      searchProvider: search,
      webPageFetcher: fetcher,
      searchTopK: 2
    });

    const text = await actuator.execute({
      ...basePlan,
      shouldSearchEvidence: true,
      searchQueries: ["payment retry"]
    });

    expect(search.calls).toEqual([{ query: "payment retry", limit: 2 }]);
    expect(fetcher.calls).toEqual(["https://example.com/retry"]);
    expect(memory.events).toHaveLength(3);
    expect(memory.events[0]?.metadata?.tool).toBe("web.search.record");
    expect(memory.events[1]?.metadata?.tool).toBe("web.fetch.record");
    expect(memory.events[2]?.metadata?.proactive).toBe(true);
    expect(memory.events[2]?.metadata?.mode).toBe("predictive");
    expect(text).toContain("补充外部证据 1 条");
  });

  test("writes proactive assistant message without evidence search", async () => {
    const memory = new FakeMemoryManager();
    const actuator = new ProactiveActuator({
      memoryManager: memory,
      searchTopK: 3
    });

    const text = await actuator.execute(basePlan);

    expect(text).toBe("我建议先推进任务A。");
    expect(memory.events).toHaveLength(1);
    expect(memory.events[0]?.role).toBe("assistant");
    expect(memory.events[0]?.metadata?.proactive).toBe(true);
  });
});
