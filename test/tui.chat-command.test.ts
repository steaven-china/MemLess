import { describe, expect, test } from "vitest";

import { parseTuiInput } from "../src/tui/chatCommand.js";

describe("parseTuiInput", () => {
  test("parses normal text message", () => {
    const action = parseTuiInput("hello world");
    expect(action).toEqual({
      type: "message",
      text: "hello world"
    });
  });

  test("parses /new and /clear as newChat", () => {
    expect(parseTuiInput("/new")).toEqual({ type: "newChat" });
    expect(parseTuiInput("/clear")).toEqual({ type: "newChat" });
  });

  test("parses /mode command", () => {
    expect(parseTuiInput("/mode code")).toEqual({
      type: "mode",
      mode: "code"
    });
    expect(parseTuiInput("/mode PLAN")).toEqual({
      type: "mode",
      mode: "plan"
    });
  });

  test("returns invalid for /mode usage errors", () => {
    const missing = parseTuiInput("/mode");
    expect(missing).toEqual({
      type: "invalid",
      reason: "用法: /mode <chat|code|plan>"
    });

    const invalid = parseTuiInput("/mode dev");
    expect(invalid).toEqual({
      type: "invalid",
      reason: "用法: /mode <chat|code|plan>"
    });
  });

  test("parses stream control commands", () => {
    expect(parseTuiInput("/stop")).toEqual({ type: "interrupt" });
    expect(parseTuiInput("/resend")).toEqual({ type: "resend" });
    expect(parseTuiInput("/retry")).toEqual({ type: "resend" });
  });

  test("parses trace with limit", () => {
    const action = parseTuiInput("/trace 120");
    expect(action).toEqual({
      type: "trace",
      limit: 120
    });
  });

  test("parses readonly list aliases", () => {
    expect(parseTuiInput("/ls src")).toEqual({
      type: "list",
      path: "src"
    });
    expect(parseTuiInput("/list")).toEqual({
      type: "list",
      path: "."
    });
  });

  test("returns invalid action for unknown command", () => {
    const action = parseTuiInput("/unknown");
    expect(action.type).toBe("invalid");
  });
});
