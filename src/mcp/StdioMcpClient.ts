import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface IMcpToolClient {
  listTools(timeoutMs?: number): Promise<McpToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  close(): Promise<void>;
}

export interface StdioMcpClientConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  initTimeoutMs?: number;
  clientName?: string;
  clientVersion?: string;
}

interface JsonRpcResponseEnvelope {
  id?: number | string;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
}

export class StdioMcpClient implements IMcpToolClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private stdoutBuffer = Buffer.alloc(0);
  private initializePromise: Promise<void> | undefined;
  private initialized = false;
  private closed = false;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private stderrTail = "";

  constructor(private readonly config: StdioMcpClientConfig) {}

  async listTools(timeoutMs = 30_000): Promise<McpToolDefinition[]> {
    await this.ensureInitialized();
    const result = await this.sendRequest("tools/list", {}, timeoutMs);
    const tools = (result as { tools?: unknown })?.tools;
    if (!Array.isArray(tools)) return [];
    return tools
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => ({
        name: String(item.name ?? ""),
        description: typeof item.description === "string" ? item.description : undefined,
        inputSchema: item.inputSchema
      }))
      .filter((item) => item.name.length > 0);
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<unknown> {
    await this.ensureInitialized();
    return this.sendRequest(
      "tools/call",
      {
        name,
        arguments: args
      },
      timeoutMs
    );
  }

  async close(): Promise<void> {
    this.closed = true;
    this.initialized = false;
    this.initializePromise = undefined;
    this.rejectAllPending(new Error("MCP client closed"));
    this.stdoutBuffer = Buffer.alloc(0);

    const child = this.child;
    this.child = undefined;
    if (!child) return;

    await terminateProcess(child);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.closed) {
      throw new Error("MCP client is closed");
    }
    if (this.initialized) return;
    if (this.initializePromise) {
      return this.initializePromise;
    }
    const promise = this.initialize();
    this.initializePromise = promise;
    try {
      await promise;
    } catch (error) {
      if (this.closed) {
        throw new Error("MCP client is closed");
      }
      throw error;
    } finally {
      if (this.initializePromise === promise) {
        this.initializePromise = undefined;
      }
    }
  }

  private async initialize(): Promise<void> {
    this.spawnProcess();
    const initTimeoutMs = Math.max(1_000, this.config.initTimeoutMs ?? 15_000);
    const initResult = await this.sendRequest(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: this.config.clientName ?? "mlex-agent",
          version: this.config.clientVersion ?? "0.1.0"
        }
      },
      initTimeoutMs
    );
    if (!initResult || typeof initResult !== "object") {
      throw new Error("Invalid MCP initialize response: missing result payload");
    }
    this.sendNotification("notifications/initialized", {});
    this.initialized = true;
  }

  private spawnProcess(): void {
    if (this.child) return;
    const command = this.config.command.trim();
    if (command.length === 0) {
      throw new Error("MCP command is empty");
    }
    const child = spawn(command, this.config.args ?? [], {
      cwd: this.config.cwd,
      env: this.config.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    this.stdoutBuffer = Buffer.alloc(0);
    this.stderrTail = "";

    child.stdout.on("data", (chunk: Buffer) => {
      this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
      this.drainStdoutBuffer();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail += chunk.toString("utf8");
      if (this.stderrTail.length > 8_192) {
        this.stderrTail = this.stderrTail.slice(-8_192);
      }
    });

    child.once("error", (error) => {
      this.failProcess(error);
    });

    child.once("close", (code, signal) => {
      const hint = this.stderrTail.trim();
      const suffix = hint ? `, stderr tail: ${hint}` : "";
      this.failProcess(new Error(`MCP process closed (code=${String(code)}, signal=${String(signal)})${suffix}`));
    });
  }

  private failProcess(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.initialized = false;
    this.child = undefined;
    this.rejectAllPending(new Error(message));
  }

  private rejectAllPending(reason: unknown): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
  }

  private async sendRequest(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const child = this.child;
    if (!child || !child.stdin.writable) {
      throw new Error("MCP process is not writable");
    }
    const id = this.nextRequestId++;
    const message = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };
    this.writeMessage(message);

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, Math.max(1_000, timeoutMs));
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  private sendNotification(method: string, params: unknown): void {
    this.writeMessage({
      jsonrpc: "2.0",
      method,
      params
    });
  }

  private writeMessage(message: Record<string, unknown>): void {
    const child = this.child;
    if (!child || !child.stdin.writable) {
      throw new Error("MCP process is not writable");
    }
    const payload = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n`;
    child.stdin.write(header, "utf8");
    child.stdin.write(payload, "utf8");
  }

  private drainStdoutBuffer(): void {
    try {
      while (true) {
        const headerEnd = this.stdoutBuffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = this.stdoutBuffer.subarray(0, headerEnd).toString("utf8");
        const contentLength = parseContentLength(header);
        if (contentLength === undefined) {
          this.failProcess(new Error(`Invalid MCP frame header: ${header}`));
          return;
        }
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + contentLength;
        if (this.stdoutBuffer.length < bodyEnd) return;

        const body = this.stdoutBuffer.subarray(bodyStart, bodyEnd).toString("utf8");
        this.stdoutBuffer = this.stdoutBuffer.subarray(bodyEnd);

        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.failProcess(new Error(`Failed to parse MCP JSON payload: ${message}`));
          return;
        }

        this.handleIncomingMessage(parsed);
      }
    } catch (error) {
      this.failProcess(error);
    }
  }

  private handleIncomingMessage(payload: unknown): void {
    if (!payload || typeof payload !== "object") return;
    const response = payload as JsonRpcResponseEnvelope;
    if (typeof response.id !== "number") {
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);

    if (response.error) {
      const message =
        typeof response.error.message === "string"
          ? response.error.message
          : `MCP request failed with code ${String(response.error.code)}`;
      pending.reject(new Error(message));
      return;
    }
    pending.resolve(response.result);
  }
}

function parseContentLength(header: string): number | undefined {
  const lines = header.split(/\r?\n/);
  for (const line of lines) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    if (key !== "content-length") continue;
    const valueRaw = line.slice(index + 1).trim();
    const value = Number.parseInt(valueRaw, 10);
    if (!Number.isFinite(value) || value < 0) {
      return undefined;
    }
    return value;
  }
  return undefined;
}

async function terminateProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  if (process.platform === "win32") {
    if (typeof child.pid === "number" && child.pid > 0) {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true
        });
        killer.once("close", () => resolve());
        killer.once("error", () => {
          child.kill("SIGKILL");
          resolve();
        });
      });
      return;
    }
    child.kill("SIGKILL");
    return;
  }

  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
