import { describe, expect, test } from "vitest";

import { AnnCosineIndex } from "../src/memory/vector/AnnCosineIndex.js";

describe("AnnCosineIndex", () => {
  test("returns nearest ids by cosine score", () => {
    const index = new AnnCosineIndex({
      dimension: 3,
      tableCount: 4,
      bitsPerTable: 8
    });

    index.upsert("a", [1, 0, 0]);
    index.upsert("b", [0.9, 0.1, 0]);
    index.upsert("c", [0, 1, 0]);

    const hits = index.search([0.95, 0.05, 0], 2);
    expect(hits.map((item) => item.id)).toEqual(["a", "b"]);
    expect((hits[0]?.score ?? 0)).toBeGreaterThanOrEqual(hits[1]?.score ?? 0);
  });

  test("supports min score filtering", () => {
    const index = new AnnCosineIndex({ dimension: 2 });
    index.upsert("x", [1, 0]);
    index.upsert("y", [0, 1]);

    const hits = index.search([1, 0], 2, { minScore: 0.5 });
    expect(hits.map((item) => item.id)).toEqual(["x"]);
  });
});
