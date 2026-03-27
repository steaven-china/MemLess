#!/usr/bin/env node
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { stdout as output } from "node:process";

import { createRuntime } from "../container.js";
import type { DeepPartial, AppConfig } from "../config.js";
import type { IDebugTraceRecorder } from "../debug/DebugTraceRecorder.js";
import {
  ReadonlyFileService,
  type ReadFileResult,
  type ReadonlyFileEntry
} from "../files/ReadonlyFileService.js";
import { MlexTuiApp } from "../tui/MlexTuiApp.js";
import { startWebServer } from "../web/server.js";

const program = new Command();

program
  .name("mlex")
  .description("Partition-memory agent CLI (loads ~/.mlex/config.toml when present)")
  .version("0.2.0")
  .addHelpText(
    "after",
    "\nConfig precedence: defaults < ~/.mlex/config.toml < env vars < CLI/runtime overrides."
  );

program
  .command("web")
  .description("Start minimalist web UI")
  .option("--host <host>", "bind host", "127.0.0.1")
  .option("--port <number>", "bind port", "8787")
  .option("--provider <provider>", "rule-based | openai | deepseek-reasoner")
  .option("--model <model>", "LLM model for openai/deepseek provider")
  .option("--chunk-strategy <strategy>", "fixed | semantic | hybrid")
  .option("--storage-backend <backend>", "memory | sqlite | lance | chroma")
  .option("--sqlite-file <path>", "sqlite database file path")
  .option("--lance-file <path>", "local file path for lance backend")
  .option("--raw-store-backend <backend>", "memory | file | sqlite")
  .option("--raw-store-file <path>", "raw event store file path")
  .option("--relation-store-backend <backend>", "memory | file | sqlite")
  .option("--relation-store-file <path>", "relation store file path")
  .option("--graph-embedding <method>", "node2vec | transe")
  .option("--relation-extractor <kind>", "heuristic | openai | deepseek")
  .option("--relation-model <model>", "relation extraction model name")
  .option("--search-endpoint <url>", "search provider endpoint")
  .option("--search-api-key <key>", "search provider api key")
  .option("--web-fetch-endpoint <url>", "web fetch endpoint")
  .option("--web-fetch-api-key <key>", "web fetch api key")
  .option("--search-mode <mode>", "lazy | auto | scheduled | predictive")
  .option("--search-schedule-minutes <number>", "scheduled ingest interval minutes")
  .option("--search-topk <number>", "max results per search record")
  .option("--search-seeds <csv>", "scheduled seed queries, comma separated")
  .option("--prediction <enabled>", "true | false")
  .option("--proactive-wakeup <enabled>", "true | false")
  .option("--proactive-min-interval-seconds <number>", "minimum proactive wakeup interval")
  .option("--proactive-max-per-hour <number>", "maximum proactive wakeups per hour")
  .option("--proactive-require-evidence <enabled>", "true | false")
  .option("--proactive-timer <enabled>", "true | false")
  .option("--proactive-timer-interval-seconds <number>", "proactive timer interval seconds")
  .option("--web-debug-api <enabled>", "true | false")
  .option("--web-file-api <enabled>", "true | false")
  .option("--web-raw-context <enabled>", "true | false")
  .option("--web-admin-token <token>", "admin token for debug/files APIs")
  .option("--web-body-max-bytes <number>", "max request body bytes for /api/chat")
  .option("--debug-trace <enabled>", "true | false")
  .option("--debug-trace-max <number>", "max in-memory trace entries")
  .action(async (options) => {
    const host = asOptionalString(options.host) ?? "127.0.0.1";
    const preferredPort = parseOptionalNumber(asOptionalString(options.port)) ?? 8787;
    const started = await startWebServerWithFallback(host, preferredPort, buildRuntimeOverrides(options));
    output.write(`MLEX web running at ${started.url}\n`);
    output.write("Press Ctrl+C to stop.\n");

    const shutdown = async (): Promise<void> => {
      await started.close();
      process.exit(0);
    };
    process.once("SIGINT", () => {
      void shutdown();
    });
    process.once("SIGTERM", () => {
      void shutdown();
    });
  });

