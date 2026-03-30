import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createRuntime, type Runtime } from "../src/container.js";
import { createTestRunDir } from "./helpers/testRunDir.js";

type Difficulty = "easy" | "medium" | "hard";
type QueryTypeBucket = "short" | "long" | "keyword-sparse" | "keyword-dense";

interface TierMetrics {
  queryCount: number;
  keywordMatchRate: number;
  passRate: number;
}

interface QueryRecord {
  query: string;
  difficulty: Difficulty;
  queryTypes: QueryTypeBucket[];
  predictionWeight: number;
  rerankShift: number;
  deltaRank: number;
  baseScore: number;
  finalScore: number;
  maxScoreGap: number;
  maxBoost: number;
  preTopScores: Array<{ blockId: string; score: number }>;
  postTopScores: Array<{ blockId: string; score: number }>;
  deltaRankZeroReason?: string;
}

interface QueryTypeMetrics {
  queryCount: number;
  passRate: number;
  avgPredictionWeight: number;
  avgRerankShift: number;
  avgDeltaRank: number;
}

interface StabilityAssessment {
  embeddingSeed: number;
  repeats: number;
  fixedSeedVarianceLow: boolean;
  likelySource: "model_randomness" | "embedding_randomness" | "mixed";
  metricRanges: {
    predictionActiveRate: number;
    passRate: number;
    avgDeltaRank: number;
    keywordDenseAvgDeltaRank: number;
    avgRerankShift: number;
  };
}

interface LongflowMetrics {
  summaryQueryReturnedBlocks: number;
  sampleSize: number;
  querySize: number;
  evaluationTopK: number;
  recallAtK: number;
  keywordMatchRate: number;
  precisionAtK: number;
  passRate: number;
  predictionActiveRate: number;
  avgPredictionWeight: number;
  avgRerankShift: number;
  avgDeltaRank: number;
  tierMetrics: Record<Difficulty, TierMetrics>;
  queryTypeMetrics: Record<QueryTypeBucket, QueryTypeMetrics>;
  predictionAvailable: boolean;
  restartHit: boolean;
}

interface EvalQuerySpec {
  query: string;
  relevantKeywords: string[];
  difficulty: Difficulty;
}

interface ScenarioSpec {
  topic: string;
  issue: string;
  rootCause: string;
  fix: string;
  validation: string;
  keywords: string[];
}

interface EvalRuntimeOptions {
  sampleSize: number;
  querySize: number;
  evaluationTopK: number;
  seed: number;
}

interface EvalDataset {
  flowEvents: string[];
  evalQueries: EvalQuerySpec[];
}

interface GridSearchManagerOverrides {
  predictionDenseBoostMultiplier: number;
  predictionBoostCap: number;
  predictionBaseScoreGateMax: number;
  predictionDenseConfidenceGateMin: number;
}

interface GridSearchCandidateResult {
  params: GridSearchManagerOverrides;
  baselineRunDir: string;
  variantRunDir: string;
  baselinePassRate: number;
  variantPassRate: number;
  passRateDrop: number;
  variantAvgDeltaRank: number;
  variantAvgPredictionWeight: number;
  variantAvgRerankShift: number;
  feasible: boolean;
  objectiveDistance: number;
}

interface TierCounter {
  queryCount: number;
  matchedKeywords: number;
  totalKeywords: number;
  passedQueries: number;
}

interface QueryTypeCounter {
  queryCount: number;
  passedQueries: number;
  predictionWeights: number[];
  rerankShifts: number[];
  deltaRanks: number[];
}

const DEFAULT_SAMPLE_SIZE = 24;
const DEFAULT_QUERY_SIZE = 18;
const DEFAULT_TOP_K = 8;
const DEFAULT_SEED = 20260329;
const QUERY_TYPE_SHORT_MAX_CHARS = 24;
const QUERY_TYPE_DENSE_MIN_RATIO = 0.5;
const DEFAULT_STABILITY_REPEAT = 3;
const DEFAULT_EMBEDDING_SEED = 20260329;
const GRID_SEARCH_DENSE_MULTIPLIERS = [0.036, 0.042, 0.048, 0.054, 0.06, 0.066, 0.072] as const;
const GRID_SEARCH_BOOST_CAPS = [0.14, 0.16, 0.18] as const;
const GRID_SEARCH_BASE_SCORE_GATES = [0.14, 0.16, 0.2] as const;
const GRID_SEARCH_DENSE_CONFIDENCE_GATES = [0.5] as const;
const BEST_DENSE_CANDIDATE: GridSearchManagerOverrides = {
  predictionDenseBoostMultiplier: 0.054,
  predictionBoostCap: 0.14,
  predictionBaseScoreGateMax: 0.14,
  predictionDenseConfidenceGateMin: 0.5
};

