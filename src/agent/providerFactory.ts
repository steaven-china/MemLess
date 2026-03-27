import type { AppConfig } from "../config.js";
import type { IDebugTraceRecorder } from "../debug/DebugTraceRecorder.js";
import { DeepSeekReasonerProvider } from "./DeepSeekReasonerProvider.js";
import type { ILLMProvider } from "./LLMProvider.js";
import { OpenAIProvider } from "./OpenAIProvider.js";
import { RuleBasedProvider } from "./RuleBasedProvider.js";

export function buildProvider(
  config: AppConfig,
  traceRecorder?: IDebugTraceRecorder
): ILLMProvider {
  if (config.service.provider === "openai") {
    if (!config.service.openaiApiKey) {
      throw new Error("OPENAI_API_KEY is required when provider is openai");
    }
    return new OpenAIProvider({
      apiKey: config.service.openaiApiKey,
      baseUrl: config.service.openaiBaseUrl,
      model: config.service.openaiModel
    }, {
      onTrace: (event, payload) => {
        traceRecorder?.record("model", `openai.${event}`, payload);
      }
    });
  }

  if (config.service.provider === "deepseek-reasoner") {
    if (!config.service.deepseekApiKey) {
      throw new Error("DEEPSEEK_API_KEY is required when provider is deepseek-reasoner");
    }
    return new DeepSeekReasonerProvider({
      apiKey: config.service.deepseekApiKey,
      baseUrl: config.service.deepseekBaseUrl,
      model: config.service.deepseekModel
    }, {
      onTrace: (event, payload) => {
        traceRecorder?.record("model", `deepseek.${event}`, payload);
      }
    });
  }

  if (config.service.provider === "rule-based") {
    return new RuleBasedProvider();
  }

  throw new Error(`Unsupported provider: ${String(config.service.provider)}`);
}
