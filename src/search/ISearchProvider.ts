export type SearchResultStatus =
  | "ok"
  | "ok_empty"
  | "not_configured"
  | "http_error"
  | "request_error";

export interface SearchRecord {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  rank: number;
  fetchedAt: number;
}

export interface SearchQuery {
  query: string;
  limit: number;
}

export interface SearchResponse {
  records: SearchRecord[];
  status: SearchResultStatus;
  error?: string;
  httpStatus?: number;
}

export interface ISearchProvider {
  search(input: SearchQuery): Promise<SearchResponse>;
}
