import { describe, expect, test } from "vitest";

import { computeEntropySignalWeights } from "../src/memory/PartitionMemoryManager.js";

const NUM_SIGNALS = 6;

describe("computeEntropySignalWeights", () => {
  test("returns all 1.0 when every history is empty (cold start)", () => {
    const histories: number[][] = Array.from({ length: NUM_SIGNALS }, () => []);
    const weights = computeEntropySignalWeights(histories);
    expect(weights).toHaveLength(NUM_SIGNALS);
    for (const w of weights) expect(w).toBe(1.0);
  });

  test("returns all 1.0 when every history has only one point", () => {
    const histories = Array.from({ length: NUM_SIGNALS }, () => [0.5]);
    const weights = computeEntropySignalWeights(histories);
    for (const w of weights) expect(w).toBe(1.0);
  });

  test("returns all 1.0 when all signals have identical variance (tie)", () => {
    // All histories are [0.1, 0.9, 0.1, 0.9] → same variance → tie → all 1.0
    const histories = Array.from({ length: NUM_SIGNALS }, () => [0.1, 0.9, 0.1, 0.9]);
    const weights = computeEntropySignalWeights(histories);
    for (const w of weights) expect(w).toBeCloseTo(1.0, 5);
  });

  test("stable signal gets higher weight than noisy signal", () => {
    // Signal 0: constant 0.5 → near-zero variance → high weight (→ 2.0)
    // Signal 1: oscillates wildly 0..1 → high variance → low weight (→ 0.5)
    // Remaining signals: empty → fall back to 1.0 raw weight
    const stableHistory = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const noisyHistory = [0.0, 1.0, 0.0, 1.0, 0.0, 1.0];
    const emptyHistory: number[] = [];

    const histories = [
      stableHistory,
      noisyHistory,
      emptyHistory,
      emptyHistory,
      emptyHistory,
      emptyHistory
    ];

    const weights = computeEntropySignalWeights(histories);
    // Stable > empty/fallback > noisy
    expect(weights[0]).toBeGreaterThan(weights[1]!);
    // Stable should be near max (2.0)
    expect(weights[0]).toBeGreaterThan(1.5);
    // Noisy should be near min (0.5)
    expect(weights[1]).toBeLessThan(0.75);
  });

  test("all weights are within [0.5, 2.0] range", () => {
    const histories = [
      [0.1, 0.2, 0.3, 0.4],   // increasing
      [0.9, 0.1, 0.9, 0.1],   // oscillating
      [0.5, 0.5, 0.5, 0.5],   // constant
      [0.0, 0.0, 1.0, 1.0],   // step change
      [],                       // cold start
      [0.3]                    // single point
    ];
    const weights = computeEntropySignalWeights(histories);
    for (const w of weights) {
      expect(w).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(w).toBeLessThanOrEqual(2.0 + 1e-9);
    }
  });

  test("weighted score threshold mirrors old equal-weight count when all variances equal", () => {
    // When all 6 signals have identical variance, weights are all 1.0.
    // Weighted score = (number of true signals) × 1.0.
    // totalWeight = 6 × 1.0 = 6.
    // Threshold = (minSignals / 6) × totalWeight = minSignals.
    // So: weightedScore >= minSignals ↔ trueCount >= minSignals — exact equivalence.
    const histories = Array.from({ length: NUM_SIGNALS }, () => [0.1, 0.9, 0.1, 0.9]);
    const weights = computeEntropySignalWeights(histories);

    const trueCount = 3; // 3 signals trigger
    const boolSignals = Array.from({ length: NUM_SIGNALS }, (_, i) => i < trueCount);

    const weightedScore = boolSignals.reduce((sum, b, i) => sum + (b ? weights[i]! : 0), 0);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const minSignals = 2;

    // Old logic: lowSignals (3) >= minSignals (2) → trigger
    const oldTrigger = trueCount >= minSignals;

    // New logic: weighted proportion
    const newTrigger = weightedScore >= (minSignals / NUM_SIGNALS) * totalWeight;

    expect(newTrigger).toBe(oldTrigger);
  });

  test("high-variance signal alone does not cross threshold when others are stable", () => {
    // Only the noisy signal fires. Its weight is near 0.5.
    // minSignals=2 → threshold = (2/6) × totalWeight.
    // weightedScore ≈ 0.5 (only the low-weight noisy signal fires).
    // totalWeight ≈ 1×2.0 + 1×0.5 + 4×1.0 = 6.5 (stable, noisy, 4 cold-start).
    // threshold ≈ (2/6) × 6.5 ≈ 2.17 → 0.5 < 2.17 → no trigger.
    const stableHistory = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const noisyHistory = [0.0, 1.0, 0.0, 1.0, 0.0, 1.0];
    const histories = [
      stableHistory,
      noisyHistory,
      [] as number[],
      [] as number[],
      [] as number[],
      [] as number[]
    ];

    const weights = computeEntropySignalWeights(histories);

    // Only the noisy signal (index 1) fires
    const boolSignals = [false, true, false, false, false, false];
    const weightedScore = boolSignals.reduce((sum, b, i) => sum + (b ? weights[i]! : 0), 0);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const minSignals = 2;

    expect(weightedScore).toBeLessThan((minSignals / NUM_SIGNALS) * totalWeight);
  });

  test("stable signals reliably cross threshold even at minSignals=2", () => {
    // Stable signals 0 and 2 fire (weight near 2.0 each).
    // weightedScore ≈ 4.0; totalWeight ≈ 2×2.0 + 1×0.5 + 3×1.0 ≈ 8.5.
    // threshold = (2/6) × 8.5 ≈ 2.83 < 4.0 → trigger.
    const stableHistory = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const noisyHistory = [0.0, 1.0, 0.0, 1.0, 0.0, 1.0];
    const histories = [
      stableHistory,
      noisyHistory,
      stableHistory,
      [] as number[],
      [] as number[],
      [] as number[]
    ];

    const weights = computeEntropySignalWeights(histories);
    const boolSignals = [true, false, true, false, false, false];

    const weightedScore = boolSignals.reduce((sum, b, i) => sum + (b ? weights[i]! : 0), 0);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const minSignals = 2;

    expect(weightedScore).toBeGreaterThan((minSignals / NUM_SIGNALS) * totalWeight);
  });
});
