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
import { createI18n } from "../i18n/index.js";
import type { Locale } from "../i18n/types.js";
import { MlexTuiApp } from "../tui/MlexTuiApp.js";
import { startWebServer } from "../web/server.js";

const locale: Locale = process.env.MLEX_LOCALE === "en-US" ? "en-US" : "zh-CN";
const i18n = createI18n({ locale });
const optionDescriptions = {
  host: i18n.t("cli.option.host"),
  port: i18n.t("cli.option.port"),
  provider: i18n.t("cli.option.provider"),
  model: i18n.t("cli.option.model"),
  chunkStrategy: i18n.t("cli.option.chunk_strategy"),
  storageBackend: i18n.t("cli.option.storage_backend"),
  sqliteFile: i18n.t("cli.option.sqlite_file"),
  lanceFile: i18n.t("cli.option.lance_file"),
  chromaBaseUrl: i18n.t("cli.option.chroma_base_url"),
  chromaCollection: i18n.t("cli.option.chroma_collection"),
  rawStoreBackend: i18n.t("cli.option.raw_store_backend"),
  rawStoreFile: i18n.t("cli.option.raw_store_file"),
  relationStoreBackend: i18n.t("cli.option.relation_store_backend"),
  relationStoreFile: i18n.t("cli.option.relation_store_file"),
  graphEmbedding: i18n.t("cli.option.graph_embedding"),
  relationExtractor: i18n.t("cli.option.relation_extractor"),
  relationModel: i18n.t("cli.option.relation_model"),
  searchEndpoint: i18n.t("cli.option.search_endpoint"),
  searchApiKey: i18n.t("cli.option.search_api_key"),
  webFetchEndpoint: i18n.t("cli.option.web_fetch_endpoint"),
  webFetchApiKey: i18n.t("cli.option.web_fetch_api_key"),
  searchMode: i18n.t("cli.option.search_mode"),
  searchScheduleMinutes: i18n.t("cli.option.search_schedule_minutes"),
  searchTopK: i18n.t("cli.option.search_topk"),
  searchSeeds: i18n.t("cli.option.search_seeds"),
  prediction: i18n.t("cli.option.prediction"),
  proactiveWakeup: i18n.t("cli.option.proactive_wakeup"),
  proactiveMinIntervalSeconds: i18n.t("cli.option.proactive_min_interval_seconds"),
  proactiveMaxPerHour: i18n.t("cli.option.proactive_max_per_hour"),
  proactiveRequireEvidence: i18n.t("cli.option.proactive_require_evidence"),
  proactiveTimer: i18n.t("cli.option.proactive_timer"),
  proactiveTimerIntervalSeconds: i18n.t("cli.option.proactive_timer_interval_seconds"),
  webDebugApi: i18n.t("cli.option.web_debug_api"),
  webFileApi: i18n.t("cli.option.web_file_api"),
  webRawContext: i18n.t("cli.option.web_raw_context"),
  webAdminToken: i18n.t("cli.option.web_admin_token"),
  webBodyMaxBytes: i18n.t("cli.option.web_body_max_bytes"),
  debugTrace: i18n.t("cli.option.debug_trace"),
  debugTraceMax: i18n.t("cli.option.debug_trace_max"),
  stream: i18n.t("cli.option.stream"),
  maxTokens: i18n.t("cli.option.max_tokens"),
  showContext: i18n.t("cli.option.show_context"),
  maxEntries: i18n.t("cli.option.max_entries"),
  maxBytes: i18n.t("cli.option.max_bytes"),
  agents: i18n.t("cli.option.agents"),
  showDrafts: i18n.t("cli.option.show_drafts")
};

const program = new Command();


program
  .name("mlex")
  .description(i18n.t("cli.description.main"))
  .version("0.2.0")
  .addHelpText("after", i18n.t("cli.help.precedence"));

