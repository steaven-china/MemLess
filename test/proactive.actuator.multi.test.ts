import { describe, expect, test } from "vitest";

import type { IMemoryManager } from "../src/memory/IMemoryManager.js";
import { ProactiveActuator } from "../src/proactive/ProactiveActuator.js";
import type { ISearchProvider, SearchQuery, SearchRecord, SearchResponse } from "../src/search/ISearchProvider.js";
import type { BlockRef, Context, MemoryEvent, ProactivePlan } from "../src/types.js";

class FakeMemoryManager implements IMemoryManager {
  public events: MemoryEvent[] = [];
  async addEvent(event: MemoryEvent): Promise<void> {
    this.events.push(event);
  }
  async getContext(_query: string): Promise<Context> {
    return { blocks: [], recentEvents: [], formatted: "" };
  }
  async sealCurrentBlock(): Promise<void> {}
  createNewBlock(): void {}
  async retrieveBlocks(): Promise<BlockRef[]> { return []; }
  async tickProactiveWakeup(): Promise<void> {}
}

class MockSearchProvider implements ISearchProvider {
  public calls: SearchQuery[] = [];
  constructor(private readonly recordsPerQuery: SearchRecord[][]) {}

  async search(input: SearchQuery): Promise<SearchResponse> {
    const records = this.recordsPerQuery[this.calls.length] ?? [];
    this.calls.push(input);
    return { records, status: records.length > 0 ? "ok" : "ok_empty" };
  }
}

function makeRecord(rank: number, url: string, title = "T"): SearchRecord {
  return { rank, url, title, snippet: "s", fetchedAt: Date.now() };
}

const basePlan: ProactivePlan = {
  action: "ask_followup",
  shouldSearchEvidence: true,
  searchQueries: [],
  messageSeed: "hint",
  reason: "test"
};

describe("ProactiveActuator multi-query", () => {
  test("calls searchProvider once per query", async () => {
    const memory = new FakeMemoryManager();
    const search = new MockSearchProvider([
      [makeRecord(1, "https://a.com/page1")],
      [makeRecord(1, "https://b.com/page2")]
    ]);
    const actuator = new ProactiveActuator({
      memoryManager: memory,
      searchProvider: search,
      searchTopK: 5
    });

    await actuator.execute({ ...basePlan, searchQueries: ["query A", "query B"] });

    expect(search.calls).toHaveLength(2);
    expect(search.calls[0]?.query).toBe("query A");
    expect(search.calls[1]?.query).toBe("query B");
  });

  test("deduplicates results by URL (keeps lowest rank)", async () => {
    const memory = new FakeMemoryManager();
    // Same URL appears in both queries — rank 2 (from q1) vs rank 1 (from q2): keep rank=1
    const search = new MockSearchProvider([
      [makeRecord(2, "https://shared.com/page"), makeRecord(3, "https://q1only.com/page")],
      [makeRecord(1, "https://shared.com/page"), makeRecord(4, "https://q2only.com/page")]
    ]);
    const actuator = new ProactiveActuator({
      memoryManager: memory,
      searchProvider: search,
      searchTopK: 10
    });

    await actuator.execute({ ...basePlan, searchQueries: ["q1", "q2"] });

    // Only one tool:search event stored
    const searchEvents = memory.events.filter((e) => e.metadata?.tool === "web.search.record");
    expect(searchEvents).toHaveLength(1);

    const records = searchEvents[0]?.metadata?.records as SearchRecord[];
    // 3 unique URLs: shared, q1only, q2only
    expect(records).toHaveLength(3);

    // The shared URL must appear exactly once and with rank=1 (the lower rank)
    const shared = records.filter((r) => r.url === "https://shared.com/page");
    expect(shared).toHaveLength(1);
    expect(shared[0]?.rank).toBe(1);
  });

  test("deduped records are sorted by rank ascending", async () => {
    const memory = new FakeMemoryManager();
    const search = new MockSearchProvider([
      [makeRecord(3, "https://c.com"), makeRecord(1, "https://a.com")],
      [makeRecord(2, "https://b.com")]
    ]);
    const actuator = new ProactiveActuator({
      memoryManager: memory,
      searchProvider: search,
      searchTopK: 10
    });

    await actuator.execute({ ...basePlan, searchQueries: ["q1", "q2"] });

    const records = memory.events[0]?.metadata?.records as SearchRecord[];
    const ranks = records.map((r) => r.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  test("searchTopK caps total deduped results", async () => {
    const memory = new FakeMemoryManager();
    const search = new MockSearchProvider([
      [makeRecord(1, "https://a.com"), makeRecord(2, "https://b.com"), makeRecord(3, "https://c.com")],
      [makeRecord(4, "https://d.com"), makeRecord(5, "https://e.com")]
    ]);
    const actuator = new ProactiveActuator({
      memoryManager: memory,
      searchProvider: search,
      searchTopK: 2
    });

    await actuator.execute({ ...basePlan, searchQueries: ["q1", "q2"] });

    const records = memory.events[0]?.metadata?.records as SearchRecord[];
    expect(records).toHaveLength(2);
  });

  test("does not call searchProvider when searchQueries is empty", async () => {
    const memory = new FakeMemoryManager();
    const search = new MockSearchProvider([]);
    const actuator = new ProactiveActuator({
      memoryManager: memory,
      searchProvider: search,
      searchTopK: 3
    });

    await actuator.execute({ ...basePlan, searchQueries: [] });

    expect(search.calls).toHaveLength(0);
    // Only the proactive assistant event is written
    expect(memory.events).toHaveLength(1);
    expect(memory.events[0]?.role).toBe("assistant");
  });

  test("queries list is stored in event metadata", async () => {
    const memory = new FakeMemoryManager();
    const search = new MockSearchProvider([
      [makeRecord(1, "https://x.com")],
      [makeRecord(2, "https://y.com")]
    ]);
    const actuator = new ProactiveActuator({
      memoryManager: memory,
      searchProvider: search,
      searchTopK: 5
    });

    await actuator.execute({ ...basePlan, searchQueries: ["alpha", "beta"] });

    const searchEvent = memory.events.find((e) => e.metadata?.tool === "web.search.record");
    expect(searchEvent?.metadata?.queries).toEqual(["alpha", "beta"]);
  });
});
