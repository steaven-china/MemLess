/**
 * scripts/bench-compare.ts
 *
 * Run benchmark suites with hash vs hybrid embedder and print a compact comparison.
 *
 * Usage:
 *   npx tsx scripts/bench-compare.ts
 *   npx tsx scripts/bench-compare.ts --quick
 *   npx tsx scripts/bench-compare.ts --concurrency=2 --max-cases=60
 *   npx tsx scripts/bench-compare.ts --report=.mlex/bench/custom-report.json
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type BenchSuiteKey = "semantic" | "crud";
type EmbedderMode = "hash" | "hybrid";

interface BenchSuite {
  key: BenchSuiteKey;
  label: string;
  testFile: string;
}

interface LatencyMetrics {
  ingestAvgMs: number;
  ingestP95Ms: number;
  queryAvgMs: number;
  queryP95Ms: number;
  totalAvgMs: number;
  totalP95Ms: number;
}

interface PassMetrics {
  passed: number;
  total: number;
  passRate: number;
}

interface BenchRunResult {
  suite: BenchSuiteKey;
  mode: EmbedderMode;
  command: string;
  durationMs: number;
  pass: PassMetrics;
  latency: LatencyMetrics;
}

interface CompareOptions {
  quick: boolean;
  concurrency?: number;
  maxCases?: number;
  categoryMaxCases?: number;
  reportPath: string;
  skipSemantic: boolean;
  skipCrud: boolean;
}

const SUITES: BenchSuite[] = [
  {
    key: "semantic",
    label: "Semantic",
    testFile: "test/eval.semantic.bench.ts"
  },
  {
    key: "crud",
    label: "CRUD-RAG",
    testFile: "test/eval.crud_rag.bench.ts"
  }
];

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const suites = SUITES.filter((suite) => {
    if (suite.key === "semantic" && options.skipSemantic) return false;
    if (suite.key === "crud" && options.skipCrud) return false;
    return true;
  });
  if (suites.length === 0) {
    throw new Error("No benchmark suites selected. Remove --skip-semantic/--skip-crud.");
  }

  const startedAt = new Date();
  const baseEnv = buildBaseEnv(options);
  const results: BenchRunResult[] = [];

  for (const suite of suites) {
    results.push(await runSuite(suite, "hash", baseEnv, options));
    results.push(await runSuite(suite, "hybrid", baseEnv, options));
  }

  printSummary(results);
  await persistReport(results, options, startedAt);
}

function parseArgs(args: string[]): CompareOptions {
  const values = new Map<string, string>();
  for (const raw of args) {
    if (!raw.startsWith("--")) continue;
    const normalized = raw.slice(2);
    const sep = normalized.indexOf("=");
    if (sep < 0) {
      values.set(normalized, "true");
      continue;
    }
    values.set(normalized.slice(0, sep), normalized.slice(sep + 1));
  }

  const quick = values.get("quick") === "true";
  const reportPath = values.get("report")?.trim() || defaultReportPath();

  const concurrency = toPositiveInt(values.get("concurrency"));
  const maxCases = toPositiveInt(values.get("max-cases"));
  const categoryMaxCases = toPositiveInt(values.get("category-max-cases"));
  const skipSemantic = values.get("skip-semantic") === "true";
  const skipCrud = values.get("skip-crud") === "true";

  return {
    quick,
    concurrency,
    maxCases,
    categoryMaxCases,
    reportPath,
    skipSemantic,
    skipCrud
  };
}

function defaultReportPath(): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    pad2(now.getMonth() + 1),
    pad2(now.getDate())
  ].join("") + "-" + [pad2(now.getHours()), pad2(now.getMinutes()), pad2(now.getSeconds())].join("");
  return join(".mlex", "bench", `compare-${stamp}.json`);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toPositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function buildBaseEnv(options: CompareOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options.quick) {
    env.MLEX_BENCH_MAX_CASES = env.MLEX_BENCH_MAX_CASES ?? "36";
    env.MLEX_BENCH_CATEGORY_MAX_CASES = env.MLEX_BENCH_CATEGORY_MAX_CASES ?? "12";
  }
  if (options.concurrency) {
    env.MLEX_BENCH_CONCURRENCY = String(options.concurrency);
  }
  if (options.maxCases) {
    env.MLEX_BENCH_MAX_CASES = String(options.maxCases);
  }
  if (options.categoryMaxCases) {
    env.MLEX_BENCH_CATEGORY_MAX_CASES = String(options.categoryMaxCases);
  }
  return env;
}

async function runSuite(
  suite: BenchSuite,
  mode: EmbedderMode,
  baseEnv: NodeJS.ProcessEnv,
  options: CompareOptions
): Promise<BenchRunResult> {
  const runEnv: NodeJS.ProcessEnv = {
    ...baseEnv,
    MLEX_EMBEDDER: mode
  };
  if (mode === "hybrid" && !runEnv.MLEX_VECTOR_MIN_SCORE) {
    runEnv.MLEX_VECTOR_MIN_SCORE = "0";
  }

  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const cmdArgs = [
    "vitest",
    "run",
    "--config",
    "vitest.bench.config.ts",
    suite.testFile,
    "--reporter=verbose"
  ];
  const display = formatCommand(cmd, cmdArgs);
  console.info(
    `\n[bench-compare] running ${suite.label} (${mode})` +
      `  quick=${options.quick ? "true" : "false"}`
  );
  console.info(`[bench-compare] command: ${display}`);

  const startedMs = Date.now();
  const output = await spawnAndCapture(display, runEnv);
  const durationMs = Date.now() - startedMs;
  const pass = parsePassMetrics(output);
  const latency = parseLatencyMetrics(output);

  console.info(
    `[bench-compare] done ${suite.label} (${mode}) in ${(durationMs / 1000).toFixed(1)}s` +
      `  pass=${pass.passed}/${pass.total}` +
      `  query(avg/p95)=${latency.queryAvgMs.toFixed(1)}/${latency.queryP95Ms.toFixed(1)}ms`
  );

  return {
    suite: suite.key,
    mode,
    command: display,
    durationMs,
    pass,
    latency
  };
}

function spawnAndCapture(commandLine: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(commandLine, {
      env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let all = "";
    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      all += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      all += text;
      process.stderr.write(text);
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(all);
        return;
      }
      reject(new Error(`bench command failed with exit code ${code}`));
    });
  });
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args.map(quoteArg)].join(" ");
}

function quoteArg(value: string): string {
  if (!/[\s"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function parsePassMetrics(output: string): PassMetrics {
  const regex = /overall\s*:?\s*(\d+)\/(\d+)\s*\(([\d.]+)%\)/gim;
  let match: RegExpExecArray | null = null;
  let last: RegExpExecArray | null = null;
  while ((match = regex.exec(output)) !== null) {
    last = match;
  }
  if (!last) {
    throw new Error("Unable to parse overall pass rate from bench output.");
  }
  const passed = Number.parseInt(last[1] ?? "0", 10);
  const total = Number.parseInt(last[2] ?? "0", 10);
  const passRate = total > 0 ? passed / total : 0;
  return { passed, total, passRate };
}

function parseLatencyMetrics(output: string): LatencyMetrics {
  const regex =
    /\[(?:bench-eval-latency|crud-bench-latency)\]\s*ingest\(avg\/p95\)=([\d.]+)\/([\d.]+)ms\s*query\(avg\/p95\)=([\d.]+)\/([\d.]+)ms\s*total\(avg\/p95\)=([\d.]+)\/([\d.]+)ms/gim;
  let match: RegExpExecArray | null = null;
  let last: RegExpExecArray | null = null;
  while ((match = regex.exec(output)) !== null) {
    last = match;
  }
  if (!last) {
    throw new Error("Unable to parse latency summary from bench output.");
  }
  return {
    ingestAvgMs: toFloat(last[1]),
    ingestP95Ms: toFloat(last[2]),
    queryAvgMs: toFloat(last[3]),
    queryP95Ms: toFloat(last[4]),
    totalAvgMs: toFloat(last[5]),
    totalP95Ms: toFloat(last[6])
  };
}

function toFloat(raw: string | undefined): number {
  const parsed = Number.parseFloat(raw ?? "");
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function printSummary(results: BenchRunResult[]): void {
  console.info("\n=== Bench Compare Summary ===");
  console.info(
    [
      "Suite".padEnd(10),
      "Pass(hash→hybrid)".padEnd(20),
      "DeltaPass(pp)".padEnd(14),
      "QueryAvg(ms)".padEnd(24),
      "QueryP95(ms)".padEnd(24),
      "TotalAvg(ms)".padEnd(24)
    ].join(" | ")
  );
  console.info("-".repeat(128));

  for (const suite of SUITES) {
    const hash = results.find((item) => item.suite === suite.key && item.mode === "hash");
    const hybrid = results.find((item) => item.suite === suite.key && item.mode === "hybrid");
    if (!hash || !hybrid) continue;

    const deltaPassPp = (hybrid.pass.passRate - hash.pass.passRate) * 100;
    const queryAvgGain = percentGain(hash.latency.queryAvgMs, hybrid.latency.queryAvgMs);
    const queryP95Gain = percentGain(hash.latency.queryP95Ms, hybrid.latency.queryP95Ms);
    const totalAvgGain = percentGain(hash.latency.totalAvgMs, hybrid.latency.totalAvgMs);

    console.info(
      [
        suite.label.padEnd(10),
        `${hash.pass.passed}/${hash.pass.total} -> ${hybrid.pass.passed}/${hybrid.pass.total}`.padEnd(20),
        formatSigned(deltaPassPp, 2).padEnd(14),
        `${hash.latency.queryAvgMs.toFixed(1)} -> ${hybrid.latency.queryAvgMs.toFixed(1)} (${formatSigned(queryAvgGain, 1)}%)`.padEnd(24),
        `${hash.latency.queryP95Ms.toFixed(1)} -> ${hybrid.latency.queryP95Ms.toFixed(1)} (${formatSigned(queryP95Gain, 1)}%)`.padEnd(24),
        `${hash.latency.totalAvgMs.toFixed(1)} -> ${hybrid.latency.totalAvgMs.toFixed(1)} (${formatSigned(totalAvgGain, 1)}%)`.padEnd(24)
      ].join(" | ")
    );
  }
}

function percentGain(before: number, after: number): number {
  if (!Number.isFinite(before) || before <= 0) return 0;
  return ((before - after) / before) * 100;
}

function formatSigned(value: number, digits: number): string {
  const normalized = Number.isFinite(value) ? value : 0;
  const prefix = normalized > 0 ? "+" : "";
  return `${prefix}${normalized.toFixed(digits)}`;
}

async function persistReport(
  results: BenchRunResult[],
  options: CompareOptions,
  startedAt: Date
): Promise<void> {
  const report = {
    generatedAt: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
    options,
    results
  };
  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.info(`\n[bench-compare] report written: ${options.reportPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[bench-compare] failed: ${message}`);
  process.exitCode = 1;
});
