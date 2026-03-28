import type { I18n } from "../i18n/index.js";
import {
  ChatCompletionProvider,
  type ChatCompletionProviderConfig,
  type ChatCompletionTraceCallback
} from "./ChatCompletionProvider.js";

export interface AzureOpenAIProviderConfig {
  apiKey: string;
  endpoint: string;
  deployment: string;
  apiVersion: string;
  model?: string;
}

export class AzureOpenAIProvider extends ChatCompletionProvider {
  constructor(
    config: AzureOpenAIProviderConfig,
    options?: {
      i18n?: I18n;
      onTrace?: ChatCompletionTraceCallback;
    }
  ) {
    const providerConfig: ChatCompletionProviderConfig = {
      apiKey: config.apiKey,
      baseUrl: config.endpoint,
      model: config.model ?? config.deployment
    };

    super(providerConfig, {
      providerName: "Azure OpenAI",
      defaultBaseUrl: config.endpoint,
      i18n: options?.i18n,
      onTrace: options?.onTrace,
      requestPath: `/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions`,
      extraQueryParams: {
        "api-version": config.apiVersion
      },
      includeModelInBody: false
    });
  }
}
