import type { I18n } from "../i18n/index.js";
import type { Context, ProactivePlan } from "../types.js";
import { extractKeywords } from "../utils/text.js";

export interface ProactiveDialoguePlannerConfig {
  proactiveWakeupRequireEvidence: boolean;
  proactiveWakeupMinIntervalSeconds: number;
  proactiveWakeupMaxPerHour: number;
  maxSearchQueries?: number;
  i18n?: I18n;
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

    const searchQueries = shouldSearchEvidence
      ? this.generateSearchQueries(input.userInput, input.context)
      : [];
    const topIntent = signal.intents[0];
    const label = topIntent?.label ?? this.config.i18n?.t("proactive.intent.default_label") ?? "current task";

    this.lastWakeupTimestampMs = now;
    this.wakeupTimestamps.push(now);

    const isLowEntropyReason =
      signal.reason.startsWith("low_entropy_") || signal.reason.startsWith("relation_");
    const lowEntropyPrompt =
      this.config.i18n?.t("proactive.message.low_entropy") ??
      "我可能缺少关键关系信息：涉及哪些实体？它们之间是什么关系（依赖/因果/流程/约束）？";

    if (signal.mode === "inject") {
      return {
        action: "ask_followup",
        shouldSearchEvidence,
        searchQueries,
        messageSeed: isLowEntropyReason
          ? lowEntropyPrompt
          : (this.config.i18n?.t("proactive.message.suggest", { label }) ??
            `I suggest prioritizing "${label}". Do you want me to give you the smallest next-step checklist now?`),
        reason: signal.reason
      };
    }

    return {
      action: "nudge_user",
      shouldSearchEvidence,
      searchQueries,
      messageSeed:
        this.config.i18n?.t("proactive.message.followup", { label }) ??
        `I can continue on "${label}" and provide the next step now if you want.`,
      reason: signal.reason
    };
  }

  private generateSearchQueries(userInput: string, context: Context): string[] {
    const max = Math.max(1, this.config.maxSearchQueries ?? 3);
    const candidates: string[] = [userInput];

    // Extract from top-3 block summaries (first 60 chars each)
    for (const block of context.blocks.slice(0, 3)) {
      if (block.summary) {
        const clipped = block.summary.slice(0, 60).trim();
        if (clipped && !candidates.includes(clipped)) {
          candidates.push(clipped);
        }
      }
    }

    // Extract keywords from the top block and add distinct ones
    const topBlock = context.blocks[0];
    if (topBlock?.keywords) {
      for (const kw of topBlock.keywords.slice(0, 4)) {
        if (kw && !candidates.includes(kw)) {
          candidates.push(kw);
        }
      }
    }

    // Fallback: if no context blocks, generate via extractKeywords from userInput itself
    if (candidates.length === 1 && userInput.length > 0) {
      for (const kw of extractKeywords(userInput, 3)) {
        if (kw !== userInput && !candidates.includes(kw)) {
          candidates.push(kw);
        }
      }
    }

    // userInput always goes first; remaining sorted by ascending overlap with userInput
    // (shorter common prefix = more diverse = higher value)
    const rest = candidates.slice(1).sort((a, b) => {
      const la = longestCommonPrefixLength(userInput, a);
      const lb = longestCommonPrefixLength(userInput, b);
      return la - lb; // ascending: lowest overlap first
    });

    return [userInput, ...rest].slice(0, max);
  }
}

function longestCommonPrefixLength(a: string, b: string): number {
  let i = 0;
  const min = Math.min(a.length, b.length);
  while (i < min && a[i] === b[i]) i++;
  return i;
}
