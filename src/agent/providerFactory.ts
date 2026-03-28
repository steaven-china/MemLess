import type { I18n } from "../i18n/index.js";
import type { AppConfig } from "../config.js";
import type { IDebugTraceRecorder } from "../debug/DebugTraceRecorder.js";
import { DeepSeekReasonerProvider } from "./DeepSeekReasonerProvider.js";
import type { ILLMProvider } from "./LLMProvider.js";
import { OpenAIProvider } from "./OpenAIProvider.js";
import { RuleBasedProvider } from "./RuleBasedProvider.js";

export function buildProvider(
  config: AppConfig,
  traceRecorder?: IDebugTraceRecorder,
  i18n?: I18n
): ILLMProvider {
  if (config.service.provider === "openai") {
    if (!config.service.openaiApiKey) {
      throw new Error(i18n?.t("provider.error.openai_api_key_required") ?? "OPENAI_API_KEY is required when provider is openai");
    }
    return new OpenAIProvider(
      {
        apiKey: config.service.openaiApiKey,
        baseUrl: config.service.openaiBaseUrl,
        model: config.service.openaiModel
      },
      {
        i18n,
        onTrace: (event, payload) => {
          traceRecorder?.record("model", `openai.${event}`, payload);
        }
      }
    );
  }

  if (config.service.provider === "deepseek-reasoner") {
    if (!config.service.deepseekApiKey) {
      throw new Error(
        i18n?.t("provider.error.deepseek_api_key_required") ??
          "DEEPSEEK_API_KEY is required when provider is deepseek-reasoner"
      );
    }
    return new DeepSeekReasonerProvider(
      {
        apiKey: config.service.deepseekApiKey,
        baseUrl: config.service.deepseekBaseUrl,
        model: config.service.deepseekModel
      },
      {
        i18n,
        onTrace: (event, payload) => {
          traceRecorder?.record("model", `deepseek.${event}`, payload);
        }
      }
    );
  }

  if (config.service.provider === "rule-based") {
    return new RuleBasedProvider({ i18n });
  }

  throw new Error(
    i18n?.t("provider.error.unsupported", { provider: String(config.service.provider) }) ??
      `Unsupported provider: ${String(config.service.provider)}`
  );
}
