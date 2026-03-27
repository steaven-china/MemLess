import { describe, expect, test } from "vitest";

import { parseToolCall } from "../src/agent/AgentToolExecutor.js";

describe("parseToolCall", () => {
  test("parses tagged tool_call json", () => {
    const parsed = parseToolCall(
      '<tool_call>{"name":"readonly.list","args":{"path":"."}}</tool_call>'
    );
    expect(parsed).toEqual({
      name: "readonly.list",
      args: { path: "." }
    });
  });

  test("parses fenced json tool object", () => {
    const parsed = parseToolCall(
      '```json\n{"tool":"readonly.read","arguments":{"path":"README.md"}}\n```'
    );
    expect(parsed).toEqual({
      name: "readonly.read",
      args: { path: "README.md" }
    });
  });

  test("parses function-call style object with string arguments", () => {
    const parsed = parseToolCall(
      JSON.stringify({
        type: "function",
        function: {
          name: "history.query",
          arguments: "{\"query\":\"支付 webhook\",\"topBlocks\":3}"
        }
      })
    );
    expect(parsed).toEqual({
      name: "history.query",
      args: {
        query: "支付 webhook",
        topBlocks: 3
      }
    });
  });

  test("parses extended history.query arguments", () => {
    const parsed = parseToolCall(
      '<tool_call>{"name":"history.query","args":{"query":"支付 webhook","mode":"semantic","limit":2,"keywords":["幂等"],"includePrediction":false}}</tool_call>'
    );
    expect(parsed).toEqual({
      name: "history.query",
      args: {
        query: "支付 webhook",
        mode: "semantic",
        limit: 2,
        keywords: ["幂等"],
        includePrediction: false
      }
    });
  });
});