program
  .command("files:list")
  .description("List files under readonly workspace root")
  .argument("[path]", "relative directory path", ".")
  .option("--max-entries <number>", "max listed entries", "200")
  .action(async (pathInput: string, options) => {
    const fileService = new ReadonlyFileService({ rootPath: process.cwd() });
    const maxEntries = parseOptionalNumber(asOptionalString(options.maxEntries));
    const entries = await fileService.list(pathInput, maxEntries);
    output.write(formatFileList(entries, pathInput));
  });

program
  .command("files:read")
  .description("Read one file in readonly mode")
  .argument("<path>", "relative file path")
  .option("--max-bytes <number>", "max bytes to read", "65536")
  .action(async (pathInput: string, options) => {
    const fileService = new ReadonlyFileService({ rootPath: process.cwd() });
    const maxBytes = parseOptionalNumber(asOptionalString(options.maxBytes));
    const result = await fileService.read(pathInput, maxBytes);
    output.write(formatFileRead(result));
  });

program
  .command("chat")
  .description("Start fullscreen TUI agent session")
  .option("--provider <provider>", "rule-based | openai | deepseek-reasoner")
  .option("--model <model>", "LLM model for openai/deepseek provider")
  .option("--stream", "enable streaming output", false)
  .option("--max-tokens <number>", "max tokens per memory block")
  .option("--chunk-strategy <strategy>", "fixed | semantic | hybrid")
  .option("--storage-backend <backend>", "memory | sqlite | lance | chroma")
  .option("--sqlite-file <path>", "sqlite database file path")
  .option("--lance-file <path>", "local file path for lance backend")
  .option("--chroma-base-url <url>", "chroma base url")
  .option("--chroma-collection <id>", "chroma collection id")
  .option("--raw-store-backend <backend>", "memory | file | sqlite")
  .option("--raw-store-file <path>", "raw event store file path")
  .option("--relation-store-backend <backend>", "memory | file | sqlite")
  .option("--relation-store-file <path>", "relation store file path")
  .option("--graph-embedding <method>", "node2vec | transe")
  .option("--relation-extractor <kind>", "heuristic | openai | deepseek")
  .option("--relation-model <model>", "relation extraction model name")
  .option("--search-endpoint <url>", "search provider endpoint")
  .option("--search-api-key <key>", "search provider api key")
  .option("--web-fetch-endpoint <url>", "web fetch endpoint")
  .option("--web-fetch-api-key <key>", "web fetch api key")
  .option("--search-mode <mode>", "lazy | auto | scheduled | predictive")
  .option("--search-schedule-minutes <number>", "scheduled ingest interval minutes")
  .option("--search-topk <number>", "max results per search record")
  .option("--search-seeds <csv>", "scheduled seed queries, comma separated")
  .option("--prediction <enabled>", "true | false")
  .option("--proactive-wakeup <enabled>", "true | false")
  .option("--proactive-min-interval-seconds <number>", "minimum proactive wakeup interval")
  .option("--proactive-max-per-hour <number>", "maximum proactive wakeups per hour")
  .option("--proactive-require-evidence <enabled>", "true | false")
  .option("--proactive-timer <enabled>", "true | false")
  .option("--proactive-timer-interval-seconds <number>", "proactive timer interval seconds")
  .option("--show-context", "print context debug info after each answer", false)
  .option("--debug-trace <enabled>", "true | false")
  .option("--debug-trace-max <number>", "max in-memory trace entries")
  .action(async (options) => {
    const runtime = createRuntime(buildRuntimeOverrides(options));
    const fileService = new ReadonlyFileService({ rootPath: process.cwd() });
    const traceRecorder = runtime.container.resolve<IDebugTraceRecorder>("debugTraceRecorder");
    const tui = new MlexTuiApp({
      runtime,
      fileService,
      traceRecorder,
      streamEnabled: Boolean(options.stream),
      showContextByDefault: Boolean(options.showContext),
      sanitizeConfig: sanitizeConfigForDisplay
    });

    try {
      await tui.run();
    } finally {
      await runtime.close();
    }
  });

