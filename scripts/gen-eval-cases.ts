/**
 * gen-eval-cases.ts
 *
 * Batch-generates ~1000 semantic eval cases using the configured LLM and saves
 * them to test/fixtures/eval.semantic.cases.json.
 *
 * Usage:
 *   # OpenAI:
 *   OPENAI_API_KEY=sk-... npx tsx scripts/gen-eval-cases.ts
 *
 *   # DeepSeek:
 *   DEEPSEEK_API_KEY=sk-... OPENAI_BASE_URL=https://api.deepseek.com/v1 \
 *     GEN_MODEL=deepseek-chat npx tsx scripts/gen-eval-cases.ts
 *
 *   # OpenRouter (DeepSeek v3.2):
 *   OPENAI_API_KEY=sk-or-... OPENAI_BASE_URL=https://openrouter.ai/api/v1 \
 *     GEN_MODEL=deepseek/deepseek-chat npx tsx scripts/gen-eval-cases.ts
 *
 *   # OpenRouter (Friendli DeepSeek):
 *   OPENAI_API_KEY=sk-or-... OPENAI_BASE_URL=https://openrouter.ai/api/v1 \
 *     GEN_MODEL=openrouter/friendli/deepseek-r1-distill-llama-70b npx tsx scripts/gen-eval-cases.ts
 *
 *   # Resume (skips categories already done):
 *   npx tsx scripts/gen-eval-cases.ts --resume
 *
 * Options:
 *   --target N     Total cases to generate (default 1000)
 *   --batch  N     Cases per LLM call (default 30)
 *   --concurrency N  Max parallel LLM requests (default 5)
 *   --resume       Don't overwrite existing fixture file; append new cases
 *   --dry-run      Print the first prompt and exit
 *   --verbose      Print prompts, raw LLM responses, and per-case summaries
 */

import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Config ─────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "../test/fixtures/eval.semantic.cases.json");

const API_BASE = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const API_KEY  = process.env.OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? "";
const MODEL    = process.env.GEN_MODEL ?? "gpt-4o-mini";

const TARGET_TOTAL = parseInt(process.argv.find(a => a.startsWith("--target="))?.split("=")[1] ?? "1000");
const BATCH_SIZE   = parseInt(process.argv.find(a => a.startsWith("--batch="))?.split("=")[1] ?? "30");
const CONCURRENCY  = parseInt(process.argv.find(a => a.startsWith("--concurrency="))?.split("=")[1] ?? "5");
const MAX_TOKENS   = parseInt(process.env.GEN_MAX_TOKENS ?? "8192");
const RESUME       = process.argv.includes("--resume");
const DRY_RUN      = process.argv.includes("--dry-run");
const VERBOSE      = process.argv.includes("--verbose");

if (!API_KEY) {
  console.error("Error: Set OPENAI_API_KEY or DEEPSEEK_API_KEY");
  process.exit(1);
}

// ─── Types ───────────────────────────────────────────────────────────────────

type Category = "pure-semantic" | "cross-lingual" | "paraphrase" | "noise" | "temporal" | "multi-hop";

interface SemanticCase {
  id: string;
  category: Category;
  blocks: string[][];
  query: string;
  groundTruth: string;
  topN?: number;
  note: string;
}

// ─── Category specs ──────────────────────────────────────────────────────────

