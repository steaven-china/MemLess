export type WebFetchStatus = "ok" | "not_configured" | "http_error" | "request_error";

export interface WebPageFetchResult {
  url: string;
  title?: string;
  content: string;
  fetchedAt: number;
  status: WebFetchStatus;
  error?: string;
  httpStatus?: number;
}

export interface IWebPageFetcher {
  fetch(url: string): Promise<WebPageFetchResult>;
}
