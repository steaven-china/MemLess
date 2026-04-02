#!/usr/bin/env node
import { Command } from "commander";
import packageJson from "../../package.json" with { type: "json" };
import { readFile } from "node:fs/promises";
import { stdout as output } from "node:process";

import { createRuntime } from "../container.js";
import type { RuntimeOptions } from "../container.js";
import type { DeepPartial, AppConfig } from "../config.js";
import { ensureDefaultUserConfigFiles } from "../config/toml.js";
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
import {
  isSupportedEventRole,
  isSupportedIngestFormat,
  isSupportedIngestTextSplit,
  parseIngestContent
} from "./importer.js";
import type { EventRole } from "../types.js";

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
  lanceDbPath: i18n.t("cli.option.lance_db_path"),
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
  topicShiftTrigger: i18n.t("cli.option.topic_shift_trigger"),
  topicShiftMinKeywords: i18n.t("cli.option.topic_shift_min_keywords"),
  topicShiftMinTokens: i18n.t("cli.option.topic_shift_min_tokens"),
  topicShiftQuerySimilaritySoftMax: i18n.t("cli.option.topic_shift_query_similarity_soft_max"),
  topicShiftQuerySimilarityHardMax: i18n.t("cli.option.topic_shift_query_similarity_hard_max"),
  topicShiftKeywordOverlapSoftMax: i18n.t("cli.option.topic_shift_keyword_overlap_soft_max"),
  topicShiftKeywordOverlapHardMax: i18n.t("cli.option.topic_shift_keyword_overlap_hard_max"),
  topicShiftRetrievalOverlapSoftMax: i18n.t("cli.option.topic_shift_retrieval_overlap_soft_max"),
  topicShiftRetrievalOverlapHardMax: i18n.t("cli.option.topic_shift_retrieval_overlap_hard_max"),
  topicShiftSoftCooldownSeconds: i18n.t("cli.option.topic_shift_soft_cooldown_seconds"),
  topicShiftHardCooldownSeconds: i18n.t("cli.option.topic_shift_hard_cooldown_seconds"),
  chunkManifestEnabled: i18n.t("cli.option.chunk_manifest_enabled"),
  chunkAffectsRetrieval: i18n.t("cli.option.chunk_affects_retrieval"),
  chunkManifestTargetTokens: i18n.t("cli.option.chunk_manifest_target_tokens"),
  chunkManifestMaxTokens: i18n.t("cli.option.chunk_manifest_max_tokens"),
  chunkManifestMaxBlocks: i18n.t("cli.option.chunk_manifest_max_blocks"),
  chunkManifestMaxGapMs: i18n.t("cli.option.chunk_manifest_max_gap_ms"),
  chunkNeighborExpandEnabled: i18n.t("cli.option.chunk_neighbor_expand_enabled"),
  chunkNeighborWindow: i18n.t("cli.option.chunk_neighbor_window"),
  chunkNeighborScoreGate: i18n.t("cli.option.chunk_neighbor_score_gate"),
  chunkMaxExpandedBlocks: i18n.t("cli.option.chunk_max_expanded_blocks"),
  webDebugApi: i18n.t("cli.option.web_debug_api"),
  webFileApi: i18n.t("cli.option.web_file_api"),
  webRawContext: i18n.t("cli.option.web_raw_context"),
  webAdminToken: i18n.t("cli.option.web_admin_token"),
  webBodyMaxBytes: i18n.t("cli.option.web_body_max_bytes"),
  debugTrace: i18n.t("cli.option.debug_trace"),
  debugTraceMax: i18n.t("cli.option.debug_trace_max"),
  hybridPrescreenRatio: i18n.t("cli.option.hybrid_prescreen_ratio"),
  hybridPrescreenMin: i18n.t("cli.option.hybrid_prescreen_min"),
  hybridPrescreenMax: i18n.t("cli.option.hybrid_prescreen_max"),
  hybridRerankMultiplier: i18n.t("cli.option.hybrid_rerank_multiplier"),
  hybridRerankHardCap: i18n.t("cli.option.hybrid_rerank_hard_cap"),
  hybridHashEarlyStopMinGap: i18n.t("cli.option.hybrid_hash_early_stop_min_gap"),
  hybridLocalRerankTimeoutMs: i18n.t("cli.option.hybrid_local_rerank_timeout_ms"),
  hybridRerankTextMaxChars: i18n.t("cli.option.hybrid_rerank_text_max_chars"),
  hybridLocalCacheMax: i18n.t("cli.option.hybrid_local_cache_max"),
  hybridLocalCacheTtlMs: i18n.t("cli.option.hybrid_local_cache_ttl_ms"),
  localEmbedBatchWindowMs: i18n.t("cli.option.local_embed_batch_window_ms"),
  localEmbedMaxBatchSize: i18n.t("cli.option.local_embed_max_batch_size"),
  localEmbedQueueMaxPending: i18n.t("cli.option.local_embed_queue_max_pending"),
  localEmbedExecutionProvider: i18n.t("cli.option.local_embed_execution_provider"),
  stream: i18n.t("cli.option.stream"),
  maxTokens: i18n.t("cli.option.max_tokens"),
  showContext: i18n.t("cli.option.show_context"),
  maxEntries: i18n.t("cli.option.max_entries"),
  maxBytes: i18n.t("cli.option.max_bytes"),
  agents: i18n.t("cli.option.agents"),
  showDrafts: i18n.t("cli.option.show_drafts"),
  includeTagsIntro: i18n.t("cli.option.include_tags_intro"),
  tagsIntro: i18n.t("cli.option.tags_intro"),
  tagsToml: i18n.t("cli.option.tags_toml"),
  tagsVars: i18n.t("cli.option.tags_vars"),
  ingestFormat: i18n.t("cli.option.ingest_format"),
  ingestTextField: i18n.t("cli.option.ingest_text_field"),
  ingestRoleField: i18n.t("cli.option.ingest_role_field"),
  ingestTimeField: i18n.t("cli.option.ingest_time_field"),
  ingestDefaultRole: i18n.t("cli.option.ingest_default_role"),
  ingestTextSplit: i18n.t("cli.option.ingest_text_split"),
  ingestSealEvery: i18n.t("cli.option.ingest_seal_every"),
  ingestMaxRecords: i18n.t("cli.option.ingest_max_records"),
  ingestDryRun: i18n.t("cli.option.ingest_dry_run")
};

