import type { I18n } from "../i18n/index.js";
import type { AppConfig } from "../config.js";
import type { IDebugTraceRecorder } from "../debug/DebugTraceRecorder.js";
import { AnthropicClaudeProvider } from "./AnthropicClaudeProvider.js";
import { AzureOpenAIProvider } from "./AzureOpenAIProvider.js";
import { DeepSeekReasonerProvider } from "./DeepSeekReasonerProvider.js";
import { GoogleGeminiProvider } from "./GoogleGeminiProvider.js";
import type { ILLMProvider } from "./LLMProvider.js";
import { OpenAICompatibleProvider } from "./OpenAICompatibleProvider.js";
import { OpenAIProvider } from "./OpenAIProvider.js";
import { OpenRouterProvider } from "./OpenRouterProvider.js";
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

  if (config.service.provider === "anthropic-claude") {
    if (!config.service.anthropicApiKey) {
      throw new Error(
        i18n?.t("provider.error.anthropic_api_key_required") ??
          "ANTHROPIC_API_KEY is required when provider is anthropic-claude"
      );
    }
    return new AnthropicClaudeProvider(
      {
        apiKey: config.service.anthropicApiKey,
        baseUrl: config.service.anthropicBaseUrl,
        model: config.service.anthropicModel,
        version: config.service.anthropicVersion
      },
      {
        i18n,
        onTrace: (event, payload) => {
          traceRecorder?.record("model", `anthropic.${event}`, payload);
        }
      }
    );
  }

  if (config.service.provider === "google-gemini") {
    if (!config.service.geminiApiKey) {
      throw new Error(
        i18n?.t("provider.error.gemini_api_key_required") ??
          "GEMINI_API_KEY is required when provider is google-gemini"
      );
    }
    return new GoogleGeminiProvider(
      {
        apiKey: config.service.geminiApiKey,
        baseUrl: config.service.geminiBaseUrl,
        model: config.service.geminiModel
      },
      {
        i18n,
        onTrace: (event, payload) => {
          traceRecorder?.record("model", `gemini.${event}`, payload);
        }
      }
    );
  }

  if (config.service.provider === "openrouter") {
    if (!config.service.openrouterApiKey) {
      throw new Error(
        i18n?.t("provider.error.openrouter_api_key_required") ??
          "OPENROUTER_API_KEY is required when provider is openrouter"
      );
    }
    return new OpenRouterProvider(
      {
        apiKey: config.service.openrouterApiKey,
        baseUrl: config.service.openrouterBaseUrl,
        model: config.service.openrouterModel,
        appName: config.service.openrouterAppName,
        siteUrl: config.service.openrouterSiteUrl
      },
      {
        i18n,
        onTrace: (event, payload) => {
          traceRecorder?.record("model", `openrouter.${event}`, payload);
        }
      }
    );
  }

  if (config.service.provider === "azure-openai") {
    if (!config.service.azureOpenaiApiKey) {
      throw new Error(
        i18n?.t("provider.error.azure_openai_api_key_required") ??
          "AZURE_OPENAI_API_KEY is required when provider is azure-openai"
      );
    }
    if (!config.service.azureOpenaiEndpoint) {
      throw new Error(
        i18n?.t("provider.error.azure_openai_endpoint_required") ??
          "AZURE_OPENAI_ENDPOINT is required when provider is azure-openai"
      );
    }
    if (!config.service.azureOpenaiDeployment) {
      throw new Error(
        i18n?.t("provider.error.azure_openai_deployment_required") ??
          "AZURE_OPENAI_DEPLOYMENT is required when provider is azure-openai"
      );
    }
    return new AzureOpenAIProvider(
      {
        apiKey: config.service.azureOpenaiApiKey,
        endpoint: config.service.azureOpenaiEndpoint,
        deployment: config.service.azureOpenaiDeployment,
        apiVersion: config.service.azureOpenaiApiVersion,
        model: config.service.azureOpenaiModel
      },
      {
        i18n,
        onTrace: (event, payload) => {
          traceRecorder?.record("model", `azure.${event}`, payload);
        }
      }
    );
  }

  if (config.service.provider === "openai-compatible") {
    if (!config.service.openaiCompatibleApiKey) {
      throw new Error(
        i18n?.t("provider.error.openai_compatible_api_key_required") ??
          "OPENAI_COMPATIBLE_API_KEY is required when provider is openai-compatible"
      );
    }
    if (!config.service.openaiCompatibleBaseUrl) {
      throw new Error(
        i18n?.t("provider.error.openai_compatible_base_url_required") ??
          "OPENAI_COMPATIBLE_BASE_URL is required when provider is openai-compatible"
      );
    }
    return new OpenAICompatibleProvider(
      {
        apiKey: config.service.openaiCompatibleApiKey,
        baseUrl: config.service.openaiCompatibleBaseUrl,
        model: config.service.openaiCompatibleModel
      },
      {
        i18n,
        onTrace: (event, payload) => {
          traceRecorder?.record("model", `openai_compatible.${event}`, payload);
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
