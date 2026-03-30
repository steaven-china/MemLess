import { describe, expect, test } from "vitest";

import { composeInterruptResumePrompt, retainLeadingSentences } from "../src/tui/MlexTuiApp.js";

describe("interrupt resume prompt helpers", () => {
  test("retains first three sentences across zh punctuation", () => {
    const partial = "第一句。第二句！第三句？第四句。";
    const retained = retainLeadingSentences(partial);
    expect(retained).toBe("第一句。 第二句！ 第三句？");
  });

  test("retains first three lines when newline separated", () => {
    const partial = "一行\n二行\n三行\n四行";
    const retained = retainLeadingSentences(partial);
    expect(retained).toBe("一行 二行 三行");
  });

  test("falls back to first 180 chars when sentence split is unavailable", () => {
    const partial = "a".repeat(220);
    const retained = retainLeadingSentences(partial);
    expect(retained.length).toBe(180);
    expect(retained).toBe("a".repeat(180));
  });

  test("caps retained content to 400 chars", () => {
    const longSentence = `${"甲".repeat(450)}。`;
    const retained = retainLeadingSentences(longSentence);
    expect(retained.length).toBe(400);
  });

  test("composes resume prompt with previous question, retained prefix and new question", () => {
    const prompt = composeInterruptResumePrompt(
      "之前的问题是什么？",
      "已输出第一句。已输出第二句。已输出第三句。已输出第四句。",
      "请换个角度继续"
    );

    expect(prompt).toContain("[打断前用户问题]");
    expect(prompt).toContain("之前的问题是什么？");
    expect(prompt).toContain("[已输出但被打断的前文（节选）]");
    expect(prompt).toContain("已输出第一句。 已输出第二句。 已输出第三句。");
    expect(prompt).toContain("[用户打断后新输入]");
    expect(prompt).toContain("请换个角度继续");
  });
});