program
  .command("ingest")
  .description("Ingest a text file into memory blocks")
  .argument("<file>", "path to txt/markdown file")
  .option("--provider <provider>", "rule-based | openai | deepseek-reasoner", "rule-based")
  .option("--model <model>", "LLM model for openai/deepseek provider")
  .option("--storage-backend <backend>", "memory | sqlite | lance | chroma", "sqlite")
  .option("--sqlite-file <path>", "sqlite database file path")
  .option("--lance-file <path>", "local file path for lance backend")
  .option("--raw-store-backend <backend>", "memory | file | sqlite")
  .option("--raw-store-file <path>", "raw event store file path")
  .option("--relation-store-backend <backend>", "memory | file | sqlite")
  .option("--relation-store-file <path>", "relation store file path")
  .option("--graph-embedding <method>", "node2vec | transe")
  .option("--relation-extractor <kind>", "heuristic | openai | deepseek")
  .option("--relation-model <model>", "relation extraction model name")
  .option("--search-endpoint <url>", "search provider endpoint")
  .option("--search-api-key <key>", "search provider api key")
  .option("--web-fetch-endpoint <url>", "web fetch endpoint")
  .option("--web-fetch-api-key <key>", "web fetch api key")
  .option("--search-mode <mode>", "lazy | auto | scheduled | predictive")
  .option("--search-schedule-minutes <number>", "scheduled ingest interval minutes")
  .option("--search-topk <number>", "max results per search record")
  .option("--search-seeds <csv>", "scheduled seed queries, comma separated")
  .option("--prediction <enabled>", "true | false")
  .option("--proactive-wakeup <enabled>", "true | false")
  .option("--proactive-min-interval-seconds <number>", "minimum proactive wakeup interval")
  .option("--proactive-max-per-hour <number>", "maximum proactive wakeups per hour")
  .option("--proactive-require-evidence <enabled>", "true | false")
  .option("--proactive-timer <enabled>", "true | false")
  .option("--proactive-timer-interval-seconds <number>", "proactive timer interval seconds")
  .action(async (file: string, options) => {
    const runtime = createRuntime(buildRuntimeOverrides(options));
    try {
      const content = await readFile(file, "utf8");
      const segments = content
        .split(/\n{2,}/)
        .map((line) => line.trim())
        .filter(Boolean);

      for (const segment of segments) {
        await runtime.agent.respond(`请记住以下资料：\n${segment}`);
      }
      await runtime.agent.sealMemory();
      output.write(`ingest complete: ${segments.length} segments processed.\n`);
    } finally {
      await runtime.close();
    }
  });

program
  .command("ask")
  .description("Ask one question and print answer")
  .argument("<query>", "question to ask")
  .option("--provider <provider>", "rule-based | openai | deepseek-reasoner")
  .option("--model <model>", "LLM model for openai/deepseek provider")
  .option("--stream", "enable streaming output", false)
  .option("--storage-backend <backend>", "memory | sqlite | lance | chroma")
  .option("--sqlite-file <path>", "sqlite database file path")
  .option("--lance-file <path>", "local file path for lance backend")
  .option("--raw-store-backend <backend>", "memory | file | sqlite")
  .option("--raw-store-file <path>", "raw event store file path")
  .option("--relation-store-backend <backend>", "memory | file | sqlite")
  .option("--relation-store-file <path>", "relation store file path")
  .option("--graph-embedding <method>", "node2vec | transe")
  .option("--relation-extractor <kind>", "heuristic | openai | deepseek")
  .option("--relation-model <model>", "relation extraction model name")
  .option("--search-endpoint <url>", "search provider endpoint")
  .option("--search-api-key <key>", "search provider api key")
  .option("--web-fetch-endpoint <url>", "web fetch endpoint")
  .option("--web-fetch-api-key <key>", "web fetch api key")
  .option("--search-mode <mode>", "lazy | auto | scheduled | predictive")
  .option("--search-schedule-minutes <number>", "scheduled ingest interval minutes")
  .option("--search-topk <number>", "max results per search record")
  .option("--search-seeds <csv>", "scheduled seed queries, comma separated")
  .option("--prediction <enabled>", "true | false")
  .option("--proactive-wakeup <enabled>", "true | false")
  .option("--proactive-min-interval-seconds <number>", "minimum proactive wakeup interval")
  .option("--proactive-max-per-hour <number>", "maximum proactive wakeups per hour")
  .option("--proactive-require-evidence <enabled>", "true | false")
  .option("--proactive-timer <enabled>", "true | false")
  .option("--proactive-timer-interval-seconds <number>", "proactive timer interval seconds")
  .action(async (query: string, options) => {
    const runtime = createRuntime(buildRuntimeOverrides(options));
    try {
      if (options.stream) {
        await runtime.agent.respondStream(query, (token) => output.write(token));
        output.write("\n");
        return;
      }

      const response = await runtime.agent.respond(query);
      output.write(`${response.text}\n`);
    } finally {
      await runtime.close();
    }
  });