program
  .command("web")
  .description(i18n.t("cli.web.description"))
  .option("--host <host>", optionDescriptions.host, "127.0.0.1")
  .option("--port <number>", optionDescriptions.port, "8787")
  .option("--provider <provider>", optionDescriptions.provider)
  .option("--model <model>", optionDescriptions.model)
  .option("--chunk-strategy <strategy>", optionDescriptions.chunkStrategy)
  .option("--storage-backend <backend>", optionDescriptions.storageBackend)
  .option("--sqlite-file <path>", optionDescriptions.sqliteFile)
  .option("--lance-file <path>", optionDescriptions.lanceFile)
  .option("--raw-store-backend <backend>", optionDescriptions.rawStoreBackend)
  .option("--raw-store-file <path>", optionDescriptions.rawStoreFile)
  .option("--relation-store-backend <backend>", optionDescriptions.relationStoreBackend)
  .option("--relation-store-file <path>", optionDescriptions.relationStoreFile)
  .option("--graph-embedding <method>", optionDescriptions.graphEmbedding)
  .option("--relation-extractor <kind>", optionDescriptions.relationExtractor)
  .option("--relation-model <model>", optionDescriptions.relationModel)
  .option("--search-endpoint <url>", optionDescriptions.searchEndpoint)
  .option("--search-api-key <key>", optionDescriptions.searchApiKey)
  .option("--web-fetch-endpoint <url>", optionDescriptions.webFetchEndpoint)
  .option("--web-fetch-api-key <key>", optionDescriptions.webFetchApiKey)
  .option("--search-mode <mode>", optionDescriptions.searchMode)
  .option("--search-schedule-minutes <number>", optionDescriptions.searchScheduleMinutes)
  .option("--search-topk <number>", optionDescriptions.searchTopK)
  .option("--search-seeds <csv>", optionDescriptions.searchSeeds)
  .option("--prediction <enabled>", optionDescriptions.prediction)
  .option("--proactive-wakeup <enabled>", optionDescriptions.proactiveWakeup)
  .option("--proactive-min-interval-seconds <number>", optionDescriptions.proactiveMinIntervalSeconds)
  .option("--proactive-max-per-hour <number>", optionDescriptions.proactiveMaxPerHour)
  .option("--proactive-require-evidence <enabled>", optionDescriptions.proactiveRequireEvidence)
  .option("--proactive-timer <enabled>", optionDescriptions.proactiveTimer)
  .option("--proactive-timer-interval-seconds <number>", optionDescriptions.proactiveTimerIntervalSeconds)
  .option("--web-debug-api <enabled>", optionDescriptions.webDebugApi)
  .option("--web-file-api <enabled>", optionDescriptions.webFileApi)
  .option("--web-raw-context <enabled>", optionDescriptions.webRawContext)
  .option("--web-admin-token <token>", optionDescriptions.webAdminToken)
  .option("--web-body-max-bytes <number>", optionDescriptions.webBodyMaxBytes)
  .option("--debug-trace <enabled>", optionDescriptions.debugTrace)
  .option("--debug-trace-max <number>", optionDescriptions.debugTraceMax)
  .action(async (options) => {
    const host = asOptionalString(options.host) ?? "127.0.0.1";
    const preferredPort = parseOptionalNumber(asOptionalString(options.port)) ?? 8787;
    const started = await startWebServerWithFallback(host, preferredPort, buildRuntimeOverrides(options));
    output.write(`${i18n.t("cli.web.running", { url: started.url })}\n`);
    output.write(`${i18n.t("cli.web.stop_hint")}\n`);

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
  .description(i18n.t("cli.files.list.description"))
  .argument("[path]", i18n.t("cli.files.list.arg_path"), ".")
  .option("--max-entries <number>", optionDescriptions.maxEntries, "200")
  .action(async (pathInput: string, options) => {
    const fileService = new ReadonlyFileService({ rootPath: process.cwd() });
    const maxEntries = parseOptionalNumber(asOptionalString(options.maxEntries));
    const entries = await fileService.list(pathInput, maxEntries);
    output.write(formatFileList(entries, pathInput));
  });

program
  .command("files:read")
  .description(i18n.t("cli.files.read.description"))
  .argument("<path>", i18n.t("cli.files.read.arg_path"))
  .option("--max-bytes <number>", optionDescriptions.maxBytes, "65536")
  .action(async (pathInput: string, options) => {
    const fileService = new ReadonlyFileService({ rootPath: process.cwd() });
    const maxBytes = parseOptionalNumber(asOptionalString(options.maxBytes));
    const result = await fileService.read(pathInput, maxBytes);
    output.write(formatFileRead(result));
  });


program
  .command("chat")
  .description(i18n.t("cli.chat.description"))
  .option("--provider <provider>", optionDescriptions.provider)
  .option("--model <model>", optionDescriptions.model)
  .option("--stream", optionDescriptions.stream, false)
  .option("--max-tokens <number>", optionDescriptions.maxTokens)
  .option("--chunk-strategy <strategy>", optionDescriptions.chunkStrategy)
  .option("--storage-backend <backend>", optionDescriptions.storageBackend)
  .option("--sqlite-file <path>", optionDescriptions.sqliteFile)
  .option("--lance-file <path>", optionDescriptions.lanceFile)
  .option("--chroma-base-url <url>", optionDescriptions.chromaBaseUrl)
  .option("--chroma-collection <id>", optionDescriptions.chromaCollection)
  .option("--raw-store-backend <backend>", optionDescriptions.rawStoreBackend)
  .option("--raw-store-file <path>", optionDescriptions.rawStoreFile)
  .option("--relation-store-backend <backend>", optionDescriptions.relationStoreBackend)
  .option("--relation-store-file <path>", optionDescriptions.relationStoreFile)
  .option("--graph-embedding <method>", optionDescriptions.graphEmbedding)
  .option("--relation-extractor <kind>", optionDescriptions.relationExtractor)
  .option("--relation-model <model>", optionDescriptions.relationModel)
  .option("--search-endpoint <url>", optionDescriptions.searchEndpoint)
  .option("--search-api-key <key>", optionDescriptions.searchApiKey)
  .option("--web-fetch-endpoint <url>", optionDescriptions.webFetchEndpoint)
  .option("--web-fetch-api-key <key>", optionDescriptions.webFetchApiKey)
  .option("--search-mode <mode>", optionDescriptions.searchMode)
  .option("--search-schedule-minutes <number>", optionDescriptions.searchScheduleMinutes)
  .option("--search-topk <number>", optionDescriptions.searchTopK)
  .option("--search-seeds <csv>", optionDescriptions.searchSeeds)
  .option("--prediction <enabled>", optionDescriptions.prediction)
  .option("--proactive-wakeup <enabled>", optionDescriptions.proactiveWakeup)
  .option("--proactive-min-interval-seconds <number>", optionDescriptions.proactiveMinIntervalSeconds)
  .option("--proactive-max-per-hour <number>", optionDescriptions.proactiveMaxPerHour)
  .option("--proactive-require-evidence <enabled>", optionDescriptions.proactiveRequireEvidence)
  .option("--proactive-timer <enabled>", optionDescriptions.proactiveTimer)
  .option("--proactive-timer-interval-seconds <number>", optionDescriptions.proactiveTimerIntervalSeconds)
  .option("--show-context", optionDescriptions.showContext, false)
  .option("--debug-trace <enabled>", optionDescriptions.debugTrace)
  .option("--debug-trace-max <number>", optionDescriptions.debugTraceMax)
  .action(async (options) => {
    const runtime = createRuntime(buildRuntimeOverrides(options));
    const fileService = new ReadonlyFileService({ rootPath: process.cwd() });
    const traceRecorder = runtime.container.resolve<IDebugTraceRecorder>("debugTraceRecorder");
    const tui = new MlexTuiApp({
      runtime,
      i18n: runtime.container.resolve("i18n"),
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
  .description(i18n.t("cli.ingest.description"))
  .argument("<file>", i18n.t("cli.ingest.arg_file"))
  .option("--provider <provider>", optionDescriptions.provider, "rule-based")
  .option("--model <model>", optionDescriptions.model)
  .option("--storage-backend <backend>", optionDescriptions.storageBackend, "sqlite")
  .option("--sqlite-file <path>", optionDescriptions.sqliteFile)
  .option("--lance-file <path>", optionDescriptions.lanceFile)
  .option("--raw-store-backend <backend>", optionDescriptions.rawStoreBackend)
  .option("--raw-store-file <path>", optionDescriptions.rawStoreFile)
  .option("--relation-store-backend <backend>", optionDescriptions.relationStoreBackend)
  .option("--relation-store-file <path>", optionDescriptions.relationStoreFile)
  .option("--graph-embedding <method>", optionDescriptions.graphEmbedding)
  .option("--relation-extractor <kind>", optionDescriptions.relationExtractor)
  .option("--relation-model <model>", optionDescriptions.relationModel)
  .option("--search-endpoint <url>", optionDescriptions.searchEndpoint)
  .option("--search-api-key <key>", optionDescriptions.searchApiKey)
  .option("--web-fetch-endpoint <url>", optionDescriptions.webFetchEndpoint)
  .option("--web-fetch-api-key <key>", optionDescriptions.webFetchApiKey)
  .option("--search-mode <mode>", optionDescriptions.searchMode)
  .option("--search-schedule-minutes <number>", optionDescriptions.searchScheduleMinutes)
  .option("--search-topk <number>", optionDescriptions.searchTopK)
  .option("--search-seeds <csv>", optionDescriptions.searchSeeds)
  .option("--prediction <enabled>", optionDescriptions.prediction)
  .option("--proactive-wakeup <enabled>", optionDescriptions.proactiveWakeup)
  .option("--proactive-min-interval-seconds <number>", optionDescriptions.proactiveMinIntervalSeconds)
  .option("--proactive-max-per-hour <number>", optionDescriptions.proactiveMaxPerHour)
  .option("--proactive-require-evidence <enabled>", optionDescriptions.proactiveRequireEvidence)
  .option("--proactive-timer <enabled>", optionDescriptions.proactiveTimer)
  .option("--proactive-timer-interval-seconds <number>", optionDescriptions.proactiveTimerIntervalSeconds)
  .action(async (file: string, options) => {
    const runtime = createRuntime(buildRuntimeOverrides(options));
    try {
      const content = await readFile(file, "utf8");
      const segments = content
        .split(/\n{2,}/)
        .map((line) => line.trim())
        .filter(Boolean);

      for (const segment of segments) {
        await runtime.agent.respond(i18n.t("cli.ingest.prompt", { segment }));
      }
      await runtime.agent.sealMemory();
      output.write(`${i18n.t("cli.ingest.done", { count: segments.length })}\n`);
    } finally {
      await runtime.close();
    }
  });


program
  .command("ask")
  .description(i18n.t("cli.ask.description"))
  .argument("<query>", i18n.t("cli.ask.arg_query"))
  .option("--provider <provider>", optionDescriptions.provider)
  .option("--model <model>", optionDescriptions.model)
  .option("--stream", optionDescriptions.stream, false)
  .option("--storage-backend <backend>", optionDescriptions.storageBackend)
  .option("--sqlite-file <path>", optionDescriptions.sqliteFile)
  .option("--lance-file <path>", optionDescriptions.lanceFile)
  .option("--raw-store-backend <backend>", optionDescriptions.rawStoreBackend)
  .option("--raw-store-file <path>", optionDescriptions.rawStoreFile)
  .option("--relation-store-backend <backend>", optionDescriptions.relationStoreBackend)
  .option("--relation-store-file <path>", optionDescriptions.relationStoreFile)
  .option("--graph-embedding <method>", optionDescriptions.graphEmbedding)
  .option("--relation-extractor <kind>", optionDescriptions.relationExtractor)
  .option("--relation-model <model>", optionDescriptions.relationModel)
  .option("--search-endpoint <url>", optionDescriptions.searchEndpoint)
  .option("--search-api-key <key>", optionDescriptions.searchApiKey)
  .option("--web-fetch-endpoint <url>", optionDescriptions.webFetchEndpoint)
  .option("--web-fetch-api-key <key>", optionDescriptions.webFetchApiKey)
  .option("--search-mode <mode>", optionDescriptions.searchMode)
  .option("--search-schedule-minutes <number>", optionDescriptions.searchScheduleMinutes)
  .option("--search-topk <number>", optionDescriptions.searchTopK)
  .option("--search-seeds <csv>", optionDescriptions.searchSeeds)
  .option("--prediction <enabled>", optionDescriptions.prediction)
  .option("--proactive-wakeup <enabled>", optionDescriptions.proactiveWakeup)
  .option("--proactive-min-interval-seconds <number>", optionDescriptions.proactiveMinIntervalSeconds)
  .option("--proactive-max-per-hour <number>", optionDescriptions.proactiveMaxPerHour)
  .option("--proactive-require-evidence <enabled>", optionDescriptions.proactiveRequireEvidence)
  .option("--proactive-timer <enabled>", optionDescriptions.proactiveTimer)
  .option("--proactive-timer-interval-seconds <number>", optionDescriptions.proactiveTimerIntervalSeconds)
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
  .description(i18n.t("cli.swarm.description"))
  .argument("<query>", i18n.t("cli.swarm.arg_query"))
  .option("--provider <provider>", optionDescriptions.provider)
  .option("--model <model>", optionDescriptions.model)
  .option("--agents <number>", optionDescriptions.agents, "3")
  .option("--no-show-drafts", optionDescriptions.showDrafts)
  .option("--storage-backend <backend>", optionDescriptions.storageBackend)
  .option("--sqlite-file <path>", optionDescriptions.sqliteFile)
  .option("--lance-file <path>", optionDescriptions.lanceFile)
  .option("--raw-store-backend <backend>", optionDescriptions.rawStoreBackend)
  .option("--raw-store-file <path>", optionDescriptions.rawStoreFile)
  .option("--relation-store-backend <backend>", optionDescriptions.relationStoreBackend)
  .option("--relation-store-file <path>", optionDescriptions.relationStoreFile)
  .option("--graph-embedding <method>", optionDescriptions.graphEmbedding)
  .option("--relation-extractor <kind>", optionDescriptions.relationExtractor)
  .option("--relation-model <model>", optionDescriptions.relationModel)
  .option("--search-endpoint <url>", optionDescriptions.searchEndpoint)
  .option("--search-api-key <key>", optionDescriptions.searchApiKey)
  .option("--web-fetch-endpoint <url>", optionDescriptions.webFetchEndpoint)
  .option("--web-fetch-api-key <key>", optionDescriptions.webFetchApiKey)
  .option("--search-mode <mode>", optionDescriptions.searchMode)
  .option("--search-schedule-minutes <number>", optionDescriptions.searchScheduleMinutes)
  .option("--search-topk <number>", optionDescriptions.searchTopK)
  .option("--search-seeds <csv>", optionDescriptions.searchSeeds)
  .option("--prediction <enabled>", optionDescriptions.prediction)
  .option("--proactive-wakeup <enabled>", optionDescriptions.proactiveWakeup)
  .option("--proactive-min-interval-seconds <number>", optionDescriptions.proactiveMinIntervalSeconds)
  .option("--proactive-max-per-hour <number>", optionDescriptions.proactiveMaxPerHour)
  .option("--proactive-require-evidence <enabled>", optionDescriptions.proactiveRequireEvidence)
  .option("--proactive-timer <enabled>", optionDescriptions.proactiveTimer)
  .option("--proactive-timer-interval-seconds <number>", optionDescriptions.proactiveTimerIntervalSeconds)
  .action(async (query: string, options) => {
    const workerCount = clampAgents(options.agents);
    const roles = buildRoles(workerCount);
    const workerResults = await runSwarmWorkers(query, options, roles);

    if (options.showDrafts) {
      for (const item of workerResults) {
        output.write(`${i18n.t("cli.swarm.draft_title", { role: item.role, text: item.text })}\n`);
      }
    }

    const synthesisPrompt = [
      i18n.t("cli.swarm.synthesis.intro"),
      ...workerResults.map((item, index) =>
        i18n.t("cli.swarm.synthesis.worker", { index: index + 1, role: item.role, text: item.text })
      ),
      i18n.t("cli.swarm.synthesis.original", { query }),
      i18n.t("cli.swarm.synthesis.format")
    ].join("\n");

    const coordinator = createRuntime(buildRuntimeOverrides(options), {
      agentSystemPrompt: i18n.t("cli.swarm.coordinator_prompt")
    });
    try {
      const final = await coordinator.agent.respond(synthesisPrompt);
      output.write(`${i18n.t("cli.swarm.coordinator_title")}\n${final.text}\n`);
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
  const header = `${i18n.t("cli.files.list.header", { path: pathInput })}\n`;
  if (entries.length === 0) {
    return `${header}${i18n.t("cli.files.list.empty")}\n`;
  }
  const lines = entries.map((entry) => {
    const prefix =
      entry.type === "dir"
        ? i18n.t("cli.files.list.type.dir")
        : entry.type === "file"
          ? i18n.t("cli.files.list.type.file")
          : i18n.t("cli.files.list.type.other");
    const sizePart = typeof entry.sizeBytes === "number" ? i18n.t("cli.files.list.size", { size: entry.sizeBytes }) : "";
    return `${prefix} ${entry.path}${sizePart}`;
  });
  return `${header}${lines.join("\n")}\n`;
}

function formatFileRead(result: ReadFileResult): string {
  const meta =
    `${i18n.t("cli.files.read.meta", {
      path: result.path,
      bytes: result.bytes,
      totalBytes: result.totalBytes,
      truncated: result.truncated ? i18n.t("cli.files.read.truncated") : ""
    })}\n`;
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
      name: i18n.t("cli.swarm.role.planner"),
      systemPrompt: i18n.t("cli.swarm.role_prompt.planner"),
      instruction: i18n.t("cli.swarm.instruction.plan")
    },
    {
      name: i18n.t("cli.swarm.role.implementer"),
      systemPrompt: i18n.t("cli.swarm.role_prompt.implementer"),
      instruction: i18n.t("cli.swarm.instruction.arch")
    },
    {
      name: i18n.t("cli.swarm.role.critic"),
      systemPrompt: i18n.t("cli.swarm.role_prompt.critic"),
      instruction: i18n.t("cli.swarm.instruction.risk")
    },
    {
      name: i18n.t("cli.swarm.role.optimizer"),
      systemPrompt: i18n.t("cli.swarm.role_prompt.optimizer"),
      instruction: i18n.t("cli.swarm.instruction.performance")
    },
    {
      name: i18n.t("cli.swarm.role.product"),
      systemPrompt: i18n.t("cli.swarm.role_prompt.product"),
      instruction: i18n.t("cli.swarm.instruction.product")
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
        const response = await runtime.agent.respond(i18n.t("cli.swarm.task_prefix", {
          instruction: role.instruction,
          query
        }));
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
    output.write(`${i18n.t("cli.web.port_fallback", { port: preferredPort })}\n`);
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
