import type { IWebPageFetcher, WebPageFetchResult } from "./IWebPageFetcher.js";

interface HttpWebPageFetcherConfig {
  endpoint?: string;
  apiKey?: string;
  timeoutMs: number;
}

interface WebFetchApiResponse {
  url?: string;
  title?: string;
  content?: string;
}

export class HttpWebPageFetcher implements IWebPageFetcher {
  constructor(private readonly config: HttpWebPageFetcherConfig) {}

  async fetch(url: string): Promise<WebPageFetchResult> {
    const endpoint = this.config.endpoint?.trim();
    const target = url.trim();
    if (!endpoint || target.length === 0) {
      return {
        url: target,
        content: "",
        fetchedAt: Date.now(),
        status: "not_configured",
        error: !endpoint ? "web fetch endpoint is not configured" : "url is empty"
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
        body: JSON.stringify({ url: target }),
        signal: controller.signal
      });
      if (!response.ok) {
        return {
          url: target,
          content: "",
          fetchedAt: Date.now(),
          status: "http_error",
          error: `web fetch http error: ${response.status}`,
          httpStatus: response.status
        };
      }
      const payload = (await response.json()) as WebFetchApiResponse;
      return {
        url: (payload.url ?? target).trim(),
        title: payload.title?.trim(),
        content: (payload.content ?? "").trim(),
        fetchedAt: Date.now(),
        status: "ok"
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        url: target,
        content: "",
        fetchedAt: Date.now(),
        status: "request_error",
        error: `web fetch request error: ${message}`
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
