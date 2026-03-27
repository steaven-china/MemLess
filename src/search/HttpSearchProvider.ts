import type { SearchQuery, SearchRecord, SearchResponse, ISearchProvider } from "./ISearchProvider.js";

interface HttpSearchProviderConfig {
  endpoint?: string;
  apiKey?: string;
  providerName: string;
  timeoutMs: number;
}

interface SearchApiResponse {
  results?: Array<{
    title?: string;
    url?: string;
    snippet?: string;
    source?: string;
  }>;
}

export class HttpSearchProvider implements ISearchProvider {
  constructor(private readonly config: HttpSearchProviderConfig) {}

  async search(input: SearchQuery): Promise<SearchResponse> {
    const endpoint = this.config.endpoint?.trim();
    if (!endpoint) {
      return {
        records: [],
        status: "not_configured",
        error: "search endpoint is not configured"
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {})
        },
        body: JSON.stringify({
          query: input.query,
          limit: input.limit
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        return {
          records: [],
          status: "http_error",
          error: `search provider http error: ${response.status}`,
          httpStatus: response.status
        };
      }
      const payload = (await response.json()) as SearchApiResponse;
      const now = Date.now();
      const records: SearchRecord[] = (payload.results ?? [])
        .slice(0, input.limit)
        .map((item, index) => ({
          title: (item.title ?? "").trim(),
          url: (item.url ?? "").trim(),
          snippet: (item.snippet ?? "").trim(),
          source: (item.source ?? this.config.providerName).trim(),
          rank: index + 1,
          fetchedAt: now
        }))
        .filter((item) => item.url.length > 0 && (item.title.length > 0 || item.snippet.length > 0));
      return {
        records,
        status: records.length === 0 ? "ok_empty" : "ok"
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        records: [],
        status: "request_error",
        error: `search provider request error: ${message}`
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