const SCENARIOS: ScenarioSpec[] = [
  {
    topic: "支付幂等键",
    issue: "支付链路出现重复写入，幂等键在多入口未统一。",
    rootCause: "重试路径绕过幂等键校验，导致重复扣款与状态漂移。",
    fix: "在入口与 handler 双层补齐幂等键校验和幂等锁。",
    validation: "通过回放验证确认幂等键生效并阻断重复写入。",
    keywords: ["幂等键", "幂等锁", "重复写入", "回放验证"]
  },
  {
    topic: "补偿互斥控制",
    issue: "补偿任务在并发重试时发生重入，产生多次执行。",
    rootCause: "任务实例缺少互斥与锁租约，重试策略放大重入。",
    fix: "补偿任务增加任务级互斥与重入窗口限制。",
    validation: "通过回放验证确认互斥策略阻断重入。",
    keywords: ["补偿任务", "互斥", "重入", "回放验证"]
  },
  {
    topic: "对账告警阈值",
    issue: "对账异常积压但告警未触发，问题长期静默。",
    rootCause: "告警阈值缺失且路由不完整，导致监控盲区。",
    fix: "增加告警阈值分级和通知路由，补齐告警闭环。",
    validation: "通过回放验证确认告警阈值与闭环动作有效。",
    keywords: ["对账", "告警", "阈值", "闭环"]
  },
  {
    topic: "回放验证流程",
    issue: "修复发布前缺少回放验证，无法证明链路稳定。",
    rootCause: "发布流程没有强制回放验证与验收门禁。",
    fix: "把回放验证纳入发布检查并记录验收结果。",
    validation: "回放验证通过后再发布，失败则回滚并复盘。",
    keywords: ["回放验证", "发布", "验收", "回滚"]
  }
];

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readEvalOptions(): EvalRuntimeOptions {
  return {
    sampleSize: parsePositiveInt(process.env.EVAL_SAMPLE_SIZE, DEFAULT_SAMPLE_SIZE),
    querySize: parsePositiveInt(process.env.EVAL_QUERY_SIZE, DEFAULT_QUERY_SIZE),
    evaluationTopK: Math.min(parsePositiveInt(process.env.EVAL_TOPK, DEFAULT_TOP_K), 12),
    seed: parsePositiveInt(process.env.EVAL_SEED, DEFAULT_SEED)
  };
}

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pickOne<T>(items: T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)] as T;
}

function buildTierQuery(scenario: ScenarioSpec, difficulty: Difficulty, rng: () => number): string {
  if (difficulty === "easy") {
    return `${scenario.topic}怎么做？请覆盖${scenario.keywords[0]}、${scenario.keywords[1]}与${scenario.keywords[2]}。`;
  }

  if (difficulty === "medium") {
    const variants = [
      `${scenario.topic}的治理方案怎么落地？请说明${scenario.keywords[0]}与${scenario.keywords[1]}。`,
      `${scenario.topic}如何分阶段推进并验证效果？重点覆盖${scenario.keywords[0]}。`,
      `${scenario.topic}出了问题后先查什么再修什么？请给出${scenario.keywords[1]}侧排查路径。`
    ];
    return pickOne(variants, rng);
  }

  const hardVariants = [
    `如果只允许一次发布窗口，${scenario.topic}相关风险如何收敛？`,
    `这个事故链路要避免再次复发，验收门禁怎么设计？`,
    `跨团队协作下，${scenario.topic}怎么做最小化回归风险？`
  ];
  return pickOne(hardVariants, rng);
}

function splitTierQueryCount(total: number): Record<Difficulty, number> {
  if (total <= 0) return { easy: 0, medium: 0, hard: 0 };
  const easy = Math.max(1, Math.floor(total * 0.4));
  const medium = Math.max(1, Math.floor(total * 0.35));
  const hard = Math.max(1, total - easy - medium);
  let remain = total - easy - medium - hard;
  const counts: Record<Difficulty, number> = { easy, medium, hard };
  const order: Difficulty[] = ["easy", "medium", "hard"];
  let idx = 0;
  while (remain > 0) {
    counts[order[idx % order.length]] += 1;
    idx += 1;
    remain -= 1;
  }
  return counts;
}

function buildGeneratedDataset(options: EvalRuntimeOptions): EvalDataset {
  const rng = createSeededRng(options.seed);
  const flowEvents: string[] = [];

  for (let i = 0; i < options.sampleSize; i += 1) {
    const scenario = pickOne(SCENARIOS, rng);
    flowEvents.push(
      `样本#${i + 1} ${scenario.issue}`,
      `样本#${i + 1} 根因：${scenario.rootCause}`,
      `样本#${i + 1} 处置：${scenario.fix}`,
      `样本#${i + 1} 验证：${scenario.validation}`
    );
  }

  flowEvents.push(
    "全局收敛方案：幂等键 + 任务互斥 + 告警阈值 + 回放验证。",
    "请持续跟踪告警闭环并复盘回放验证结果。"
  );

  const tierCount = splitTierQueryCount(options.querySize);
  const evalQueries: EvalQuerySpec[] = [];
  const tiers: Difficulty[] = ["easy", "medium", "hard"];

  for (const difficulty of tiers) {
    for (let i = 0; i < tierCount[difficulty]; i += 1) {
      const scenario = pickOne(SCENARIOS, rng);
      evalQueries.push({
        query: buildTierQuery(scenario, difficulty, rng),
        relevantKeywords: scenario.keywords.slice(0, 3),
        difficulty
      });
    }
  }

  evalQueries.push({
    query: "整体最终方案是什么",
    relevantKeywords: ["幂等键", "互斥", "告警", "回放验证"],
    difficulty: "easy"
  });

  return { flowEvents, evalQueries };
}

