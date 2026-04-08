/**
 * retrieval.pipeline.bench.ts — Retrieval pipeline latency benchmark
 *
 * Measures per-stage timing of the full getContext() path:
 *   embed → keyword retrieve → vector retrieve → graph retrieve →
 *   fusion → prediction → block load → raw backtrack → assemble
 *
 * Run:
 *   npx vitest run test/retrieval.pipeline.bench.ts --reporter=verbose
 *
 * Scale control:
 *   MLEX_BENCH_BLOCKS=100    Number of sealed blocks to create
 *   MLEX_BENCH_QUERIES=20    Number of queries to run
 *   MLEX_BENCH_WARMUP=3      Warmup queries (excluded from timing)
 */

import { describe, expect, test } from "vitest";
import { performance } from "node:perf_hooks";

import { createRuntime, type Runtime } from "../src/container.js";
import { createId } from "../src/utils/id.js";

const BLOCK_COUNT = parseInt(process.env.MLEX_BENCH_BLOCKS ?? "50", 10);
const QUERY_COUNT = parseInt(process.env.MLEX_BENCH_QUERIES ?? "20", 10);
const WARMUP_COUNT = parseInt(process.env.MLEX_BENCH_WARMUP ?? "3", 10);

const SAMPLE_TOPICS = [
  "payment processing webhook idempotency retry logic",
  "database migration schema rollback strategy",
  "authentication middleware session token storage",
  "kubernetes deployment rolling update strategy",
  "cache invalidation distributed consistency",
  "message queue consumer dead letter handling",
  "rate limiting token bucket algorithm",
  "circuit breaker pattern fault tolerance",
  "event sourcing CQRS projection rebuild",
  "observability tracing span context propagation",
  "GraphQL resolver N+1 query optimization",
  "WebSocket connection pool heartbeat",
  "file upload multipart streaming validation",
  "search engine inverted index sharding",
  "recommendation engine collaborative filtering",
  "notification service push delivery retry",
  "audit log tamper-proof append-only storage",
  "feature flag gradual rollout percentage",
  "data pipeline backpressure flow control",
  "API versioning backward compatibility contract"
];

const QUERY_POOL = [
  "How does the payment retry logic work?",
  "What is the database migration rollback procedure?",
  "Explain the session token authentication flow",
  "How are kubernetes deployments configured?",
  "What cache invalidation strategy do we use?",
  "How does the dead letter queue work?",
  "What rate limiting algorithm is implemented?",
  "Describe the circuit breaker pattern",
  "How does event sourcing projection work?",
  "What observability tracing is in place?",
  "How to fix GraphQL N+1 queries?",
  "WebSocket connection lifecycle management",
  "File upload validation requirements",
  "Search index architecture overview",
  "Recommendation system approach",
  "Notification delivery guarantees",
  "Audit log integrity mechanism",
  "Feature flag rollout process",
  "Data pipeline backpressure handling",
  "API versioning strategy"
];

function generateBlockEvents(topicIndex: number, blockIndex: number): string[] {
  const topic = SAMPLE_TOPICS[topicIndex % SAMPLE_TOPICS.length]!;
  const keywords = topic.split(" ");
  return [
    `User asked about ${topic} — block ${blockIndex}`,
    `The ${keywords[0]} system uses ${keywords.slice(1, 3).join(" ")} to handle ${keywords.slice(3).join(" ")}. Implementation details follow.`,
    `Key considerations: ${keywords.map((k, i) => `${k}=${i * 7 + blockIndex}`).join(", ")}. See docs for more.`
  ];
}

interface StageTiming {
  label: string;
  ms: number;
}

interface QueryTiming {
  query: string;
  totalMs: number;
  blockCount: number;
  recentEventCount: number;
  formattedLength: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)]!;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

