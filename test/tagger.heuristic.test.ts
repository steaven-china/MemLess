import { describe, expect, test } from "vitest";

import { MemoryBlock } from "../src/memory/MemoryBlock.js";
import { HeuristicTagger } from "../src/memory/tagger/HeuristicTagger.js";

describe("HeuristicTagger", () => {
  test("marks important when high-priority hints exist", async () => {
    const tagger = new HeuristicTagger({ importantThreshold: 0.6 });
    const block = buildBlock("b1", "生产故障导致紧急回滚");

    const tags = await tagger.tag(block);
    expect(tags).toEqual(["important"]);
  });

  test("marks normal when no important signal", async () => {
    const tagger = new HeuristicTagger({ importantThreshold: 0.6 });
    const block = buildBlock("b2", "整理需求并安排下周计划");

    const tags = await tagger.tag(block);
    expect(tags).toEqual(["normal"]);
  });

  test("marks important on conflict flag", async () => {
    const tagger = new HeuristicTagger({ importantThreshold: 0.6 });
    const block = buildBlock("b3", "普通内容");
    block.conflict = true;

    const tags = await tagger.tag(block);
    expect(tags).toEqual(["important"]);
  });
});

function buildBlock(id: string, summary: string): MemoryBlock {
  const block = new MemoryBlock(id, Date.now());
  block.summary = summary;
  block.rawEvents = [
    {
      id: `${id}_event`,
      role: "user",
      text: summary,
      timestamp: Date.now()
    }
  ];
  return block;
}
