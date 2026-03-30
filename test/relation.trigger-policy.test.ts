import { describe, expect, test } from "vitest";

import { decideRelationLowInfoHighEntropy } from "../src/memory/prediction/RelationTriggerPolicy.js";

describe("RelationTriggerPolicy", () => {
  test("matches when active chain is short", () => {
    const result = decideRelationLowInfoHighEntropy({
      relationProbabilities: [1],
      thresholds: { lowInfoThreshold: 0.25, highEntropyThreshold: 0.75, shortChainMaxSize: 2 }
    });

    expect(result.matched).toBe(true);
    expect(result.matchedByShortChain).toBe(true);
    expect(result.activeChainSize).toBe(1);
  });

  test("matches when total info is low and conditional entropy is high", () => {
    const result = decideRelationLowInfoHighEntropy({
      relationProbabilities: [0.34, 0.33, 0.33],
      thresholds: { lowInfoThreshold: 0.25, highEntropyThreshold: 0.75, shortChainMaxSize: 2 }
    });

    expect(result.matched).toBe(true);
    expect(result.totalConditionalInfo).toBeLessThan(0.25);
    expect(result.conditionalEntropy).toBeGreaterThan(0.75);
  });

  test("does not match when total info is high", () => {
    const result = decideRelationLowInfoHighEntropy({
      relationProbabilities: [0.9, 0.07, 0.03],
      thresholds: { lowInfoThreshold: 0.25, highEntropyThreshold: 0.75, shortChainMaxSize: 2 }
    });

    expect(result.matched).toBe(false);
    expect(result.totalConditionalInfo).toBeGreaterThanOrEqual(0.25);
  });

  test("does not match when conditional entropy is low", () => {
    const result = decideRelationLowInfoHighEntropy({
      relationProbabilities: [0.5, 0.5],
      thresholds: { lowInfoThreshold: 0.8, highEntropyThreshold: 1.1, shortChainMaxSize: 1 }
    });

    expect(result.matched).toBe(false);
    expect(result.conditionalEntropy).toBeLessThanOrEqual(1);
  });
});
