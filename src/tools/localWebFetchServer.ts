import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface LocalWebFetchServerOptions {
  host: string;
  port: number;
  apiKey?: string;
  requestTimeoutMs: number;
  bodyMaxBytes: number;
  maxContentChars: number;
  userAgent: string;
}

export interface StartedLocalWebFetchServer {
  url: string;
  close(): Promise<void>;
}

interface WebFetchRequestPayload {
  url?: string;
}

export async function startLocalWebFetchServer(
  options: LocalWebFetchServerOptions
): Promise<StartedLocalWebFetchServer> {
  const server = createServer(async (req, res) => {
    try {
      const method = String(req.method ?? "GET").toUpperCase();
      const pathname = getPathname(req.url);

      if (method === "GET" && pathname === "/healthz") {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (method !== "POST" || pathname !== "/fetch") {
        sendJson(res, 404, { error: "Not found" });
        return;
      }

      if (options.apiKey && !isAuthorized(req, options.apiKey)) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }

      const body = await readJsonBody(req, options.bodyMaxBytes);
      const payload = body as WebFetchRequestPayload;
      const targetUrl = String(payload?.url ?? "").trim();
      if (!targetUrl) {
        sendJson(res, 400, { error: "url is required" });
        return;
      }
      if (!isHttpUrl(targetUrl)) {
        sendJson(res, 400, { error: "url must be http(s)" });
        return;
      }

      const fetched = await fetchTarget(targetUrl, options.requestTimeoutMs, options.userAgent);
      if (!fetched.ok) {
        sendJson(res, 502, {
          error: `upstream http error: ${fetched.status}`,
          status: fetched.status,
          url: fetched.url
        });
        return;
      }
      const normalized = normalizeFetchedText(
        fetched.text,
        fetched.contentType,
        options.maxContentChars
      );
      sendJson(res, 200, {
        url: fetched.url,
        title: normalized.title,
        content: normalized.content
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve local web fetch server address");
  }

  return {
    url: `http://${options.host}:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

async function fetchTarget(
  url: string,
  timeoutMs: number,
  userAgent: string
): Promise<{ ok: boolean; status: number; text: string; url: string; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": userAgent
      },
      signal: controller.signal
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
      url: response.url || url,
      contentType: String(response.headers.get("content-type") ?? "")
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeFetchedText(
  content: string,
  contentType: string,
  maxChars: number
): { title?: string; content: string } {
  const html = isHtmlContentType(contentType);
  const boundedMaxChars = Math.max(512, maxChars);
  if (!html) {
    return {
      content: compactWhitespace(content).slice(0, boundedMaxChars)
    };
  }
  const withoutScript = content
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const titleRaw = firstCapture(withoutScript, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const bodyRaw = firstCapture(withoutScript, /<body[^>]*>([\s\S]*?)<\/body>/i) ?? withoutScript;
  const title = compactWhitespace(decodeHtmlEntities(stripTags(titleRaw ?? "")));
  const text = compactWhitespace(decodeHtmlEntities(stripTags(bodyRaw))).slice(0, boundedMaxChars);
  return {
    title: title || undefined,
    content: text
  };
}

function firstCapture(input: string, pattern: RegExp): string | undefined {
  const match = input.match(pattern);
  return match?.[1];
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, " ");
}

function compactWhitespace(input: string): string {
  return String(input ?? "").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function getPathname(url: string | undefined): string {
  try {
    return new URL(url ?? "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function isHttpUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isAuthorized(req: IncomingMessage, expectedApiKey: string): boolean {
  const header = String(req.headers.authorization ?? "");
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  return token.length > 0 && token === expectedApiKey;
}

function isHtmlContentType(contentType: string): boolean {
  const value = contentType.toLowerCase();
  return value.includes("text/html") || value.includes("application/xhtml");
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const limit = Math.max(1024, maxBytes);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      throw new Error(`request body too large: ${size} bytes (max ${limit})`);
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON payload");
  }
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body, "utf8"));
  res.end(body);
}

