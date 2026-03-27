import { describe, expect, test } from "vitest";

import { BuiltinAgentToolExecutor } from "../src/agent/AgentToolExecutor.js";
import type { IMemoryManager } from "../src/memory/IMemoryManager.js";
import type { ISearchProvider, SearchQuery, SearchResponse } from "../src/search/ISearchProvider.js";
import type { IWebPageFetcher, WebPageFetchResult } from "../src/search/IWebPageFetcher.js";
import type { BlockRef, Context, MemoryEvent } from "../src/types.js";
import { RelationType } from "../src/types.js";

class FakeMemoryManager implements IMemoryManager {
  public events: MemoryEvent[] = [];
  public context: Context = {
    blocks: [],
    recentEvents: [],
    formatted: ""
  };
  public activeBlockId = "block_active";

  async addEvent(event: MemoryEvent): Promise<void> {
    this.events.push(event);
  }

  async getContext(_query: string): Promise<Context> {
    return this.context;
  }

  async sealCurrentBlock(): Promise<void> {}

  createNewBlock(): void {}

  async retrieveBlocks(): Promise<BlockRef[]> {
    return [];
  }

  async tickProactiveWakeup(): Promise<void> {}

  getActiveBlockId(): string | undefined {
    return this.activeBlockId;
  }
}

class MockSearchProvider implements ISearchProvider {
  public calls: SearchQuery[] = [];

  constructor(private readonly response: SearchResponse) {}

  async search(input: SearchQuery): Promise<SearchResponse> {
    this.calls.push(input);
    return this.response;
  }
}

class MockWebPageFetcher implements IWebPageFetcher {
  constructor(private readonly result: WebPageFetchResult) {}

  async fetch(): Promise<WebPageFetchResult> {
    return this.result;
  }
}

class FakeRelationStore {
  public relations: Array<{
    src: string;
    dst: string;
    type: RelationType;
    timestamp: number;
    confidence?: number;
  }> = [];

  async add(relation: {
    src: string;
    dst: string;
    type: RelationType;
    timestamp: number;
    confidence?: number;
  }): Promise<void> {
    this.relations.push(relation);
  }
}

describe("BuiltinAgentToolExecutor search tools", () => {
  test("records readonly list into memory", async () => {
    const memory = new FakeMemoryManager();
    const tool = new BuiltinAgentToolExecutor({
      workspaceRoot: process.cwd(),
      memoryManager: memory
    });

    const result = await tool.execute({
      name: "readonly.list",
      args: {
        path: ".",
        maxEntries: 10
      }
    });

    expect(result.ok).toBe(true);
    expect(memory.events).toHaveLength(1);
    expect(memory.events[0]?.metadata?.tool).toBe("readonly.list");
    expect(typeof memory.events[0]?.metadata?.count).toBe("number");
  });

  test("records readonly read into memory and relations", async () => {
    const memory = new FakeMemoryManager();
    const relationStore = new FakeRelationStore();
    memory.context = {
      blocks: [],
      recentEvents: [],
      formatted: ""
    };
    const tool = new BuiltinAgentToolExecutor({
      workspaceRoot: process.cwd(),
      memoryManager: memory,
      relationStore
    });

    const result = await tool.execute({
      name: "readonly.read",
      args: {
        path: "README.md",
        maxBytes: 1024
      }
    });

    expect(result.ok).toBe(true);
    expect(memory.events).toHaveLength(1);
    const event = memory.events[0];
    expect(event?.metadata?.tool).toBe("readonly.read");
    expect(typeof event?.metadata?.contentHash).toBe("string");
    expect(typeof event?.metadata?.versionKey).toBe("string");
    expect(relationStore.relations.some((item) => item.type === "SNAPSHOT_OF_FILE")).toBe(true);
    expect(relationStore.relations.some((item) => item.type === "FILE_MENTIONS_BLOCK")).toBe(true);
  });

  test("records web search results into memory", async () => {
    const memory = new FakeMemoryManager();
    const searchProvider = new MockSearchProvider({
      status: "ok",
      records: [
        {
          title: "Retry Pattern",
          url: "https://example.com/retry",
          snippet: "Use idempotency key",
          source: "mock",
          rank: 1,
          fetchedAt: Date.now()
        }
      ]
    });
    const tool = new BuiltinAgentToolExecutor({
      workspaceRoot: process.cwd(),
      memoryManager: memory,
      searchProvider,
      searchTopK: 5
    });

    const result = await tool.execute({
      name: "web.search.record",
      args: {
        query: "payment retry",
        limit: 3
      }
    });

    expect(result.ok).toBe(true);
    expect(searchProvider.calls[0]).toEqual({ query: "payment retry", limit: 3 });
    expect(memory.events).toHaveLength(1);
    expect(memory.events[0]?.text).toContain("web search: payment retry");
    expect(memory.events[0]?.metadata?.tool).toBe("web.search.record");

    const payload = JSON.parse(result.content) as { count?: number };
    expect(payload.count).toBe(1);
  });

  test("triggers search ingest in auto mode before history query", async () => {
    const memory = new FakeMemoryManager();
    const searchProvider = new MockSearchProvider({
      status: "ok",
      records: [
        {
          title: "Webhook Guide",
          url: "https://example.com/webhook",
          snippet: "idempotency and retries",
          source: "mock",
          rank: 1,
          fetchedAt: Date.now()
        }
      ]
    });
    const tool = new BuiltinAgentToolExecutor({
      workspaceRoot: process.cwd(),
      memoryManager: memory,
      searchProvider,
      searchAugmentMode: "auto",
      searchTopK: 4
    });

    const result = await tool.execute({
      name: "history.query",
      args: {
        query: "payment webhook",
        includePrediction: false
      }
    });

    expect(result.ok).toBe(true);
    expect(searchProvider.calls[0]).toEqual({ query: "payment webhook", limit: 4 });
    expect(memory.events).toHaveLength(1);
    expect(memory.events[0]?.metadata?.mode).toBe("auto");
  });

  test("fetches page content and appends truncated record", async () => {
    const memory = new FakeMemoryManager();
    const pageFetcher = new MockWebPageFetcher({
      url: "https://example.com/doc",
      title: "Doc",
      content: "abcdef".repeat(60),
      fetchedAt: Date.now(),
      status: "ok"
    });
    const tool = new BuiltinAgentToolExecutor({
      workspaceRoot: process.cwd(),
      memoryManager: memory,
      webPageFetcher: pageFetcher
    });

    const result = await tool.execute({
      name: "web.fetch.record",
      args: {
        url: "https://example.com/doc",
        maxChars: 20
      }
    });

    expect(result.ok).toBe(true);
    expect(memory.events).toHaveLength(1);
    expect(memory.events[0]?.metadata?.tool).toBe("web.fetch.record");
    expect(memory.events[0]?.metadata?.truncated).toBe(true);

    const payload = JSON.parse(result.content) as { truncated?: boolean; content?: string };
    expect(payload.truncated).toBe(true);
    expect(payload.content).toContain("...[truncated]");
  });
});
