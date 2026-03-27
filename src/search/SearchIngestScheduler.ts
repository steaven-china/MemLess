import { createId } from "../utils/id.js";
import type { IMemoryManager } from "../memory/IMemoryManager.js";
import type { ISearchProvider } from "./ISearchProvider.js";

interface SearchIngestSchedulerConfig {
  memoryManager: IMemoryManager;
  searchProvider: ISearchProvider;
  enabled: boolean;
  intervalMinutes: number;
  seeds: string[];
  topK: number;
  trace?: (event: string, payload: unknown) => void;
}

export class SearchIngestScheduler {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly config: SearchIngestSchedulerConfig) {}

  start(): void {
    if (!this.config.enabled) return;
    const intervalMs = Math.max(1, this.config.intervalMinutes) * 60 * 1000;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let successSeeds = 0;
    let failedSeeds = 0;
    try {
      for (const query of this.config.seeds) {
        const trimmed = query.trim();
        if (!trimmed) continue;
        try {
          const response = await this.config.searchProvider.search({
            query: trimmed,
            limit: this.config.topK
          });
          if (response.status !== "ok" && response.status !== "ok_empty") {
            failedSeeds += 1;
            this.config.trace?.("seed.failed", {
              query: trimmed,
              status: response.status,
              error: response.error,
              httpStatus: response.httpStatus
            });
            continue;
          }
          const results = response.records;
          if (results.length === 0) {
            successSeeds += 1;
            continue;
          }

          const summary = results
            .map((item) => `${item.rank}. ${item.title} | ${item.url} | ${item.snippet}`)
            .join("\n");

          await this.config.memoryManager.addEvent({
            id: createId("event"),
            role: "tool",
            text: `scheduled search: ${trimmed}\n${summary}`,
            timestamp: Date.now(),
            metadata: {
              tool: "web.search.record",
              mode: "scheduled",
              query: trimmed,
              count: results.length,
              results
            }
          });
          successSeeds += 1;
        } catch (error) {
          failedSeeds += 1;
          this.config.trace?.("seed.error", {
            query: trimmed,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      await this.config.memoryManager.sealCurrentBlock();
    } finally {
      this.config.trace?.("tick.done", {
        successSeeds,
        failedSeeds
      });
      this.running = false;
    }
  }
}