const CATEGORY_SPECS: Array<{
  category: Category;
  count: number;
  description: string;
  topN: number;
  blockCount: string;
}> = [
  {
    category: "pure-semantic",
    count: Math.round(TARGET_TOTAL * 0.25),
    topN: 3,
    blockCount: "4 blocks (1 relevant + 3 distractors)",
    description: `
CATEGORY: pure-semantic
Design principle:
- The RELEVANT block (blocks[0]) uses domain-specific technical terms NOT in the query.
- The DISTRACTOR blocks share surface keywords with the query but are semantically unrelated.
- A keyword-only retriever should fail (distractors win on keyword overlap).
- A semantic embedder should succeed (relevant block wins on meaning).

Topics to cover: software engineering, databases, networking, security, cloud, microservices,
DevOps, ML systems, distributed systems, product management, frontend, mobile, etc.
Mix Chinese and English content freely. Query language may differ from block language.

Example structure:
  blocks[0] (RELEVANT): "PostgreSQL VACUUM 操作回收死元组，analyze 更新统计信息，避免查询计划退化。"
  blocks[1..3] (DISTRACTOR): all share query surface words like "慢", "查询", "数据库"
  query: "数据库查询为什么越来越慢"
  groundTruth: "VACUUM"  (substring only in the relevant block)`
  },
  {
    category: "cross-lingual",
    count: Math.round(TARGET_TOTAL * 0.15),
    topN: 3,
    blockCount: "4 blocks (1 relevant + 3 distractors)",
    description: `
CATEGORY: cross-lingual
Design principle:
- Stored content is in one language (ZH or EN), query is in the OTHER language.
- Distractors share surface terms with the query but are wrong answers.
- A multilingual semantic embedder should bridge the language gap.

Mix directions: ZH→EN and EN→ZH, roughly equal.
groundTruth must be a substring of blocks[0] only.

Example:
  blocks[0]: "The deployment pipeline uses blue-green strategy: traffic is cut over in 5 minutes with zero downtime."
  query: "我们的部署策略是什么，有没有停机时间"
  groundTruth: "blue-green"`
  },
  {
    category: "paraphrase",
    count: Math.round(TARGET_TOTAL * 0.20),
    topN: 3,
    blockCount: "4 blocks (1 relevant + 3 distractors)",
    description: `
CATEGORY: paraphrase
Design principle:
- The relevant block uses synonyms / domain jargon; the query rephrases with different words.
- ZERO or near-zero lexical overlap between query and relevant block's key answer term.
- Distractors share surface words with the query.

Example:
  blocks[0]: "熔断器在错误率超过阈值后进入开路状态，拒绝请求直到冷却期结束。"
  query: "服务保护机制是怎么防止级联故障的"
  groundTruth: "熔断器"  (not in query)`
  },
  {
    category: "noise",
    count: Math.round(TARGET_TOTAL * 0.15),
    topN: 3,
    blockCount: "11 blocks (1 relevant + 10 noise)",
    description: `
CATEGORY: noise
Design principle:
- 1 relevant block + 10 unrelated noise blocks (topN: 3).
- The relevant block is semantically related to the query but shares NO surface keywords with it.
- Noise blocks cover completely different topics (random tech chatter, team updates, etc.).
- Tests precision: can the retriever find the needle in the haystack?

The relevant block MUST NOT contain any of the query's significant words.
The 10 noise blocks MUST be topically unrelated to the query.

Example:
  query: "为什么今天早上服务一直告警"
  blocks[0]: "Prometheus AlertManager 配置了死信告警规则，rules.yml 里 for: 0m 导致每次评估都触发告警。"
  groundTruth: "AlertManager"
  blocks[1..10]: completely unrelated (frontend CSS, team lunch, DB backup, cert renewal…)`
  },
  {
    category: "temporal",
    count: Math.round(TARGET_TOTAL * 0.12),
    topN: 4,
    blockCount: "4 blocks (newer answer + older answer + 2 neutrals)",
    description: `
CATEGORY: temporal
Design principle:
- blocks[0] = NEWER (correct current answer)
- blocks[1] = OLDER (outdated answer, same topic but different specific value)
- blocks[2..3] = neutral (related but not contradicting)
- Query asks for the "current" state.
- The newer block must rank above the older block (topN: 4).
- groundTruth is a specific value/term ONLY in blocks[0].

Example:
  blocks[0]: "Redis 最大内存策略已更新为 allkeys-lru，最大内存限制 8GB。"  ← NEWER
  blocks[1]: "Redis 最大内存策略为 volatile-lru，限制 4GB。"              ← OLDER
  query: "Redis 的内存淘汰策略现在是什么"
  groundTruth: "allkeys-lru"  (only in blocks[0])`
  },
  {
    category: "multi-hop",
    count: Math.round(TARGET_TOTAL * 0.13),
    topN: 5,
    blockCount: "2 blocks (A + B, where A connects query to entity X, B describes X's issue)",
    description: `
CATEGORY: multi-hop
Design principle:
- blocks[0] = Block A: connects the query topic to a specific service/component X
- blocks[1] = Block B: describes X's root cause / key fact — NO query keywords
- Query asks about the outcome; the answer requires A→B reasoning.
- groundTruth is a term ONLY in blocks[1].

Example:
  blocks[0]: "报表服务依赖 data-warehouse 的 ETL 任务，每天凌晨一点执行。"
  blocks[1]: "data-warehouse ETL 任务因磁盘 I/O 限速配置错误，执行时间从 20 分钟延长至 4 小时。"
  query: "报表服务今天为什么这么晚才好"
  groundTruth: "I/O 限速"  (only in blocks[1])`
  }
];

// ─── LLM call ────────────────────────────────────────────────────────────────

async function callLLM(prompt: string): Promise<string> {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.9,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]!.message.content;
}

// ─── Prompt builder ──────────────────────────────────────────────────────────