program
  .command("swarm")
  .description("Run multi-agent collaboration and synthesis")
  .argument("<query>", "question/task to solve")
  .option("--provider <provider>", "rule-based | openai | deepseek-reasoner")
  .option("--model <model>", "LLM model for openai/deepseek provider")
  .option("--agents <number>", "number of worker agents (2-5)", "3")
  .option("--no-show-drafts", "hide each worker draft before final synthesis")
  .option("--storage-backend <backend>", "memory | sqlite | lance | chroma")
  .option("--sqlite-file <path>", "sqlite database file path")
  .option("--lance-file <path>", "local file path for lance backend")
  .option("--raw-store-backend <backend>", "memory | file | sqlite")
  .option("--raw-store-file <path>", "raw event store file path")
  .option("--relation-store-backend <backend>", "memory | file | sqlite")
  .option("--relation-store-file <path>", "relation store file path")
  .option("--graph-embedding <method>", "node2vec | transe")
  .option("--relation-extractor <kind>", "heuristic | openai | deepseek")
  .option("--relation-model <model>", "relation extraction model name")
  .option("--search-endpoint <url>", "search provider endpoint")
  .option("--search-api-key <key>", "search provider api key")
  .option("--web-fetch-endpoint <url>", "web fetch endpoint")
  .option("--web-fetch-api-key <key>", "web fetch api key")
  .option("--search-mode <mode>", "lazy | auto | scheduled | predictive")
  .option("--search-schedule-minutes <number>", "scheduled ingest interval minutes")
  .option("--search-topk <number>", "max results per search record")
  .option("--search-seeds <csv>", "scheduled seed queries, comma separated")
  .option("--prediction <enabled>", "true | false")
  .option("--proactive-wakeup <enabled>", "true | false")
  .option("--proactive-min-interval-seconds <number>", "minimum proactive wakeup interval")
  .option("--proactive-max-per-hour <number>", "maximum proactive wakeups per hour")
  .option("--proactive-require-evidence <enabled>", "true | false")
  .option("--proactive-timer <enabled>", "true | false")
  .option("--proactive-timer-interval-seconds <number>", "proactive timer interval seconds")
  .action(async (query: string, options) => {
    const workerCount = clampAgents(options.agents);
    const roles = buildRoles(workerCount);
    const workerResults = await runSwarmWorkers(query, options, roles);

    if (options.showDrafts) {
      for (const item of workerResults) {
        output.write(`\n[${item.role}] draft:\n${item.text}\n`);
      }
    }

    const synthesisPrompt = [
      "请综合以下多 Agent 结果，给出最终统一方案：",
      ...workerResults.map(
        (item, index) => `\n[Worker ${index + 1} - ${item.role}]\n${item.text}`
      ),
      `\n[原始任务]\n${query}`,
      "\n输出格式：结论、关键步骤、风险点、下一步行动。"
    ].join("\n");

    const coordinator = createRuntime(buildRuntimeOverrides(options), {
      agentSystemPrompt:
        "You are the coordinator agent. Merge drafts, resolve conflicts, and output one practical final answer."
    });
    try {
      const final = await coordinator.agent.respond(synthesisPrompt);
      output.write(`\n[Coordinator]\n${final.text}\n`);
    } finally {
      await coordinator.close();
    }
  });

