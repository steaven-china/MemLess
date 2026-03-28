import type { I18n } from "../i18n/index.js";

export type TuiInputAction =
  | { type: "message"; text: string }
  | { type: "help" }
  | { type: "exit" }
  | { type: "newChat" }
  | { type: "mode"; mode: "chat" | "code" | "plan" }
  | { type: "seal" }
  | { type: "context"; query: string }
  | { type: "config" }
  | { type: "trace"; limit?: number }
  | { type: "traceClear" }
  | { type: "interrupt" }
  | { type: "resend" }
  | { type: "list"; path: string }
  | { type: "read"; path: string }
  | { type: "invalid"; reason: string };

export function parseTuiInput(rawInput: string, i18n: I18n): TuiInputAction {
  const input = rawInput.trim();
  if (!input) {
    return {
      type: "invalid",
      reason: i18n.t("tui.input.empty")
    };
  }

  if (!input.startsWith("/")) {
    return {
      type: "message",
      text: input
    };
  }

  if (input === "/help") {
    return { type: "help" };
  }
  if (input === "/exit") {
    return { type: "exit" };
  }
  if (input === "/new" || input === "/clear") {
    return { type: "newChat" };
  }
  if (input === "/seal") {
    return { type: "seal" };
  }
  if (input === "/config") {
    return { type: "config" };
  }
  if (input === "/trace-clear") {
    return { type: "traceClear" };
  }
  if (input === "/stop") {
    return { type: "interrupt" };
  }
  if (input === "/resend" || input === "/retry") {
    return { type: "resend" };
  }

  if (input === "/trace" || input.startsWith("/trace ")) {
    const rawLimit = getCommandArg(input);
    const parsedLimit = parseOptionalNumber(rawLimit);
    return {
      type: "trace",
      limit: parsedLimit
    };
  }

  if (input === "/mode" || input.startsWith("/mode ")) {
    const rawMode = getCommandArg(input)?.toLowerCase();
    if (rawMode === "chat" || rawMode === "code" || rawMode === "plan") {
      return {
        type: "mode",
        mode: rawMode
      };
    }
    return {
      type: "invalid",
      reason: i18n.t("tui.input.usage.mode")
    };
  }

  if (input.startsWith("/ctx ")) {
    const query = getCommandArg(input);
    if (!query) {
      return {
        type: "invalid",
        reason: i18n.t("tui.input.usage.ctx")
      };
    }
    return {
      type: "context",
      query
    };
  }

  if (
    input === "/ls" ||
    input === "/list" ||
    input.startsWith("/ls ") ||
    input.startsWith("/list ")
  ) {
    const pathInput = getCommandArg(input) ?? ".";
    return {
      type: "list",
      path: pathInput
    };
  }

  if (input.startsWith("/cat ") || input.startsWith("/read ")) {
    const pathInput = getCommandArg(input);
    if (!pathInput) {
      return {
        type: "invalid",
        reason: i18n.t("tui.input.usage.read")
      };
    }
    return {
      type: "read",
      path: pathInput
    };
  }

  return {
    type: "invalid",
    reason: i18n.t("tui.input.unknown", { input })
  };
}

function getCommandArg(input: string): string | undefined {
  const spaceIndex = input.indexOf(" ");
  if (spaceIndex < 0) return undefined;
  const value = input.slice(spaceIndex + 1).trim();
  return value.length > 0 ? value : undefined;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
