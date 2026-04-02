import { describe, expect, test } from "vitest";

import {
  isSupportedEventRole,
  isSupportedIngestFormat,
  isSupportedIngestTextSplit,
  parseIngestContent
} from "../src/cli/importer.js";

describe("cli importer", () => {
  test("parses txt paragraphs by default", () => {
    const result = parseIngestContent({
      filePath: "dataset.txt",
      content: "alpha\n\nbeta\n\n\n\ngamma",
      format: "auto",
      textField: "text",
      roleField: "role",
      timeField: "timestamp",
      defaultRole: "user",
      textSplitMode: "paragraph"
    });

    expect(result.format).toBe("txt");
    expect(result.records).toHaveLength(3);
    expect(result.skipped).toBe(0);
    expect(result.records.every((item) => item.role === "user")).toBe(true);
  });

  test("parses jsonl and skips invalid rows", () => {
    const result = parseIngestContent({
      filePath: "dataset.jsonl",
      content: [
        "{\"content\":\"hello\",\"speaker\":\"assistant\",\"ts\":1700000000}",
        "not json",
        "{\"content\":\"world\"}"
      ].join("\n"),
      format: "auto",
      textField: "content",
      roleField: "speaker",
      timeField: "ts",
      defaultRole: "user",
      textSplitMode: "paragraph"
    });

    expect(result.format).toBe("jsonl");
    expect(result.records).toHaveLength(2);
    expect(result.skipped).toBe(1);
    expect(result.warnings.length).toBe(1);
    expect(result.records[0]?.role).toBe("assistant");
    expect(result.records[1]?.role).toBe("user");
    expect(result.records[0]?.timestamp).toBe(1700000000000);
  });

  test("parses json object with records array", () => {
    const result = parseIngestContent({
      filePath: "records.json",
      content: JSON.stringify({
        records: [
          { text: "A", role: "system", timestamp: "2026-01-01T00:00:00Z", tag: "one" },
          { text: "B", role: "invalid" }
        ]
      }),
      format: "auto",
      textField: "text",
      roleField: "role",
      timeField: "timestamp",
      defaultRole: "assistant",
      textSplitMode: "paragraph"
    });

    expect(result.format).toBe("json");
    expect(result.records).toHaveLength(2);
    expect(result.records[0]?.role).toBe("system");
    expect(result.records[0]?.metadata?.["tag"]).toBe("one");
    expect(result.records[1]?.role).toBe("assistant");
  });

  test("validates supported enums", () => {
    expect(isSupportedIngestFormat("json")).toBe(true);
    expect(isSupportedIngestFormat("csv")).toBe(false);
    expect(isSupportedIngestTextSplit("line")).toBe(true);
    expect(isSupportedIngestTextSplit("token")).toBe(false);
    expect(isSupportedEventRole("tool")).toBe(true);
    expect(isSupportedEventRole("moderator")).toBe(false);
  });
});
