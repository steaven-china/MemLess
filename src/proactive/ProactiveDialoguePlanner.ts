import type { Context, ProactivePlan } from "../types.js";

export interface ProactiveDialoguePlannerConfig {
  proactiveWakeupRequireEvidence: boolean;
  proactiveWakeupMinIntervalSeconds: number;
  proactiveWakeupMaxPerHour: number;
}

export class ProactiveDialoguePlanner {
  private lastWakeupTimestampMs = 0;
  private wakeupTimestamps: number[] = [];

  constructor(private readonly config: ProactiveDialoguePlannerConfig) {}

  buildPlan(input: { userInput: string; context: Context }): ProactivePlan {
    const signal = input.context.proactiveSignal;
    if (!signal || !signal.allowWakeup) {
      return {
        action: "noop",
        shouldSearchEvidence: false,
        searchQueries: [],
        messageSeed: "",
        reason: signal?.reason ?? "signal_unavailable"
      };
    }

    const now = Date.now();
    const minIntervalMs = Math.max(0, this.config.proactiveWakeupMinIntervalSeconds) * 1000;
    if (this.lastWakeupTimestampMs > 0 && now - this.lastWakeupTimestampMs < minIntervalMs) {
      return {
        action: "noop",
        shouldSearchEvidence: false,
        searchQueries: [],
        messageSeed: "",
        reason: "cooldown_blocked"
      };
    }

    this.wakeupTimestamps = this.wakeupTimestamps.filter((timestamp) => now - timestamp <= 60 * 60 * 1000);
    if (this.wakeupTimestamps.length >= Math.max(1, this.config.proactiveWakeupMaxPerHour)) {
      return {
        action: "noop",
        shouldSearchEvidence: false,
        searchQueries: [],
        messageSeed: "",
        reason: "hourly_budget_blocked"
      };
    }

    const shouldSearchEvidence =
      this.config.proactiveWakeupRequireEvidence || signal.evidenceNeedHint === "search_required";

    const searchQueries = shouldSearchEvidence ? [input.userInput] : [];
    const topIntent = signal.intents[0];
    const label = topIntent?.label ?? "当前任务";

    this.lastWakeupTimestampMs = now;
    this.wakeupTimestamps.push(now);

    if (signal.mode === "inject") {
      return {
        action: "ask_followup",
        shouldSearchEvidence,
        searchQueries,
        messageSeed: `我建议先推进「${label}」。要不要我直接给你下一步最小执行清单？`,
        reason: signal.reason
      };
    }

    return {
      action: "nudge_user",
      shouldSearchEvidence,
      searchQueries,
      messageSeed: `我可以继续跟进「${label}」，如果你愿意我现在就给出下一步。`,
      reason: signal.reason
    };
  }
}
