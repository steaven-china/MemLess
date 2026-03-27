import type { ChatMessage, ILLMProvider, LlmGenerateOptions } from "./LLMProvider.js";

export class RuleBasedProvider implements ILLMProvider {
  async generate(messages: ChatMessage[], _options?: LlmGenerateOptions): Promise<string> {
    const user = [...messages].reverse().find((message) => message.role === "user");
    const contextMessage = messages.find((message) => message.role === "system");
    const contextSnippet = contextMessage?.content.split("=== RECENT EVENTS ===")[0] ?? "";

    if (!user) return "I did not receive your question.";
    if (contextSnippet.trim().length === 0) {
      return `收到：${user.content}\n\n当前没有可检索记忆，我会从现在开始持续积累上下文。`;
    }

    return [
      `问题：${user.content}`,
      "基于当前记忆检索结果，我建议优先参考这些历史块：",
      contextSnippet
        .split("\n")
        .filter((line) => line.startsWith("#"))
        .slice(0, 3)
        .join("\n"),
      "如果你配置 `OPENAI_API_KEY`（或 `DEEPSEEK_API_KEY`）并使用 `--provider openai|deepseek-reasoner`，我会输出更完整的推理答案。"
    ].join("\n");
  }
}