function buildPrompt(spec: typeof CATEGORY_SPECS[number], batchIdx: number, batchSize: number): string {
  return `You are generating test cases for a semantic memory retrieval system.
Generate exactly ${batchSize} test cases for the following category.

${spec.description.trim()}

OUTPUT FORMAT (strict JSON array, no markdown fences, no extra text):
[
  {
    "id": "${spec.category}-gen-B${batchIdx}-001",
    "category": "${spec.category}",
    "blocks": [
      ["relevant block text here"],
      ["distractor/noise block 1"],
      ...
    ],
    "query": "the query string",
    "groundTruth": "exact substring that appears ONLY in ${spec.category === "multi-hop" ? "blocks[1]" : "blocks[0]"}",
    "topN": ${spec.topN},
    "note": "brief description of what this case tests"
  },
  ...
]

REQUIREMENTS:
1. Each case must have exactly ${spec.blockCount}.
2. Each inner array is one block (containing one string = one event text).
3. groundTruth MUST be a literal substring of ${spec.category === "multi-hop" ? "blocks[1] (Block B)" : "blocks[0]"} text.
4. groundTruth MUST NOT appear in any other block.
5. IDs: use pattern "${spec.category}-gen-B${batchIdx}-NNN" (zero-padded 3-digit index).
6. Vary topics widely — do not repeat the same domain across cases in this batch.
7. Mix Chinese and English naturally. At least 40% should involve Chinese text.
8. Make cases genuinely challenging: keyword-only retrieval should fail on most cases.
9. Output ONLY valid JSON. No markdown, no explanation.

Generate ${batchSize} cases now:`;
}

// ─── JSON extraction ─────────────────────────────────────────────────────────

function extractJsonArray(raw: string): SemanticCase[] {
  // Strip markdown fences if present
  const stripped = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  // Find first '[' and last ']'
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No JSON array found in response");
  const jsonStr = stripped.slice(start, end + 1);
  const parsed = JSON.parse(jsonStr) as SemanticCase[];
  // Normalize: LLM sometimes emits blocks as flat strings instead of string arrays
  for (const c of parsed) {
    if (Array.isArray(c.blocks)) {
      c.blocks = c.blocks.map((b: unknown) =>
        Array.isArray(b) ? b : typeof b === "string" ? [b] : [String(b)]
      );
    }
  }
  return parsed;
}

// ─── Validate cases ──────────────────────────────────────────────────────────

function validateCase(c: SemanticCase): string[] {
  const errors: string[] = [];
  if (!c.id) errors.push("missing id");
  if (!c.category) errors.push("missing category");
  if (!Array.isArray(c.blocks) || c.blocks.length < 2) errors.push("blocks must have ≥2 entries");
  if (!c.query) errors.push("missing query");
  if (!c.groundTruth) errors.push("missing groundTruth");

  // multi-hop: groundTruth is in blocks[1] (Block B), not blocks[0]
  // all other categories: groundTruth is in blocks[0]
  const answerBlockIdx = c.category === "multi-hop" ? 1 : 0;
  const answerBlock = c.blocks?.[answerBlockIdx];
  if (c.groundTruth && answerBlock) {
    const content = answerBlock.join(" ");
    if (!content.includes(c.groundTruth)) {
      errors.push(`groundTruth "${c.groundTruth}" not found in blocks[${answerBlockIdx}]`);
    }
  }

  // groundTruth must NOT appear in other blocks
  if (c.groundTruth && c.blocks?.length > 1) {
    const otherBlocks = c.blocks.filter((_, i) => i !== answerBlockIdx);
    const leaks = otherBlocks.filter(b => b.join(" ").includes(c.groundTruth));
    if (leaks.length > 0) errors.push(`groundTruth leaks into ${leaks.length} non-answer block(s)`);
  }
  return errors;
}

// ─── Batch processor ─────────────────────────────────────────────────────────

interface BatchTask {
  spec: typeof CATEGORY_SPECS[number];
  batchIdx: number;
  batchSize: number;
  totalBatches: number;
}

interface BatchResult {
  added: SemanticCase[];
  skipped: number;
  error?: string;
}

async function processBatch(
  task: BatchTask,
  existingIds: Set<string>
): Promise<BatchResult> {
  const { spec, batchIdx, batchSize, totalBatches } = task;
  const prompt = buildPrompt(spec, batchIdx * BATCH_SIZE, batchSize);
  const label = `[${spec.category}] batch ${batchIdx + 1}/${totalBatches}`;

  if (VERBOSE) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`${label} prompt:`);
    console.log(prompt);
    console.log("─".repeat(60));
  }

  try {
    const raw = await callLLM(prompt);
    if (VERBOSE) {
      console.log(`${label} response:`);
      console.log(raw);
      console.log("─".repeat(60));
    }

    let parsed: SemanticCase[];
    try {
      parsed = extractJsonArray(raw);
    } catch (e) {
      return {
        added: [],
        skipped: 0,
        error: `Parse error: ${e}\nRaw (first 200): ${raw.slice(0, 200)}`
      };
    }

    const added: SemanticCase[] = [];
    let skipped = 0;
    for (const c of parsed) {
      // Ensure unique IDs
      if (existingIds.has(c.id)) {
        c.id = `${c.id}-dup-${Date.now()}`;
      }
      const errs = validateCase(c);
      if (errs.filter(e => e.startsWith("groundTruth") && !e.includes("leaks")).length > 0) {
        skipped++;
        continue;
      }
      existingIds.add(c.id);
      added.push(c);
    }

    if (VERBOSE && added.length > 0) {
      for (const c of added) {
        console.log(`  [${c.id}] q="${c.query.slice(0, 50)}" gt="${c.groundTruth}"`);
      }
    }

    return { added, skipped };
  } catch (e) {
    return {
      added: [],
      skipped: 0,
      error: `Request error: ${e}`
    };
  }
}

