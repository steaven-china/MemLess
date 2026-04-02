import { describe, expect, test } from "vitest";

import { decideTopicShiftLevel } from "../src/memory/PartitionMemoryManager.js";

const thresholds = {
  querySimilaritySoftMax: 0.35,
  querySimilarityHardMax: 0.2,
  keywordOverlapSoftMax: 0.3,
  keywordOverlapHardMax: 0.15,
  retrievalOverlapSoftMax: 0.35,
  retrievalOverlapHardMax: 0.2
};

describe("decideTopicShiftLevel", () => {
  test("returns hard when at least two hard signals are met", () => {
    const result = decideTopicShiftLevel({
      querySimilarity: 0.18,
      keywordOverlap: 0.12,
      retrievalOverlap: 0.45,
      thresholds
    });

    expect(result.level).toBe("hard");
    expect(result.reason).toBe("topic_shift_hard");
  });

  test("returns soft when soft signals are met but hard does not", () => {
    const result = decideTopicShiftLevel({
      querySimilarity: 0.3,
      keywordOverlap: 0.28,
      retrievalOverlap: 0.6,
      thresholds
    });

    expect(result.level).toBe("soft");
    expect(result.reason).toBe("topic_shift_soft");
  });

  test("returns none when only one soft signal is met", () => {
    const result = decideTopicShiftLevel({
      querySimilarity: 0.8,
      keywordOverlap: 0.25,
      retrievalOverlap: 0.9,
      thresholds
    });

    expect(result.level).toBe("none");
    expect(result.reason).toBe("topic_shift_not_met");
  });
});