function computeDatasetFingerprint(dataset: EvalDataset): string {
  const text = JSON.stringify(dataset);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function safeRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function printLongflowReport(input: {
  mode: "offline" | "deepseek";
  runDir: string;
  metrics: LongflowMetrics;
  agentReplyLength: number;
}): void {
  const { mode, runDir, metrics, agentReplyLength } = input;
  const report = [
    "[longflow-eval] mode=" + mode,
    "runDir=" + runDir,
    "sampleSize=" + metrics.sampleSize,
    "querySize=" + metrics.querySize,
    "evaluationTopK=" + metrics.evaluationTopK,
    "summaryQueryReturnedBlocks=" + metrics.summaryQueryReturnedBlocks,
    "recallAtK=" + metrics.recallAtK.toFixed(3),
    "keywordMatchRate=" + metrics.keywordMatchRate.toFixed(3),
    "precisionAtK=" + metrics.precisionAtK.toFixed(3),
    "passRate=" + metrics.passRate.toFixed(3),
    "predictionActiveRate=" + metrics.predictionActiveRate.toFixed(3),
    "easy.queryCount=" + metrics.tierMetrics.easy.queryCount,
    "easy.keywordMatchRate=" + metrics.tierMetrics.easy.keywordMatchRate.toFixed(3),
    "easy.passRate=" + metrics.tierMetrics.easy.passRate.toFixed(3),
    "medium.queryCount=" + metrics.tierMetrics.medium.queryCount,
    "medium.keywordMatchRate=" + metrics.tierMetrics.medium.keywordMatchRate.toFixed(3),
    "medium.passRate=" + metrics.tierMetrics.medium.passRate.toFixed(3),
    "hard.queryCount=" + metrics.tierMetrics.hard.queryCount,
    "hard.keywordMatchRate=" + metrics.tierMetrics.hard.keywordMatchRate.toFixed(3),
    "hard.passRate=" + metrics.tierMetrics.hard.passRate.toFixed(3),
    "predictionAvailable=" + String(metrics.predictionAvailable),
    "restartHit=" + String(metrics.restartHit),
    "agentReplyLength=" + agentReplyLength
  ].join("\n");
  console.info(report);
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, "").toLowerCase();
}

function toBlockSearchText(block: {
  summary: string;
  keywords: string[];
  rawEvents?: Array<{ text: string }>;
}): string {
  const raw = (block.rawEvents ?? []).map((event) => event.text).join(" ");
  return [block.summary, block.keywords.join(" "), raw].join(" ");
}

function containsNormalized(haystack: string, needle: string): boolean {
  return normalizeText(haystack).includes(normalizeText(needle));
}

