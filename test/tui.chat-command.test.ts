import { describe, expect, test } from "vitest";

import { createI18n } from "../src/i18n/index.js";
import { parseTuiInput } from "../src/tui/chatCommand.js";

describe("parseTuiInput", () => {
  const i18n = createI18n({ locale: "zh-CN" });
  test("parses normal text message", () => {
    const action = parseTuiInput("hello world", i18n);
    expect(action).toEqual({
      type: "message",
      text: "hello world"
    });
  });

  test("parses /new and /clear as newChat", () => {
    expect(parseTuiInput("/new", i18n)).toEqual({ type: "newChat" });
    expect(parseTuiInput("/clear", i18n)).toEqual({ type: "newChat" });
  });

  test("parses /mode command", () => {
    expect(parseTuiInput("/mode code", i18n)).toEqual({
      type: "mode",
      mode: "code"
    });
    expect(parseTuiInput("/mode PLAN", i18n)).toEqual({
      type: "mode",
      mode: "plan"
    });
  });

  test("returns invalid for /mode usage errors", () => {
    const missing = parseTuiInput("/mode", i18n);
    expect(missing).toEqual({
      type: "invalid",
      reason: "用法: /mode <chat|code|plan>"
    });

    const invalid = parseTuiInput("/mode dev", i18n);
    expect(invalid).toEqual({
      type: "invalid",
      reason: "用法: /mode <chat|code|plan>"
    });
  });

  test("parses stream control commands", () => {
    expect(parseTuiInput("/stop", i18n)).toEqual({ type: "interrupt" });
    expect(parseTuiInput("/resend", i18n)).toEqual({ type: "resend" });
    expect(parseTuiInput("/retry", i18n)).toEqual({ type: "resend" });
  });

  test("parses trace with limit", () => {
    const action = parseTuiInput("/trace 120", i18n);
    expect(action).toEqual({
      type: "trace",
      limit: 120
    });
  });

  test("parses readonly list aliases", () => {
    expect(parseTuiInput("/ls src", i18n)).toEqual({
      type: "list",
      path: "src"
    });
    expect(parseTuiInput("/list", i18n)).toEqual({
      type: "list",
      path: "."
    });
  });

  test("returns invalid action for unknown command", () => {
    const action = parseTuiInput("/unknown", i18n);
    expect(action.type).toBe("invalid");
  });
});
