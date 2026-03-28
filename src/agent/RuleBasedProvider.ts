import type { I18n } from "../i18n/index.js";
import type { ChatMessage, ILLMProvider, LlmGenerateOptions } from "./LLMProvider.js";

export interface RuleBasedProviderOptions {
  i18n?: I18n;
}

export class RuleBasedProvider implements ILLMProvider {
  constructor(private readonly options: RuleBasedProviderOptions = {}) {}

  async generate(messages: ChatMessage[], _options?: LlmGenerateOptions): Promise<string> {
    const user = [...messages].reverse().find((message) => message.role === "user");
    const contextMessage = messages.find((message) => message.role === "system");
    const contextSnippet = contextMessage?.content.split("=== RECENT EVENTS ===")[0] ?? "";

    if (!user) return this.options.i18n?.t("rule.no_question") ?? "I did not receive your question.";
    if (contextSnippet.trim().length === 0) {
      return (
        this.options.i18n?.t("rule.no_memory", { content: user.content }) ??
        `Received: ${user.content}\n\nNo retrievable memory is available yet. I will keep accumulating context from now on.`
      );
    }

    return [
      this.options.i18n?.t("rule.question", { content: user.content }) ?? `Question: ${user.content}`,
      this.options.i18n?.t("rule.reference") ?? "Based on current memory retrieval, I suggest prioritizing these history blocks:",
      contextSnippet
        .split("\n")
        .filter((line) => line.startsWith("#"))
        .slice(0, 3)
        .join("\n"),
      this.options.i18n?.t("rule.upgrade") ??
        "If you configure `OPENAI_API_KEY` (or `DEEPSEEK_API_KEY`) and use `--provider openai|deepseek-reasoner`, I can provide stronger reasoning answers."
    ].join("\n");
  }
}