void program.parseAsync(process.argv);

function buildRuntimeOverrides(options: Record<string, unknown>): DeepPartial<AppConfig> {
  return {
    service: {
      provider: asOptionalString(options.provider) as AppConfig["service"]["provider"],
      openaiModel: asOptionalString(options.model),
      deepseekModel: asOptionalString(options.model)
    },
    component: {
      chunkStrategy: asOptionalString(options.chunkStrategy) as AppConfig["component"]["chunkStrategy"],
      storageBackend: asOptionalString(options.storageBackend) as AppConfig["component"]["storageBackend"],
      sqliteFilePath: asOptionalString(options.sqliteFile),
      lanceFilePath: asOptionalString(options.lanceFile),
      chromaBaseUrl: asOptionalString(options.chromaBaseUrl),
      chromaCollectionId: asOptionalString(options.chromaCollection),
      searchEndpoint: asOptionalString(options.searchEndpoint),
      searchApiKey: asOptionalString(options.searchApiKey),
      webFetchEndpoint: asOptionalString(options.webFetchEndpoint),
      webFetchApiKey: asOptionalString(options.webFetchApiKey),
      searchSeedQueries: parseOptionalCsv(asOptionalString(options.searchSeeds)),
      rawStoreBackend:
        asOptionalString(options.rawStoreBackend) as AppConfig["component"]["rawStoreBackend"],
      rawStoreFilePath: asOptionalString(options.rawStoreFile),
      relationStoreBackend:
        asOptionalString(options.relationStoreBackend) as AppConfig["component"]["relationStoreBackend"],
      relationStoreFilePath: asOptionalString(options.relationStoreFile),
      graphEmbeddingMethod:
        asOptionalString(options.graphEmbedding) as AppConfig["component"]["graphEmbeddingMethod"],
      relationExtractor:
        asOptionalString(options.relationExtractor) as AppConfig["component"]["relationExtractor"],
      relationModel: asOptionalString(options.relationModel),
      webDebugApiEnabled: parseOptionalBoolean(asOptionalString(options.webDebugApi)),
      webFileApiEnabled: parseOptionalBoolean(asOptionalString(options.webFileApi)),
      webExposeRawContext: parseOptionalBoolean(asOptionalString(options.webRawContext)),
      webAdminToken: asOptionalString(options.webAdminToken),
      webRequestBodyMaxBytes: parseOptionalNumber(asOptionalString(options.webBodyMaxBytes)),
      debugTraceEnabled: parseOptionalBoolean(asOptionalString(options.debugTrace)),
      debugTraceMaxEntries: parseOptionalNumber(asOptionalString(options.debugTraceMax))
    },
    manager: {
      maxTokensPerBlock: parseOptionalNumber(asOptionalString(options.maxTokens)),
      predictionEnabled: parseOptionalBoolean(asOptionalString(options.prediction)),
      searchAugmentMode: asOptionalString(options.searchMode) as AppConfig["manager"]["searchAugmentMode"],
      searchScheduleMinutes: parseOptionalNumber(asOptionalString(options.searchScheduleMinutes)),
      searchTopK: parseOptionalNumber(asOptionalString(options.searchTopk)),
      proactiveWakeupEnabled: parseOptionalBoolean(asOptionalString(options.proactiveWakeup)),
      proactiveWakeupMinIntervalSeconds: parseOptionalNumber(
        asOptionalString(options.proactiveMinIntervalSeconds)
      ),
      proactiveWakeupMaxPerHour: parseOptionalNumber(asOptionalString(options.proactiveMaxPerHour)),
      proactiveWakeupRequireEvidence: parseOptionalBoolean(
        asOptionalString(options.proactiveRequireEvidence)
      ),
      proactiveTimerEnabled: parseOptionalBoolean(asOptionalString(options.proactiveTimer)),
      proactiveTimerIntervalSeconds: parseOptionalNumber(
        asOptionalString(options.proactiveTimerIntervalSeconds)
      )
    }
  };
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.length > 0 ? value : undefined;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}

function parseOptionalCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

function formatFileList(entries: ReadonlyFileEntry[], pathInput: string): string {
  const header = `agent> readonly list: ${pathInput}\n`;
  if (entries.length === 0) {
    return `${header}(empty)\n`;
  }
  const lines = entries.map((entry) => {
    const prefix = entry.type === "dir" ? "[dir] " : entry.type === "file" ? "[file]" : "[other]";
    const sizePart = typeof entry.sizeBytes === "number" ? ` ${entry.sizeBytes}B` : "";
    return `${prefix} ${entry.path}${sizePart}`;
  });
  return `${header}${lines.join("\n")}\n`;
}

function formatFileRead(result: ReadFileResult): string {
  const meta = `agent> readonly read: ${result.path} (${result.bytes}/${result.totalBytes} bytes${result.truncated ? ", truncated" : ""})\n`;
  return `${meta}${result.text}\n`;
}

function sanitizeConfigForDisplay(config: AppConfig): AppConfig {
  return {
    ...config,
    service: {
      ...config.service,
      openaiApiKey: redactSecret(config.service.openaiApiKey),
      deepseekApiKey: redactSecret(config.service.deepseekApiKey)
    },
    component: {
      ...config.component,
      webAdminToken: redactSecret(config.component.webAdminToken)
    }
  };
}

function redactSecret(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length <= 4) return "***";
  if (value.length <= 8) return `${value.slice(0, 1)}***${value.slice(-1)}`;
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function clampAgents(value: unknown): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed)) return 3;
  return Math.min(5, Math.max(2, parsed));
}

function buildRoles(count: number): Array<{ name: string; instruction: string; systemPrompt: string }> {
  const templates = [
    {
      name: "Planner",
      systemPrompt: "You are a senior planner agent focused on decomposition and milestones.",
      instruction: "请重点输出执行计划、里程碑与优先级。"
    },
    {
      name: "Implementer",
      systemPrompt: "You are a senior implementation agent focused on technical execution.",
      instruction: "请重点输出可落地实现方案、接口与工程结构。"
    },
    {
      name: "Critic",
      systemPrompt: "You are a critical reviewer agent focused on risk and edge cases.",
      instruction: "请重点指出风险、失败模式、监控与回滚策略。"
    },
    {
      name: "Optimizer",
      systemPrompt: "You optimize for performance, cost and reliability trade-offs.",
      instruction: "请重点优化性能/成本/可靠性并给出取舍建议。"
    },
    {
      name: "Product",
      systemPrompt: "You focus on product value, usability, and iteration planning.",
      instruction: "请重点补充产品化交互、验收标准与迭代建议。"
    }
  ];
  return templates.slice(0, count);
}

async function runSwarmWorkers(
  query: string,
  options: Record<string, unknown>,
  roles: Array<{ name: string; instruction: string; systemPrompt: string }>
): Promise<Array<{ role: string; text: string }>> {
  return Promise.all(
    roles.map(async (role) => {
      const runtime = createRuntime(buildRuntimeOverrides(options), {
        agentSystemPrompt: role.systemPrompt
      });
      try {
        const response = await runtime.agent.respond(`${role.instruction}\n\n任务：${query}`);
        return {
          role: role.name,
          text: response.text
        };
      } finally {
        await runtime.close();
      }
    })
  );
}

async function startWebServerWithFallback(
  host: string,
  preferredPort: number,
  runtimeOverrides: DeepPartial<AppConfig>
): Promise<Awaited<ReturnType<typeof startWebServer>>> {
  try {
    return await startWebServer({
      host,
      port: preferredPort,
      runtimeOverrides
    });
  } catch (error) {
    if (!isAddressInUse(error)) {
      throw error;
    }
    output.write(`Port ${preferredPort} is in use, falling back to a random port.\n`);
    return startWebServer({
      host,
      port: 0,
      runtimeOverrides
    });
  }
}

function isAddressInUse(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string };
  return candidate.code === "EADDRINUSE";
}
