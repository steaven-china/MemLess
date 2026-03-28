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
      const query = plan.searchQueries[0] ?? "";
      const response = await this.config.searchProvider.search({
        query,
        limit: Math.max(1, this.config.searchTopK)
      });
      const records = response.records;
      if (records.length > 0) {
        const summary = records
          .map((item) => `${item.rank}. ${item.title} | ${item.url} | ${item.snippet}`)
          .join("\n");

        await this.config.memoryManager.addEvent({
          id: createId("event"),
          role: "tool",
          text: `predictive evidence search: ${query}\n${summary}`,
          timestamp: Date.now(),
          metadata: {
            tool: "web.search.record",
            mode: "predictive-evidence",
            query,
            count: records.length,
            records,
            status: response.status,
            error: response.error,
            httpStatus: response.httpStatus
          }
        });

        const first = records[0];
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
          this.config.i18n?.t("proactive.evidence_suffix", { count: records.length }) ??
          ` (added ${records.length} external evidence item(s))`;
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