// ─── Concurrent batch runner ─────────────────────────────────────────────────

async function runBatchesConcurrent(
  tasks: BatchTask[],
  existingIds: Set<string>,
  allCases: SemanticCase[]
): Promise<{ generated: number; skipped: number; errors: number }> {
  let totalGenerated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // Process in chunks of CONCURRENCY
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const chunk = tasks.slice(i, i + CONCURRENCY);
    const promises = chunk.map(t => processBatch(t, existingIds));
    const results = await Promise.all(promises);

    for (let j = 0; j < results.length; j++) {
      const result = results[j]!;
      const task = chunk[j]!;
      const label = `[${task.spec.category}] batch ${task.batchIdx + 1}/${task.totalBatches}`;

      if (result.error) {
        console.error(`${label} ✗ ${result.error}`);
        totalErrors++;
      } else {
        allCases.push(...result.added);
        totalGenerated += result.added.length;
        totalSkipped += result.skipped;
        console.log(`${label} ✓ added ${result.added.length}/${result.added.length + result.skipped}`);
      }
    }

    // Save after each concurrent chunk
    await fs.writeFile(FIXTURE_PATH, JSON.stringify(allCases, null, 2) + "\n", "utf8");

    // Polite rate limiting between chunks
    if (i + CONCURRENCY < tasks.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return { generated: totalGenerated, skipped: totalSkipped, errors: totalErrors };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Load existing cases if resuming
  let existing: SemanticCase[] = [];
  if (RESUME) {
    try {
      const raw = await fs.readFile(FIXTURE_PATH, "utf8");
      existing = JSON.parse(raw) as SemanticCase[];
      console.log(`Resuming: ${existing.length} cases already in fixture.`);
    } catch {
      console.log("No existing fixture found, starting fresh.");
    }
  }

  const existingIds = new Set(existing.map(c => c.id));
  const allCases: SemanticCase[] = [...existing];

  // Build task list
  const tasks: BatchTask[] = [];
  for (const spec of CATEGORY_SPECS) {
    const currentCount = allCases.filter(c => c.category === spec.category).length;
    const needed = spec.count - currentCount;
    if (needed <= 0) {
      console.log(`[${spec.category}] already have ${currentCount}/${spec.count}, skipping.`);
      continue;
    }
    console.log(`[${spec.category}] need ${needed} more (have ${currentCount}/${spec.count})`);

    const batches = Math.ceil(needed / BATCH_SIZE);
    for (let b = 0; b < batches; b++) {
      const batchSize = Math.min(BATCH_SIZE, needed - b * BATCH_SIZE);
      tasks.push({ spec, batchIdx: b, batchSize, totalBatches: batches });
    }
  }

  if (tasks.length === 0) {
    console.log("All categories complete!");
    return;
  }

  // Dry-run: show first prompt and exit
  if (DRY_RUN) {
    const first = tasks[0]!;
    const prompt = buildPrompt(first.spec, 0, first.batchSize);
    console.log("\n--- DRY RUN: First prompt ---\n");
    console.log(prompt);
    process.exit(0);
  }

  console.log(`\nProcessing ${tasks.length} batches with concurrency=${CONCURRENCY}...\n`);
  const { generated, skipped, errors } = await runBatchesConcurrent(tasks, existingIds, allCases);

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Total cases in fixture: ${allCases.length}`);
  console.log(`Generated this run:     ${generated}`);
  console.log(`Skipped (invalid):      ${skipped}`);
  console.log(`Batch errors:           ${errors}`);
  console.log(`Saved to:               ${FIXTURE_PATH}`);

  // Category breakdown
  console.log("\nBreakdown by category:");
  for (const spec of CATEGORY_SPECS) {
    const n = allCases.filter(c => c.category === spec.category).length;
    const bar = "█".repeat(Math.floor(n / (TARGET_TOTAL / 50)));
    console.log(`  ${spec.category.padEnd(16)} ${String(n).padStart(4)}  ${bar}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