const program = new Command();

ensureDefaultUserConfigFiles();

program
  .name("mlex")
  .description(i18n.t("cli.description.main"))
  .version(packageJson.version)
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
  .option("--lance-db-path <path>", optionDescriptions.lanceDbPath)
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
  .option("--topic-shift-trigger <enabled>", optionDescriptions.topicShiftTrigger)
  .option("--topic-shift-min-keywords <number>", optionDescriptions.topicShiftMinKeywords)
  .option("--topic-shift-min-tokens <number>", optionDescriptions.topicShiftMinTokens)
  .option(
    "--topic-shift-query-similarity-soft-max <number>",
    optionDescriptions.topicShiftQuerySimilaritySoftMax
  )
  .option(
    "--topic-shift-query-similarity-hard-max <number>",
    optionDescriptions.topicShiftQuerySimilarityHardMax
  )
  .option(
    "--topic-shift-keyword-overlap-soft-max <number>",
    optionDescriptions.topicShiftKeywordOverlapSoftMax
  )
  .option(
    "--topic-shift-keyword-overlap-hard-max <number>",
    optionDescriptions.topicShiftKeywordOverlapHardMax
  )
  .option(
    "--topic-shift-retrieval-overlap-soft-max <number>",
    optionDescriptions.topicShiftRetrievalOverlapSoftMax
  )
  .option(
    "--topic-shift-retrieval-overlap-hard-max <number>",
    optionDescriptions.topicShiftRetrievalOverlapHardMax
  )
  .option(
    "--topic-shift-soft-cooldown-seconds <number>",
    optionDescriptions.topicShiftSoftCooldownSeconds
  )
  .option(
    "--topic-shift-hard-cooldown-seconds <number>",
    optionDescriptions.topicShiftHardCooldownSeconds
  )
  .option("--chunk-manifest-enabled <enabled>", optionDescriptions.chunkManifestEnabled)
  .option("--chunk-affects-retrieval <enabled>", optionDescriptions.chunkAffectsRetrieval)
  .option("--chunk-manifest-target-tokens <number>", optionDescriptions.chunkManifestTargetTokens)
  .option("--chunk-manifest-max-tokens <number>", optionDescriptions.chunkManifestMaxTokens)
  .option("--chunk-manifest-max-blocks <number>", optionDescriptions.chunkManifestMaxBlocks)
  .option("--chunk-manifest-max-gap-ms <number>", optionDescriptions.chunkManifestMaxGapMs)
  .option("--chunk-neighbor-expand-enabled <enabled>", optionDescriptions.chunkNeighborExpandEnabled)
  .option("--chunk-neighbor-window <number>", optionDescriptions.chunkNeighborWindow)
  .option("--chunk-neighbor-score-gate <number>", optionDescriptions.chunkNeighborScoreGate)
  .option("--chunk-max-expanded-blocks <number>", optionDescriptions.chunkMaxExpandedBlocks)
  .option("--web-debug-api <enabled>", optionDescriptions.webDebugApi)
  .option("--web-file-api <enabled>", optionDescriptions.webFileApi)
  .option("--web-raw-context <enabled>", optionDescriptions.webRawContext)
  .option("--web-admin-token <token>", optionDescriptions.webAdminToken)
  .option("--web-body-max-bytes <number>", optionDescriptions.webBodyMaxBytes)
  .option("--debug-trace <enabled>", optionDescriptions.debugTrace)
  .option("--debug-trace-max <number>", optionDescriptions.debugTraceMax)
  .option("--hybrid-prescreen-ratio <number>", optionDescriptions.hybridPrescreenRatio)
  .option("--hybrid-prescreen-min <number>", optionDescriptions.hybridPrescreenMin)
  .option("--hybrid-prescreen-max <number>", optionDescriptions.hybridPrescreenMax)
  .option("--hybrid-rerank-multiplier <number>", optionDescriptions.hybridRerankMultiplier)
  .option("--hybrid-rerank-hard-cap <number>", optionDescriptions.hybridRerankHardCap)
  .option(
    "--hybrid-hash-early-stop-min-gap <number>",
    optionDescriptions.hybridHashEarlyStopMinGap
  )
  .option(
    "--hybrid-local-rerank-timeout-ms <number>",
    optionDescriptions.hybridLocalRerankTimeoutMs
  )
  .option(
    "--hybrid-rerank-text-max-chars <number>",
    optionDescriptions.hybridRerankTextMaxChars
  )
  .option("--hybrid-local-cache-max <number>", optionDescriptions.hybridLocalCacheMax)
  .option("--hybrid-local-cache-ttl-ms <number>", optionDescriptions.hybridLocalCacheTtlMs)
  .option("--local-embed-batch-window-ms <number>", optionDescriptions.localEmbedBatchWindowMs)
  .option("--local-embed-max-batch-size <number>", optionDescriptions.localEmbedMaxBatchSize)
  .option("--local-embed-queue-max-pending <number>", optionDescriptions.localEmbedQueueMaxPending)
  .option("--local-embed-execution-provider <provider>", optionDescriptions.localEmbedExecutionProvider)
  .option("--include-tags-intro <enabled>", optionDescriptions.includeTagsIntro)
  .option("--tags-intro <path>", optionDescriptions.tagsIntro)
  .option("--tags-toml <path>", optionDescriptions.tagsToml)
  .option("--tags-vars <csv>", optionDescriptions.tagsVars)
  .action(async (options) => {
    const host = asOptionalString(options.host) ?? "127.0.0.1";
    const preferredPort = parseOptionalNumber(asOptionalString(options.port)) ?? 8787;
    const started = await startWebServerWithFallback(
      host,
      preferredPort,
      buildRuntimeOverrides(options),
      buildRuntimeOptions(options)
    );
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
  .option("--max-bytes <number>", optionDescriptions.maxBytes)
  .action(async (pathInput: string, options) => {
    const fileService = new ReadonlyFileService({ rootPath: process.cwd() });
    const maxBytes = parseOptionalNumber(asOptionalString(options.maxBytes));
    const result = await fileService.read(pathInput, maxBytes);
    output.write(formatFileRead(result));
  });


program
  .command("chat")
  .description(i18n.t("cli.chat.description"))
  .option("--stream", optionDescriptions.stream, false)
  .option("--max-tokens <number>", optionDescriptions.maxTokens)
  .option("--show-context", optionDescriptions.showContext, false)
  .option("--debug-trace <enabled>", optionDescriptions.debugTrace)
  .option("--debug-trace-max <number>", optionDescriptions.debugTraceMax);
applyAgentRuntimeOptions(program.commands.at(-1)!);
program.commands
  .at(-1)!
  .action(async (options) => {
    const runtime = createRuntime(buildRuntimeOverrides(options), buildRuntimeOptions(options));
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
  .option("--format <format>", optionDescriptions.ingestFormat, "auto")
  .option("--text-field <name>", optionDescriptions.ingestTextField, "text")
  .option("--role-field <name>", optionDescriptions.ingestRoleField, "role")
  .option("--time-field <name>", optionDescriptions.ingestTimeField, "timestamp")
  .option("--default-role <role>", optionDescriptions.ingestDefaultRole, "user")
  .option("--text-split <mode>", optionDescriptions.ingestTextSplit, "paragraph")
  .option("--seal-every <number>", optionDescriptions.ingestSealEvery, "1")
  .option("--max-records <number>", optionDescriptions.ingestMaxRecords)
  .option("--dry-run", optionDescriptions.ingestDryRun, false);
applyAgentRuntimeOptions(program.commands.at(-1)!);
program.commands
  .at(-1)!
  .action(async (file: string, options) => {
    const startedAt = Date.now();
    const formatInput = (asOptionalString(options.format) ?? "auto").trim().toLowerCase();
    if (!isSupportedIngestFormat(formatInput)) {
      throw new Error(i18n.t("cli.ingest.error.invalid_format", { format: formatInput }));
    }

    const defaultRoleInput = (asOptionalString(options.defaultRole) ?? "user").trim().toLowerCase();
    if (!isSupportedEventRole(defaultRoleInput)) {
      throw new Error(i18n.t("cli.ingest.error.invalid_default_role", { role: defaultRoleInput }));
    }

    const textSplitMode = (asOptionalString(options.textSplit) ?? "paragraph").trim().toLowerCase();
    if (!isSupportedIngestTextSplit(textSplitMode)) {
      throw new Error(i18n.t("cli.ingest.error.invalid_text_split", { mode: textSplitMode }));
    }

    const textField = asOptionalString(options.textField) ?? "text";
    const roleField = asOptionalString(options.roleField) ?? "role";
    const timeField = asOptionalString(options.timeField) ?? "timestamp";
    const sealEvery = Math.max(1, parseOptionalNumber(asOptionalString(options.sealEvery)) ?? 1);
    const maxRecords = parseOptionalNumber(asOptionalString(options.maxRecords));

    const content = await readFile(file, "utf8");
    const parsed = parseIngestContent({
      filePath: file,
      content,
      format: formatInput,
      textField,
      roleField,
      timeField,
      defaultRole: defaultRoleInput as EventRole,
      textSplitMode
    });

    let truncatedCount = 0;
    const records =
      maxRecords && maxRecords > 0
        ? (() => {
            truncatedCount = Math.max(0, parsed.records.length - maxRecords);
            return parsed.records.slice(0, maxRecords);
          })()
        : parsed.records;
    const skipped = parsed.skipped + truncatedCount;
    const warningLimit = 10;
    if (parsed.warnings.length > 0) {
      output.write(
        `${i18n.t("cli.ingest.warning_count", {
          count: parsed.warnings.length,
          shown: Math.min(warningLimit, parsed.warnings.length)
        })}\n`
      );
      for (const warning of parsed.warnings.slice(0, warningLimit)) {
        output.write(`${i18n.t("cli.ingest.warning_item", { message: warning })}\n`);
      }
    }

    if (Boolean(options.dryRun)) {
      output.write(
        `${i18n.t("cli.ingest.dry_run", {
          format: parsed.format,
          imported: records.length,
          skipped,
          elapsedMs: Date.now() - startedAt
        })}\n`
      );
      return;
    }

    const runtime = createRuntime(buildRuntimeOverrides(options), buildRuntimeOptions(options));
    try {
      let imported = 0;
      let sealed = 0;
      let pendingInBlock = 0;

      for (const record of records) {
        await runtime.memoryManager.addEvent(record);
        imported += 1;
        pendingInBlock += 1;

        if (pendingInBlock >= sealEvery) {
          await runtime.memoryManager.sealCurrentBlock();
          sealed += 1;
          pendingInBlock = 0;
        }
      }

      if (pendingInBlock > 0) {
        await runtime.memoryManager.sealCurrentBlock();
        sealed += 1;
      }

      output.write(
        `${i18n.t("cli.ingest.done", {
          format: parsed.format,
          imported,
          skipped,
          sealed,
          elapsedMs: Date.now() - startedAt
        })}\n`
      );
    } finally {
      await runtime.close();
    }
  });


program
  .command("ask")
  .description(i18n.t("cli.ask.description"))
  .argument("<query>", i18n.t("cli.ask.arg_query"))
  .option("--stream", optionDescriptions.stream, false);
applyAgentRuntimeOptions(program.commands.at(-1)!);
program.commands
  .at(-1)!
  .action(async (query: string, options) => {
    const runtime = createRuntime(buildRuntimeOverrides(options), buildRuntimeOptions(options));
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
  .option("--agents <number>", optionDescriptions.agents, "3")
  .option("--no-show-drafts", optionDescriptions.showDrafts);
applyAgentRuntimeOptions(program.commands.at(-1)!);
program.commands
  .at(-1)!
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
      ...buildRuntimeOptions(options),
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

function applyAgentRuntimeOptions(command: Command): void {
  command
    .option("--provider <provider>", optionDescriptions.provider)
    .option("--model <model>", optionDescriptions.model)
    .option("--chunk-strategy <strategy>", optionDescriptions.chunkStrategy)
    .option("--storage-backend <backend>", optionDescriptions.storageBackend)
    .option("--sqlite-file <path>", optionDescriptions.sqliteFile)
    .option("--lance-file <path>", optionDescriptions.lanceFile)
    .option("--lance-db-path <path>", optionDescriptions.lanceDbPath)
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
    .option("--topic-shift-trigger <enabled>", optionDescriptions.topicShiftTrigger)
    .option("--topic-shift-min-keywords <number>", optionDescriptions.topicShiftMinKeywords)
    .option("--topic-shift-min-tokens <number>", optionDescriptions.topicShiftMinTokens)
    .option(
      "--topic-shift-query-similarity-soft-max <number>",
      optionDescriptions.topicShiftQuerySimilaritySoftMax
    )
    .option(
      "--topic-shift-query-similarity-hard-max <number>",
      optionDescriptions.topicShiftQuerySimilarityHardMax
    )
    .option(
      "--topic-shift-keyword-overlap-soft-max <number>",
      optionDescriptions.topicShiftKeywordOverlapSoftMax
    )
    .option(
      "--topic-shift-keyword-overlap-hard-max <number>",
      optionDescriptions.topicShiftKeywordOverlapHardMax
    )
    .option(
      "--topic-shift-retrieval-overlap-soft-max <number>",
      optionDescriptions.topicShiftRetrievalOverlapSoftMax
    )
    .option(
      "--topic-shift-retrieval-overlap-hard-max <number>",
      optionDescriptions.topicShiftRetrievalOverlapHardMax
    )
    .option(
      "--topic-shift-soft-cooldown-seconds <number>",
      optionDescriptions.topicShiftSoftCooldownSeconds
    )
    .option(
      "--topic-shift-hard-cooldown-seconds <number>",
      optionDescriptions.topicShiftHardCooldownSeconds
    )
    .option("--chunk-manifest-enabled <enabled>", optionDescriptions.chunkManifestEnabled)
    .option("--chunk-affects-retrieval <enabled>", optionDescriptions.chunkAffectsRetrieval)
    .option("--chunk-manifest-target-tokens <number>", optionDescriptions.chunkManifestTargetTokens)
    .option("--chunk-manifest-max-tokens <number>", optionDescriptions.chunkManifestMaxTokens)
    .option("--chunk-manifest-max-blocks <number>", optionDescriptions.chunkManifestMaxBlocks)
    .option("--chunk-manifest-max-gap-ms <number>", optionDescriptions.chunkManifestMaxGapMs)
    .option(
      "--chunk-neighbor-expand-enabled <enabled>",
      optionDescriptions.chunkNeighborExpandEnabled
    )
    .option("--chunk-neighbor-window <number>", optionDescriptions.chunkNeighborWindow)
    .option("--chunk-neighbor-score-gate <number>", optionDescriptions.chunkNeighborScoreGate)
    .option("--chunk-max-expanded-blocks <number>", optionDescriptions.chunkMaxExpandedBlocks)
    .option("--hybrid-prescreen-ratio <number>", optionDescriptions.hybridPrescreenRatio)
    .option("--hybrid-prescreen-min <number>", optionDescriptions.hybridPrescreenMin)
    .option("--hybrid-prescreen-max <number>", optionDescriptions.hybridPrescreenMax)
    .option("--hybrid-rerank-multiplier <number>", optionDescriptions.hybridRerankMultiplier)
    .option("--hybrid-rerank-hard-cap <number>", optionDescriptions.hybridRerankHardCap)
    .option(
      "--hybrid-hash-early-stop-min-gap <number>",
      optionDescriptions.hybridHashEarlyStopMinGap
    )
    .option(
      "--hybrid-local-rerank-timeout-ms <number>",
      optionDescriptions.hybridLocalRerankTimeoutMs
    )
    .option(
      "--hybrid-rerank-text-max-chars <number>",
      optionDescriptions.hybridRerankTextMaxChars
    )
    .option("--hybrid-local-cache-max <number>", optionDescriptions.hybridLocalCacheMax)
    .option("--hybrid-local-cache-ttl-ms <number>", optionDescriptions.hybridLocalCacheTtlMs)
    .option("--local-embed-batch-window-ms <number>", optionDescriptions.localEmbedBatchWindowMs)
    .option("--local-embed-max-batch-size <number>", optionDescriptions.localEmbedMaxBatchSize)
    .option("--local-embed-queue-max-pending <number>", optionDescriptions.localEmbedQueueMaxPending)
    .option(
      "--local-embed-execution-provider <provider>",
      optionDescriptions.localEmbedExecutionProvider
    )
    .option("--include-tags-intro <enabled>", optionDescriptions.includeTagsIntro)
    .option("--tags-intro <path>", optionDescriptions.tagsIntro)
    .option("--tags-toml <path>", optionDescriptions.tagsToml)
    .option("--tags-vars <csv>", optionDescriptions.tagsVars);
}

function buildRuntimeOptions(options: Record<string, unknown>): RuntimeOptions {
  return {
    includeTagsIntro: parseOptionalBoolean(asOptionalString(options.includeTagsIntro)),
    tagsIntroPath: asOptionalString(options.tagsIntro),
    tagsTomlPath: asOptionalString(options.tagsToml),
    tagsTemplateVars: parseOptionalKvCsv(asOptionalString(options.tagsVars))
  };
}

function buildRuntimeOverrides(options: Record<string, unknown>): DeepPartial<AppConfig> {
  return {
    service: {
      provider: asOptionalString(options.provider) as AppConfig["service"]["provider"],
      openaiModel: asOptionalString(options.model),
      deepseekModel: asOptionalString(options.model),
      anthropicModel: asOptionalString(options.model),
      geminiModel: asOptionalString(options.model),
      openrouterModel: asOptionalString(options.model),
      azureOpenaiModel: asOptionalString(options.model),
      openaiCompatibleModel: asOptionalString(options.model)
    },
    component: {
      chunkStrategy: asOptionalString(options.chunkStrategy) as AppConfig["component"]["chunkStrategy"],
      storageBackend: asOptionalString(options.storageBackend) as AppConfig["component"]["storageBackend"],
      sqliteFilePath: asOptionalString(options.sqliteFile),
      lanceFilePath: asOptionalString(options.lanceFile),
      lanceDbPath: asOptionalString(options.lanceDbPath),
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
      debugTraceMaxEntries: parseOptionalNumber(asOptionalString(options.debugTraceMax)),
      localEmbedBatchWindowMs: parseOptionalNumber(asOptionalString(options.localEmbedBatchWindowMs)),
      localEmbedMaxBatchSize: parseOptionalNumber(asOptionalString(options.localEmbedMaxBatchSize)),
      localEmbedQueueMaxPending: parseOptionalNumber(asOptionalString(options.localEmbedQueueMaxPending)),
      localEmbedExecutionProvider: asOptionalString(options.localEmbedExecutionProvider)
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
      ),
      topicShiftTriggerEnabled: parseOptionalBoolean(asOptionalString(options.topicShiftTrigger)),
      topicShiftMinKeywords: parseOptionalNumber(asOptionalString(options.topicShiftMinKeywords)),
      topicShiftMinTokens: parseOptionalNumber(asOptionalString(options.topicShiftMinTokens)),
      topicShiftQuerySimilaritySoftMax: parseOptionalFloat(
        asOptionalString(options.topicShiftQuerySimilaritySoftMax)
      ),
      topicShiftQuerySimilarityHardMax: parseOptionalFloat(
        asOptionalString(options.topicShiftQuerySimilarityHardMax)
      ),
      topicShiftKeywordOverlapSoftMax: parseOptionalFloat(
        asOptionalString(options.topicShiftKeywordOverlapSoftMax)
      ),
      topicShiftKeywordOverlapHardMax: parseOptionalFloat(
        asOptionalString(options.topicShiftKeywordOverlapHardMax)
      ),
      topicShiftRetrievalOverlapSoftMax: parseOptionalFloat(
        asOptionalString(options.topicShiftRetrievalOverlapSoftMax)
      ),
      topicShiftRetrievalOverlapHardMax: parseOptionalFloat(
        asOptionalString(options.topicShiftRetrievalOverlapHardMax)
      ),
      topicShiftSoftCooldownSeconds: parseOptionalNumber(
        asOptionalString(options.topicShiftSoftCooldownSeconds)
      ),
      topicShiftHardCooldownSeconds: parseOptionalNumber(
        asOptionalString(options.topicShiftHardCooldownSeconds)
      ),
      chunkManifestEnabled: parseOptionalBoolean(asOptionalString(options.chunkManifestEnabled)),
      chunkAffectsRetrieval: parseOptionalBoolean(asOptionalString(options.chunkAffectsRetrieval)),
      chunkManifestTargetTokens: parseOptionalNumber(
        asOptionalString(options.chunkManifestTargetTokens)
      ),
      chunkManifestMaxTokens: parseOptionalNumber(asOptionalString(options.chunkManifestMaxTokens)),
      chunkManifestMaxBlocks: parseOptionalNumber(asOptionalString(options.chunkManifestMaxBlocks)),
      chunkManifestMaxGapMs: parseOptionalNumber(asOptionalString(options.chunkManifestMaxGapMs)),
      chunkNeighborExpandEnabled: parseOptionalBoolean(
        asOptionalString(options.chunkNeighborExpandEnabled)
      ),
      chunkNeighborWindow: parseOptionalNumber(asOptionalString(options.chunkNeighborWindow)),
      chunkNeighborScoreGate: parseOptionalFloat(asOptionalString(options.chunkNeighborScoreGate)),
      chunkMaxExpandedBlocks: parseOptionalNumber(
        asOptionalString(options.chunkMaxExpandedBlocks)
      ),
      hybridPrescreenRatio: parseOptionalFloat(asOptionalString(options.hybridPrescreenRatio)),
      hybridPrescreenMin: parseOptionalNumber(asOptionalString(options.hybridPrescreenMin)),
      hybridPrescreenMax: parseOptionalNumber(asOptionalString(options.hybridPrescreenMax)),
      hybridRerankMultiplier: parseOptionalFloat(asOptionalString(options.hybridRerankMultiplier)),
      hybridRerankHardCap: parseOptionalNumber(asOptionalString(options.hybridRerankHardCap)),
      hybridHashEarlyStopMinGap: parseOptionalFloat(
        asOptionalString(options.hybridHashEarlyStopMinGap)
      ),
      hybridLocalRerankTimeoutMs: parseOptionalNumber(
        asOptionalString(options.hybridLocalRerankTimeoutMs)
      ),
      hybridRerankTextMaxChars: parseOptionalNumber(
        asOptionalString(options.hybridRerankTextMaxChars)
      ),
      hybridLocalCacheMaxEntries: parseOptionalNumber(asOptionalString(options.hybridLocalCacheMax)),
      hybridLocalCacheTtlMs: parseOptionalNumber(asOptionalString(options.hybridLocalCacheTtlMs))
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

function parseOptionalFloat(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
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

function parseOptionalKvCsv(value: string | undefined): Record<string, string> | undefined {
  if (!value) return undefined;
  const output: Record<string, string> = {};
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  for (const item of items) {
    const index = item.indexOf("=");
    if (index <= 0) continue;
    const key = item.slice(0, index).trim();
    const rawValue = item.slice(index + 1).trim();
    if (!key) continue;
    output[key] = rawValue;
  }
  return Object.keys(output).length > 0 ? output : undefined;
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
      deepseekApiKey: redactSecret(config.service.deepseekApiKey),
      anthropicApiKey: redactSecret(config.service.anthropicApiKey),
      geminiApiKey: redactSecret(config.service.geminiApiKey),
      openrouterApiKey: redactSecret(config.service.openrouterApiKey),
      azureOpenaiApiKey: redactSecret(config.service.azureOpenaiApiKey),
      openaiCompatibleApiKey: redactSecret(config.service.openaiCompatibleApiKey)
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
        ...buildRuntimeOptions(options),
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
  runtimeOverrides: DeepPartial<AppConfig>,
  runtimeOptions: RuntimeOptions
): Promise<Awaited<ReturnType<typeof startWebServer>>> {
  try {
    return await startWebServer({
      host,
      port: preferredPort,
      runtimeOverrides,
      runtimeOptions
    });
  } catch (error) {
    if (!isAddressInUse(error)) {
      throw error;
    }
    output.write(`${i18n.t("cli.web.port_fallback", { port: preferredPort })}\n`);
    return startWebServer({
      host,
      port: 0,
      runtimeOverrides,
      runtimeOptions
    });
  }
}

function isAddressInUse(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string };
  return candidate.code === "EADDRINUSE";
}