function classifyQueryTypes(query: string, keywords: string[]): QueryTypeBucket[] {
  const normalized = normalizeText(query);
  const types: QueryTypeBucket[] = [];
  if (normalized.length <= QUERY_TYPE_SHORT_MAX_CHARS) {
    types.push("short");
  } else {
    types.push("long");
  }

  const hitCount = keywords.filter((keyword) => containsNormalized(query, keyword)).length;
  const density = safeRatio(hitCount, Math.max(keywords.length, 1));
  if (density >= QUERY_TYPE_DENSE_MIN_RATIO) {
    types.push("keyword-dense");
  } else {
    types.push("keyword-sparse");
  }

  return types;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function range(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
}

function buildStabilityAssessment(records: Array<{ metrics: LongflowMetrics }>, embeddingSeed: number): StabilityAssessment {
  const predictionActiveRates = records.map((item) => item.metrics.predictionActiveRate);
  const passRates = records.map((item) => item.metrics.passRate);
  const avgDeltaRanks = records.map((item) => item.metrics.avgDeltaRank);
  const keywordDenseAvgDeltaRanks = records.map(
    (item) => item.metrics.queryTypeMetrics["keyword-dense"].avgDeltaRank
  );
  const avgRerankShifts = records.map((item) => item.metrics.avgRerankShift);

  const predictionActiveRateRange = range(predictionActiveRates);
  const passRateRange = range(passRates);
  const avgDeltaRankRange = range(avgDeltaRanks);
  const keywordDenseAvgDeltaRankRange = range(keywordDenseAvgDeltaRanks);
  const avgRerankShiftRange = range(avgRerankShifts);

  const fixedSeedVarianceLow =
    predictionActiveRateRange <= 0.01 &&
    passRateRange <= 0.05 &&
    keywordDenseAvgDeltaRankRange <= 0.5 &&
    avgRerankShiftRange <= 0.2;

  const likelySource: StabilityAssessment["likelySource"] = fixedSeedVarianceLow
    ? "model_randomness"
    : predictionActiveRateRange <= 0.01 &&
        (keywordDenseAvgDeltaRankRange > 0.5 || avgRerankShiftRange > 0.2 || passRateRange > 0.05)
      ? "embedding_randomness"
      : "mixed";

  return {
    embeddingSeed,
    repeats: records.length,
    fixedSeedVarianceLow,
    likelySource,
    metricRanges: {
      predictionActiveRate: predictionActiveRateRange,
      passRate: passRateRange,
      avgDeltaRank: avgDeltaRankRange,
      keywordDenseAvgDeltaRank: keywordDenseAvgDeltaRankRange,
      avgRerankShift: avgRerankShiftRange
    }
  };
}

describe("Longflow evaluation", () => {
  let runtimes: Runtime[] = [];
  const deepseekApiKey = process.env.DEEPSEEK_API_KEY ?? process.env.MLEX_DEEPSEEK_API_KEY;

  afterEach(async () => {
    for (const runtime of runtimes.splice(0, runtimes.length)) {
      await runtime.close();
    }
  });

  test(
    "offline reproducible longflow reaches baseline metrics",
    async () => {
      const result = await runLongflowEvaluation({
        testName: "eval.longflow.offline",
        provider: "rule-based"
      });
      printLongflowReport({
        mode: "offline",
        runDir: result.normalizedRunDir,
        metrics: result.metrics,
        agentReplyLength: result.agentReplyLength
      });

      expect(result.metrics.summaryQueryReturnedBlocks).toBeGreaterThanOrEqual(4);
      expect(result.metrics.recallAtK).toBeGreaterThanOrEqual(0.2);
      expect(result.metrics.keywordMatchRate).toBeGreaterThanOrEqual(0.15);
      expect(result.metrics.precisionAtK).toBeGreaterThanOrEqual(0.08);
      expect(result.metrics.passRate).toBeGreaterThanOrEqual(0.15);
      expect(result.metrics.tierMetrics.easy.queryCount).toBeGreaterThan(0);
      expect(result.metrics.tierMetrics.medium.queryCount).toBeGreaterThan(0);
      expect(result.metrics.tierMetrics.hard.queryCount).toBeGreaterThan(0);
      expect(result.metrics.predictionAvailable).toBe(true);
      expect(result.metrics.restartHit).toBe(true);
      expect(result.normalizedRunDir).toMatch(/\.mlex\/test\/eval\.longflow\.offline\/[0-9T-]+Z$/);
    },
    90000
  );

  test(
    "prediction force switch supports minimal A/B experiment",
    async () => {
      const baseline = await runLongflowEvaluation({
        testName: "eval.longflow.ab.baseline",
        provider: "rule-based",
        predictionEnabled: false,
        predictionForceActiveTrigger: false
      });

      const variant = await runLongflowEvaluation({
        testName: "eval.longflow.ab.variant",
        provider: "rule-based",
        predictionEnabled: true,
        predictionForceActiveTrigger: true
      });

      expect(baseline.metrics.predictionAvailable).toBe(false);
      expect(baseline.metrics.predictionActiveRate).toBe(0);
      expect(variant.metrics.predictionAvailable).toBe(true);
      expect(variant.metrics.predictionActiveRate).toBeGreaterThan(0);
      expect(variant.metrics.predictionActiveRate).toBeGreaterThan(baseline.metrics.predictionActiveRate);
      expect(variant.metrics.queryTypeMetrics.short.queryCount).toBeGreaterThan(0);
      expect(variant.metrics.queryTypeMetrics.long.queryCount).toBeGreaterThan(0);
      expect(variant.metrics.queryTypeMetrics["keyword-sparse"].queryCount).toBeGreaterThan(0);
      expect(variant.metrics.queryTypeMetrics["keyword-dense"].queryCount).toBeGreaterThan(0);
      expect(variant.metrics.avgPredictionWeight).toBeGreaterThanOrEqual(0);
    },
    90000
  );

  test(
    "prediction grid search selects best dense tuning candidate",
    async () => {
      const result = await runPredictionGridSearch({
        testName: "eval.longflow.grid-search",
        provider: "rule-based"
      });

      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.bestCandidate).toBeDefined();
      if (!result.bestCandidate) {
        expect(result.failureReason).toBeDefined();
        return;
      }
      if (result.bestCandidate.feasible) {
        expect(result.bestCandidate.variantAvgDeltaRank).toBeGreaterThanOrEqual(2);
        expect(result.bestCandidate.variantAvgDeltaRank).toBeLessThanOrEqual(4);
        expect(result.bestCandidate.passRateDrop).toBeGreaterThanOrEqual(0);
      }
    },
    240000
  );

  test(
    "best dense candidate stability assessment repeats 3 times",
    async () => {
      const stability = await runEmbeddingSeedStability({
        testName: "eval.longflow.best-candidate-stability",
        provider: "rule-based",
        repeats: DEFAULT_STABILITY_REPEAT,
        embeddingSeed: DEFAULT_EMBEDDING_SEED,
        predictionEnabled: true,
        predictionForceActiveTrigger: true,
        managerOverrides: BEST_DENSE_CANDIDATE
      });

      expect(stability.embeddingSeed).toBe(DEFAULT_EMBEDDING_SEED);
      expect(stability.repeats).toBe(DEFAULT_STABILITY_REPEAT);
      expect(stability.metricRanges.predictionActiveRate).toBeGreaterThanOrEqual(0);
      expect(stability.metricRanges.passRate).toBeGreaterThanOrEqual(0);
      expect(stability.metricRanges.avgDeltaRank).toBeGreaterThanOrEqual(0);
      expect(stability.metricRanges.keywordDenseAvgDeltaRank).toBeGreaterThanOrEqual(0);
      expect(stability.metricRanges.avgRerankShift).toBeGreaterThanOrEqual(0);
      expect(["model_randomness", "embedding_randomness", "mixed"]).toContain(stability.likelySource);
    },
    120000
  );

  test.skipIf(!deepseekApiKey)(
    "deepseek-reasoner online longflow keeps end-to-end quality",
    async () => {
      const result = await runLongflowEvaluation({
        testName: "eval.longflow.deepseek",
        provider: "deepseek-reasoner",
        deepseekApiKey
      });
      printLongflowReport({
        mode: "deepseek",
        runDir: result.normalizedRunDir,
        metrics: result.metrics,
        agentReplyLength: result.agentReplyLength
      });

      expect(result.metrics.recallAtK).toBeGreaterThanOrEqual(0.2);
      expect(result.metrics.keywordMatchRate).toBeGreaterThanOrEqual(0.15);
      expect(result.metrics.precisionAtK).toBeGreaterThanOrEqual(0.08);
      expect(result.metrics.passRate).toBeGreaterThanOrEqual(0.15);
      expect(result.metrics.tierMetrics.easy.queryCount).toBeGreaterThan(0);
      expect(result.metrics.tierMetrics.medium.queryCount).toBeGreaterThan(0);
      expect(result.metrics.tierMetrics.hard.queryCount).toBeGreaterThan(0);
      expect(result.metrics.predictionAvailable).toBe(true);
      expect(result.metrics.restartHit).toBe(true);
      expect(result.agentReplyLength).toBeGreaterThan(0);
      expect(result.normalizedRunDir).toMatch(/\.mlex\/test\/eval\.longflow\.deepseek\/[0-9T-]+Z$/);
    },
    90000
  );

  async function runLongflowEvaluation(input: {
    testName: string;
    provider: "rule-based" | "deepseek-reasoner";
    deepseekApiKey?: string;
    predictionEnabled?: boolean;
    predictionForceActiveTrigger?: boolean;
    embeddingSeed?: number;
    managerOverrides?: Partial<GridSearchManagerOverrides>;
    dataset?: EvalDataset;
    options?: EvalRuntimeOptions;
  }): Promise<{
    metrics: LongflowMetrics;
    queryRecords: QueryRecord[];
    agentReplyLength: number;
    normalizedRunDir: string;
  }> {
    const options = input.options ?? readEvalOptions();
    const { flowEvents, evalQueries } = input.dataset ?? buildGeneratedDataset(options);
    const { runDir, sqliteFile } = await createTestRunDir(input.testName);

    const predictionEnabled = input.predictionEnabled ?? true;
    const predictionForceActiveTrigger = input.predictionForceActiveTrigger ?? true;

    const deterministicBaseTimestampMs = 1700000000000;
    const deterministicNowMs = (() => {
      let tick = 0;
      return () => deterministicBaseTimestampMs + tick++;
    })();
    const deterministicBlockIdFactory = (() => {
      let index = 0;
      return () => `block_eval_${String(index++).padStart(6, "0")}`;
    })();
    const deterministicEventIdFactory = (() => {
      let index = 0;
      return () => `event_eval_${String(index++).padStart(6, "0")}`;
    })();

    const runtime1 = createRuntime({
      service:
        input.provider === "deepseek-reasoner"
          ? {
              provider: "deepseek-reasoner",
              deepseekApiKey: input.deepseekApiKey,
              deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-reasoner"
            }
          : {
              provider: "rule-based"
            },
      manager: {
        predictionEnabled,
        predictionForceActiveTrigger,
        embeddingSeed: input.embeddingSeed,
        predictionActiveThreshold: 0.1,
        predictionDenseBoostMultiplier: input.managerOverrides?.predictionDenseBoostMultiplier,
        predictionBoostCap: input.managerOverrides?.predictionBoostCap,
        predictionBaseScoreGateMax: input.managerOverrides?.predictionBaseScoreGateMax,
        predictionDenseConfidenceGateMin: input.managerOverrides?.predictionDenseConfidenceGateMin,
        semanticTopK: Math.max(options.evaluationTopK * 2, 8),
        finalTopK: Math.max(options.evaluationTopK * 2, 8),
        relationDepth: 1,
        graphExpansionTopK: 4
      },
      component: {
        chunkStrategy: "fixed",
        storageBackend: "sqlite",
        sqliteFilePath: sqliteFile,
        rawStoreBackend: "sqlite",
        relationStoreBackend: "sqlite"
      }
    }, {
      nowMs: deterministicNowMs,
      blockIdFactory: deterministicBlockIdFactory
    });
    for (let index = 0; index < flowEvents.length; index += 1) {
      await runtime1.memoryManager.addEvent({
        id: deterministicEventIdFactory(),
        role: index % 2 === 0 ? "user" : "assistant",
        text: flowEvents[index] as string,
        timestamp: deterministicBaseTimestampMs + index * 100
      });
      await runtime1.memoryManager.sealCurrentBlock();
    }
    await runtime1.memoryManager.flushAsyncRelations();

    const summaryContext = await runtime1.memoryManager.getContext("全量总结");
    const summaryQueryReturnedBlocks = summaryContext.blocks.length;
    const effectiveTopK = Math.min(options.evaluationTopK, Math.max(1, summaryQueryReturnedBlocks));

    let recalledQueryCount = 0;
    let passQueryCount = 0;
    let matchedKeywordCount = 0;
    let totalKeywordCount = 0;
    let precisionAtKSum = 0;
    let predictionAvailable = false;
    let predictionActiveCount = 0;

    const queryRecords: QueryRecord[] = [];

    const tierCounter: Record<Difficulty, TierCounter> = {
      easy: { queryCount: 0, matchedKeywords: 0, totalKeywords: 0, passedQueries: 0 },
      medium: { queryCount: 0, matchedKeywords: 0, totalKeywords: 0, passedQueries: 0 },
      hard: { queryCount: 0, matchedKeywords: 0, totalKeywords: 0, passedQueries: 0 }
    };

    const queryTypeCounter: Record<QueryTypeBucket, QueryTypeCounter> = {
      short: { queryCount: 0, passedQueries: 0, predictionWeights: [], rerankShifts: [], deltaRanks: [] },
      long: { queryCount: 0, passedQueries: 0, predictionWeights: [], rerankShifts: [], deltaRanks: [] },
      "keyword-sparse": { queryCount: 0, passedQueries: 0, predictionWeights: [], rerankShifts: [], deltaRanks: [] },
      "keyword-dense": { queryCount: 0, passedQueries: 0, predictionWeights: [], rerankShifts: [], deltaRanks: [] }
    };

    for (const spec of evalQueries) {
      const context = await runtime1.memoryManager.getContext(spec.query);
      const topBlocks = context.blocks.slice(0, effectiveTopK);
      const topTexts = topBlocks.map((block) => toBlockSearchText(block));

      const bucket = tierCounter[spec.difficulty];
      bucket.queryCount += 1;

      let matchedForQuery = 0;
      for (const keyword of spec.relevantKeywords) {
        totalKeywordCount += 1;
        bucket.totalKeywords += 1;
        if (topTexts.some((text) => containsNormalized(text, keyword))) {
          matchedKeywordCount += 1;
          bucket.matchedKeywords += 1;
          matchedForQuery += 1;
        }
      }

      if (matchedForQuery > 0) {
        recalledQueryCount += 1;
      }

      const isPass = matchedForQuery / spec.relevantKeywords.length >= 0.5;
      if (isPass) {
        passQueryCount += 1;
        bucket.passedQueries += 1;
      }

      const relevantBlockCount = topTexts.filter((text) =>
        spec.relevantKeywords.some((keyword) => containsNormalized(text, keyword))
      ).length;
      precisionAtKSum += relevantBlockCount / Math.max(topBlocks.length, 1);

      if (context.prediction) {
        predictionAvailable = true;
      }
      if (context.prediction?.activeTrigger) {
        predictionActiveCount += 1;
      }

      const queryTypes = classifyQueryTypes(spec.query, spec.relevantKeywords);
      const predictionWeight = context.prediction?.predictionWeight ?? 0;
      const rerankShift = context.prediction?.rerankShift ?? 0;
      const deltaRank = context.prediction?.deltaRank ?? 0;
      const baseScore = context.prediction?.baseScore ?? 0;
      const finalScore = context.prediction?.finalScore ?? 0;
      const maxScoreGap = context.prediction?.maxScoreGap ?? 0;
      const maxBoost = context.prediction?.maxBoost ?? 0;
      const preTopScores = context.prediction?.preTopScores ?? [];
      const postTopScores = context.prediction?.postTopScores ?? [];
      const deltaRankZeroReason =
        deltaRank === 0 && maxBoost < maxScoreGap
          ? "deltaRank=0 because maxBoost < maxScoreGap"
          : undefined;

      for (const queryType of queryTypes) {
        const queryTypeBucket = queryTypeCounter[queryType];
        queryTypeBucket.queryCount += 1;
        if (isPass) {
          queryTypeBucket.passedQueries += 1;
        }
        queryTypeBucket.predictionWeights.push(predictionWeight);
        queryTypeBucket.rerankShifts.push(rerankShift);
        queryTypeBucket.deltaRanks.push(deltaRank);
      }

      queryRecords.push({
        query: spec.query,
        difficulty: spec.difficulty,
        queryTypes,
        predictionWeight,
        rerankShift,
        deltaRank,
        baseScore,
        finalScore,
        maxScoreGap,
        maxBoost,
        preTopScores,
        postTopScores,
        deltaRankZeroReason
      });
    }

    const reply = await runtime1.agent.respond("请给出该事故修复的执行清单");
    const agentReplyLength = reply.text.trim().length;

    const runtime2 = createRuntime({
      service:
        input.provider === "deepseek-reasoner"
          ? {
              provider: "deepseek-reasoner",
              deepseekApiKey: input.deepseekApiKey,
              deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-reasoner"
            }
          : {
              provider: "rule-based"
            },
      manager: {
        predictionEnabled,
        predictionForceActiveTrigger,
        embeddingSeed: input.embeddingSeed,
        predictionActiveThreshold: 0.1,
        predictionDenseBoostMultiplier: input.managerOverrides?.predictionDenseBoostMultiplier,
        predictionBoostCap: input.managerOverrides?.predictionBoostCap,
        predictionBaseScoreGateMax: input.managerOverrides?.predictionBaseScoreGateMax,
        predictionDenseConfidenceGateMin: input.managerOverrides?.predictionDenseConfidenceGateMin,
        semanticTopK: Math.max(options.evaluationTopK * 2, 8),
        finalTopK: Math.max(options.evaluationTopK * 2, 8),
        relationDepth: 1,
        graphExpansionTopK: 4
      },
      component: {
        chunkStrategy: "fixed",
        storageBackend: "sqlite",
        sqliteFilePath: sqliteFile,
        rawStoreBackend: "sqlite",
        relationStoreBackend: "sqlite"
      }
    }, {
      nowMs: deterministicNowMs,
      blockIdFactory: deterministicBlockIdFactory
    });

    const restartContext = await runtime2.memoryManager.getContext("回放验证闭环怎么做");
    const restartTopTexts = restartContext.blocks
      .slice(0, effectiveTopK)
      .map((block) => toBlockSearchText(block));

    const queryTypeMetrics: Record<QueryTypeBucket, QueryTypeMetrics> = {
      short: {
        queryCount: queryTypeCounter.short.queryCount,
        passRate: safeRatio(queryTypeCounter.short.passedQueries, queryTypeCounter.short.queryCount),
        avgPredictionWeight: average(queryTypeCounter.short.predictionWeights),
        avgRerankShift: average(queryTypeCounter.short.rerankShifts),
        avgDeltaRank: average(queryTypeCounter.short.deltaRanks)
      },
      long: {
        queryCount: queryTypeCounter.long.queryCount,
        passRate: safeRatio(queryTypeCounter.long.passedQueries, queryTypeCounter.long.queryCount),
        avgPredictionWeight: average(queryTypeCounter.long.predictionWeights),
        avgRerankShift: average(queryTypeCounter.long.rerankShifts),
        avgDeltaRank: average(queryTypeCounter.long.deltaRanks)
      },
      "keyword-sparse": {
        queryCount: queryTypeCounter["keyword-sparse"].queryCount,
        passRate: safeRatio(
          queryTypeCounter["keyword-sparse"].passedQueries,
          queryTypeCounter["keyword-sparse"].queryCount
        ),
        avgPredictionWeight: average(queryTypeCounter["keyword-sparse"].predictionWeights),
        avgRerankShift: average(queryTypeCounter["keyword-sparse"].rerankShifts),
        avgDeltaRank: average(queryTypeCounter["keyword-sparse"].deltaRanks)
      },
      "keyword-dense": {
        queryCount: queryTypeCounter["keyword-dense"].queryCount,
        passRate: safeRatio(
          queryTypeCounter["keyword-dense"].passedQueries,
          queryTypeCounter["keyword-dense"].queryCount
        ),
        avgPredictionWeight: average(queryTypeCounter["keyword-dense"].predictionWeights),
        avgRerankShift: average(queryTypeCounter["keyword-dense"].rerankShifts),
        avgDeltaRank: average(queryTypeCounter["keyword-dense"].deltaRanks)
      }
    };

    const metrics: LongflowMetrics = {
      summaryQueryReturnedBlocks,
      sampleSize: options.sampleSize,
      querySize: evalQueries.length,
      evaluationTopK: effectiveTopK,
      recallAtK: safeRatio(recalledQueryCount, evalQueries.length),
      keywordMatchRate: safeRatio(matchedKeywordCount, totalKeywordCount),
      precisionAtK: safeRatio(precisionAtKSum, evalQueries.length),
      passRate: safeRatio(passQueryCount, evalQueries.length),
      predictionActiveRate: safeRatio(predictionActiveCount, evalQueries.length),
      avgPredictionWeight: average(queryRecords.map((record) => record.predictionWeight)),
      avgRerankShift: average(queryRecords.map((record) => record.rerankShift)),
      avgDeltaRank: average(queryRecords.map((record) => record.deltaRank)),
      tierMetrics: {
        easy: {
          queryCount: tierCounter.easy.queryCount,
          keywordMatchRate: safeRatio(tierCounter.easy.matchedKeywords, tierCounter.easy.totalKeywords),
          passRate: safeRatio(tierCounter.easy.passedQueries, tierCounter.easy.queryCount)
        },
        medium: {
          queryCount: tierCounter.medium.queryCount,
          keywordMatchRate: safeRatio(tierCounter.medium.matchedKeywords, tierCounter.medium.totalKeywords),
          passRate: safeRatio(tierCounter.medium.passedQueries, tierCounter.medium.queryCount)
        },
        hard: {
          queryCount: tierCounter.hard.queryCount,
          keywordMatchRate: safeRatio(tierCounter.hard.matchedKeywords, tierCounter.hard.totalKeywords),
          passRate: safeRatio(tierCounter.hard.passedQueries, tierCounter.hard.queryCount)
        }
      },
      queryTypeMetrics,
      predictionAvailable,
      restartHit: restartTopTexts.some((text) => containsNormalized(text, "回放验证"))
    };

    await writeFile(
      join(runDir, "report.json"),
      JSON.stringify(
        {
          mode: input.provider === "deepseek-reasoner" ? "deepseek" : "offline",
          runDir: runDir.replace(/\\/g, "/"),
          agentReplyLength,
          queryTypeThresholds: {
            shortMaxChars: QUERY_TYPE_SHORT_MAX_CHARS,
            keywordDenseMinRatio: QUERY_TYPE_DENSE_MIN_RATIO
          },
          queryRecords,
          metrics
        },
        null,
        2
      ),
      "utf8"
    );

    return {
      metrics,
      queryRecords,
      agentReplyLength,
      normalizedRunDir: runDir.replace(/\\/g, "/")
    };
  }

  async function runPredictionGridSearch(input: {
    testName: string;
    provider: "rule-based";
  }): Promise<{
    candidates: GridSearchCandidateResult[];
    feasibleCandidates: GridSearchCandidateResult[];
    bestCandidate?: GridSearchCandidateResult;
    failureReason?: string;
    normalizedRunDir: string;
  }> {
    const candidates: GridSearchCandidateResult[] = [];
    const options = readEvalOptions();
    const dataset = buildGeneratedDataset(options);

    for (const predictionDenseBoostMultiplier of GRID_SEARCH_DENSE_MULTIPLIERS) {
      for (const predictionBoostCap of GRID_SEARCH_BOOST_CAPS) {
        for (const predictionBaseScoreGateMax of GRID_SEARCH_BASE_SCORE_GATES) {
          for (const predictionDenseConfidenceGateMin of GRID_SEARCH_DENSE_CONFIDENCE_GATES) {
            const params: GridSearchManagerOverrides = {
              predictionDenseBoostMultiplier,
              predictionBoostCap,
              predictionBaseScoreGateMax,
              predictionDenseConfidenceGateMin
            };
            const key = [
              `dm-${predictionDenseBoostMultiplier}`,
              `cap-${predictionBoostCap}`,
              `gate-${predictionBaseScoreGateMax}`,
              `conf-${predictionDenseConfidenceGateMin}`
            ].join("_");

            const baseline = await runLongflowEvaluation({
              testName: `${input.testName}.baseline.${key}`,
              provider: input.provider,
              predictionEnabled: false,
              predictionForceActiveTrigger: false,
              embeddingSeed: DEFAULT_EMBEDDING_SEED,
              managerOverrides: params,
              options,
              dataset
            });

            const variant = await runLongflowEvaluation({
              testName: `${input.testName}.variant.${key}`,
              provider: input.provider,
              predictionEnabled: true,
              predictionForceActiveTrigger: true,
              embeddingSeed: DEFAULT_EMBEDDING_SEED,
              managerOverrides: params,
              options,
              dataset
            });

            const passRateDrop = variant.metrics.passRate - baseline.metrics.passRate;
            const variantAvgDeltaRank = variant.metrics.queryTypeMetrics["keyword-dense"].avgDeltaRank;
            const feasible = variantAvgDeltaRank >= 2 && variantAvgDeltaRank <= 4 && passRateDrop >= 0;
            const objectiveDistance = Math.abs(variantAvgDeltaRank - 3) + Math.max(0, -passRateDrop) * 10;

            const candidate: GridSearchCandidateResult = {
              params,
              baselineRunDir: baseline.normalizedRunDir,
              variantRunDir: variant.normalizedRunDir,
              baselinePassRate: baseline.metrics.passRate,
              variantPassRate: variant.metrics.passRate,
              passRateDrop,
              variantAvgDeltaRank,
              variantAvgPredictionWeight: variant.metrics.queryTypeMetrics["keyword-dense"].avgPredictionWeight,
              variantAvgRerankShift: variant.metrics.queryTypeMetrics["keyword-dense"].avgRerankShift,
              feasible,
              objectiveDistance
            };
            candidates.push(candidate);
            console.info("[grid-search-candidate]", candidate);
          }
        }
      }
    }

    const feasibleCandidates = candidates.filter((candidate) => candidate.feasible);
    const rankCandidates = (left: GridSearchCandidateResult, right: GridSearchCandidateResult): number => {
      const distance = left.objectiveDistance - right.objectiveDistance;
      if (distance !== 0) return distance;
      const pass = right.variantPassRate - left.variantPassRate;
      if (pass !== 0) return pass;
      return left.variantAvgPredictionWeight - right.variantAvgPredictionWeight;
    };

    const ordered = (feasibleCandidates.length > 0 ? feasibleCandidates : candidates)
      .slice()
      .sort(rankCandidates);
    const bestCandidate = ordered[0];
    const failureReason =
      feasibleCandidates.length > 0 ? undefined : "No candidate met avgDeltaRank in [2,4] with non-decreasing passRate.";

    const datasetFingerprint = computeDatasetFingerprint(dataset);

    const { runDir } = await createTestRunDir(input.testName);
    await writeFile(
      join(runDir, "grid-report.json"),
      JSON.stringify(
        {
          runDir: runDir.replace(/\\/g, "/"),
          evalOptions: options,
          datasetSummary: {
            flowEventsCount: dataset.flowEvents.length,
            evalQueriesCount: dataset.evalQueries.length,
            datasetFingerprint
          },
          grid: {
            denseMultipliers: [...GRID_SEARCH_DENSE_MULTIPLIERS],
            boostCaps: [...GRID_SEARCH_BOOST_CAPS],
            baseScoreGates: [...GRID_SEARCH_BASE_SCORE_GATES],
            denseConfidenceGates: [...GRID_SEARCH_DENSE_CONFIDENCE_GATES]
          },
          candidates,
          feasibleCandidates,
          bestCandidate,
          failureReason
        },
        null,
        2
      ),
      "utf8"
    );

    return {
      candidates,
      feasibleCandidates,
      bestCandidate,
      failureReason,
      normalizedRunDir: runDir.replace(/\\/g, "/")
    };
  }

  async function runEmbeddingSeedStability(input: {
    testName: string;
    provider: "rule-based" | "deepseek-reasoner";
    deepseekApiKey?: string;
    repeats: number;
    embeddingSeed: number;
    predictionEnabled?: boolean;
    predictionForceActiveTrigger?: boolean;
    managerOverrides?: Partial<GridSearchManagerOverrides>;
  }): Promise<StabilityAssessment> {
    const records: Array<{ metrics: LongflowMetrics; runDir: string }> = [];
    const options = readEvalOptions();
    const dataset = buildGeneratedDataset(options);
    for (let i = 0; i < input.repeats; i += 1) {
      const result = await runLongflowEvaluation({
        testName: `${input.testName}.${i + 1}`,
        provider: input.provider,
        deepseekApiKey: input.deepseekApiKey,
        predictionEnabled: input.predictionEnabled,
        predictionForceActiveTrigger: input.predictionForceActiveTrigger,
        embeddingSeed: input.embeddingSeed,
        managerOverrides: input.managerOverrides,
        options,
        dataset
      });
      records.push({ metrics: result.metrics, runDir: result.normalizedRunDir });
    }

    const stabilityAssessment = buildStabilityAssessment(records, input.embeddingSeed);
    const datasetFingerprint = computeDatasetFingerprint(dataset);
    const { runDir } = await createTestRunDir(input.testName);
    await writeFile(
      join(runDir, "stability-report.json"),
      JSON.stringify(
        {
          mode: input.provider === "deepseek-reasoner" ? "deepseek" : "offline",
          runDir: runDir.replace(/\\/g, "/"),
          evalOptions: options,
          datasetSummary: {
            flowEventsCount: dataset.flowEvents.length,
            evalQueriesCount: dataset.evalQueries.length,
            datasetFingerprint
          },
          managerOverrides: input.managerOverrides,
          stabilityAssessment,
          runs: records.map((record, index) => ({
            index: index + 1,
            runDir: record.runDir,
            metrics: record.metrics
          }))
        },
        null,
        2
      ),
      "utf8"
    );

    return stabilityAssessment;
  }
});