describe(`Retrieval pipeline bench — ${BLOCK_COUNT} blocks, ${QUERY_COUNT} queries`, () => {
  test("measures getContext latency breakdown", async () => {
    let runtime: Runtime | undefined;
    try {
      runtime = createRuntime({
        manager: {
          enableRelationExpansion: true,
          relationDepth: 2,
          graphExpansionTopK: 4,
          finalTopK: 10,
          semanticTopK: 15,
          predictionEnabled: true,
          predictionTopK: 5
        }
      });

      // --- Ingest phase ---
      const ingestStart = performance.now();
      const now = Date.now();
      for (let i = 0; i < BLOCK_COUNT; i++) {
        const events = generateBlockEvents(i, i);
        const offset = (BLOCK_COUNT - i) * 5000;
        for (const text of events) {
          await runtime.memoryManager.addEvent({
            id: createId("event"),
            role: i % 3 === 0 ? "user" : "assistant",
            text,
            timestamp: now - offset
          });
        }
        await runtime.memoryManager.sealCurrentBlock();
      }
      // Add a few recent unseal events for active block scoring
      for (let i = 0; i < 3; i++) {
        await runtime.memoryManager.addEvent({
          id: createId("event"),
          role: "user",
          text: `Recent follow-up about ${SAMPLE_TOPICS[i % SAMPLE_TOPICS.length]}`,
          timestamp: now - 100 + i
        });
      }
      const ingestMs = performance.now() - ingestStart;

      // --- Warmup phase ---
      for (let i = 0; i < WARMUP_COUNT; i++) {
        const q = QUERY_POOL[i % QUERY_POOL.length]!;
        await runtime.memoryManager.getContext(q);
      }

      // --- Query phase ---
      const queryTimings: QueryTiming[] = [];
      for (let i = 0; i < QUERY_COUNT; i++) {
        const query = QUERY_POOL[i % QUERY_POOL.length]!;
        const start = performance.now();
        const context = await runtime.memoryManager.getContext(query);
        const elapsed = performance.now() - start;

        queryTimings.push({
          query,
          totalMs: elapsed,
          blockCount: context.blocks.length,
          recentEventCount: context.recentEvents.length,
          formattedLength: context.formatted.length
        });
      }

      // --- Report ---
      const totalTimes = queryTimings.map((t) => t.totalMs);

      console.log("\n=== RETRIEVAL PIPELINE BENCHMARK ===");
      console.log(`blocks: ${BLOCK_COUNT}  queries: ${QUERY_COUNT}  warmup: ${WARMUP_COUNT}`);
      console.log(`ingest+seal: ${ingestMs.toFixed(1)}ms (${(ingestMs / BLOCK_COUNT).toFixed(2)}ms/block)`);
      console.log("");
      console.log("--- getContext() latency ---");
      console.log(`  avg:  ${avg(totalTimes).toFixed(2)}ms`);
      console.log(`  p50:  ${percentile(totalTimes, 50).toFixed(2)}ms`);
      console.log(`  p90:  ${percentile(totalTimes, 90).toFixed(2)}ms`);
      console.log(`  p95:  ${percentile(totalTimes, 95).toFixed(2)}ms`);
      console.log(`  p99:  ${percentile(totalTimes, 99).toFixed(2)}ms`);
      console.log(`  min:  ${Math.min(...totalTimes).toFixed(2)}ms`);
      console.log(`  max:  ${Math.max(...totalTimes).toFixed(2)}ms`);
      console.log("");

      const avgBlocks = avg(queryTimings.map((t) => t.blockCount));
      const avgRecent = avg(queryTimings.map((t) => t.recentEventCount));
      const avgFormatted = avg(queryTimings.map((t) => t.formattedLength));
      console.log("--- result shape ---");
      console.log(`  avg blocks returned:  ${avgBlocks.toFixed(1)}`);
      console.log(`  avg recent events:    ${avgRecent.toFixed(1)}`);
      console.log(`  avg formatted chars:  ${avgFormatted.toFixed(0)}`);
      console.log("");

      // Per-query detail
      console.log("--- per-query detail ---");
      for (const t of queryTimings) {
        const truncatedQuery = t.query.length > 50 ? t.query.slice(0, 50) + "..." : t.query;
        console.log(
          `  ${t.totalMs.toFixed(1).padStart(8)}ms  blocks=${String(t.blockCount).padStart(2)}  "${truncatedQuery}"`
        );
      }

      // Sanity assertions
      expect(queryTimings.length).toBe(QUERY_COUNT);
      expect(avg(totalTimes)).toBeLessThan(500); // should be well under 500ms per query
      for (const t of queryTimings) {
        expect(t.blockCount).toBeGreaterThan(0);
      }

    } finally {
      await runtime?.close();
    }
  }, 120_000);

  test("measures scaling: 10 vs 50 vs 100 blocks", async () => {
    const scales = [10, 50, 100];
    const queriesPerScale = 10;
    const results: Array<{ blocks: number; avgMs: number; p95Ms: number }> = [];

    for (const blockCount of scales) {
      let runtime: Runtime | undefined;
      try {
        runtime = createRuntime({
          manager: {
            enableRelationExpansion: true,
            finalTopK: 10,
            semanticTopK: 15,
            predictionEnabled: blockCount >= 20
          }
        });

        const now = Date.now();
        for (let i = 0; i < blockCount; i++) {
          const events = generateBlockEvents(i, i);
          for (const text of events) {
            await runtime.memoryManager.addEvent({
              id: createId("event"),
              role: "user",
              text,
              timestamp: now - (blockCount - i) * 5000
            });
          }
          await runtime.memoryManager.sealCurrentBlock();
        }

        // Warmup
        await runtime.memoryManager.getContext("warmup query");

        // Measure
        const times: number[] = [];
        for (let i = 0; i < queriesPerScale; i++) {
          const query = QUERY_POOL[i % QUERY_POOL.length]!;
          const start = performance.now();
          await runtime.memoryManager.getContext(query);
          times.push(performance.now() - start);
        }

        results.push({
          blocks: blockCount,
          avgMs: avg(times),
          p95Ms: percentile(times, 95)
        });
      } finally {
        await runtime?.close();
      }
    }

    console.log("\n=== SCALING BENCHMARK ===");
    console.log("blocks  |  avg(ms)  |  p95(ms)");
    console.log("--------|-----------|----------");
    for (const r of results) {
      console.log(
        `${String(r.blocks).padStart(6)}  |  ${r.avgMs.toFixed(2).padStart(7)}  |  ${r.p95Ms.toFixed(2).padStart(7)}`
      );
    }

    // Verify scaling: use avg ratio (more stable than p95 at small scales)
    // and absolute ceiling — 100-block queries must stay under 20ms
    const r10 = results.find((r) => r.blocks === 10);
    const r100 = results.find((r) => r.blocks === 100);
    if (r10 && r100) {
      const avgRatio = r100.avgMs / Math.max(r10.avgMs, 0.1);
      const p95Ratio = r100.p95Ms / Math.max(r10.p95Ms, 0.1);
      console.log(`\nscaling ratio (100/10 blocks avg):  ${avgRatio.toFixed(2)}x`);
      console.log(`scaling ratio (100/10 blocks p95):  ${p95Ratio.toFixed(2)}x`);
      expect(r100.p95Ms).toBeLessThan(20);
      expect(avgRatio).toBeLessThan(30);
    }

    expect(results.length).toBe(scales.length);
  }, 120_000);
});
