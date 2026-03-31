import type { I18n } from "../i18n/index.js";
import type { IMemoryManager } from "../memory/IMemoryManager.js";
import type { ISearchProvider } from "../search/ISearchProvider.js";
import type { IWebPageFetcher } from "../search/IWebPageFetcher.js";
import type { ProactivePlan } from "../types.js";
import { createId } from "../utils/id.js";

export interface ProactiveActuatorConfig {
  memoryManager: IMemoryManager;
  searchProvider?: ISearchProvider;
  webPageFetcher?: IWebPageFetcher;
  searchTopK: number;
  i18n?: I18n;
}

export class ProactiveActuator {
  constructor(private readonly config: ProactiveActuatorConfig) {}

  async execute(plan: ProactivePlan): Promise<string | undefined> {
    if (plan.action === "noop") return undefined;

    let evidenceSummary = "";
    if (plan.shouldSearchEvidence && this.config.searchProvider && plan.searchQueries.length > 0) {
      // Execute all queries concurrently, then deduplicate results by URL.
      const allResults = await Promise.all(
        plan.searchQueries.map((query) =>
          this.config.searchProvider!.search({
            query,
            limit: Math.max(1, this.config.searchTopK)
          })
        )
      );

      // Merge records, dedup by URL (keep the record with the lowest rank).
      const byUrl = new Map<string, (typeof allResults)[0]["records"][0]>();
      for (const response of allResults) {
        for (const item of response.records) {
          const existing = byUrl.get(item.url);
          if (!existing || item.rank < existing.rank) {
            byUrl.set(item.url, item);
          }
        }
      }

      // Sort deduped records by rank ascending, then cap at searchTopK.
      const deduped = [...byUrl.values()]
        .sort((a, b) => a.rank - b.rank)
        .slice(0, Math.max(1, this.config.searchTopK));

      if (deduped.length > 0) {
        const queryList = plan.searchQueries.join(", ");
        const summary = deduped
          .map((item) => `${item.rank}. ${item.title} | ${item.url} | ${item.snippet}`)
          .join("\n");

        await this.config.memoryManager.addEvent({
          id: createId("event"),
          role: "tool",
          text: `predictive evidence search: ${queryList}\n${summary}`,
          timestamp: Date.now(),
          metadata: {
            tool: "web.search.record",
            mode: "predictive-evidence",
            queries: plan.searchQueries,
            count: deduped.length,
            records: deduped,
            status: allResults[0]?.status,
            error: allResults[0]?.error,
            httpStatus: allResults[0]?.httpStatus
          }
        });

        // Fetch the top result page only (first of deduped list).
        const first = deduped[0];
        if (first?.url && this.config.webPageFetcher) {
          const page = await this.config.webPageFetcher.fetch(first.url);
          if (page.status === "ok") {
            const clipped = page.content.slice(0, 3000);
            await this.config.memoryManager.addEvent({
              id: createId("event"),
              role: "tool",
              text: `predictive evidence fetch\nurl: ${page.url}\ntitle: ${page.title ?? ""}\n${clipped}`.trim(),
              timestamp: Date.now(),
              metadata: {
                tool: "web.fetch.record",
                mode: "predictive-evidence",
                url: page.url,
                title: page.title,
                fetchedAt: page.fetchedAt,
                truncated: clipped.length < page.content.length,
                status: page.status
              }
            });
          }
        }

        evidenceSummary =
          this.config.i18n?.t("proactive.evidence_suffix", {
            count: deduped.length
          }) ??
          ` (${plan.searchQueries.length} quer${plan.searchQueries.length === 1 ? "y" : "ies"}, ${deduped.length} evidence item(s))`;
      }
    }

    const text = `${plan.messageSeed}${evidenceSummary}`.trim();
    if (!text) return undefined;

    await this.config.memoryManager.addEvent({
      id: createId("event"),
      role: "assistant",
      text,
      timestamp: Date.now(),
      metadata: {
        proactive: true,
        mode: "predictive",
        action: plan.action,
        reason: plan.reason
      }
    });

    return text;
  }
}
