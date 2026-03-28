import type { I18n } from "../i18n/index.js";
import {
  ChatCompletionProvider,
  type ChatCompletionProviderConfig,
  type ChatCompletionTraceCallback
} from "./ChatCompletionProvider.js";

export interface OpenRouterProviderConfig extends ChatCompletionProviderConfig {
  appName?: string;
  siteUrl?: string;
}

export class OpenRouterProvider extends ChatCompletionProvider {
  constructor(
    config: OpenRouterProviderConfig,
    options?: {
      i18n?: I18n;
      onTrace?: ChatCompletionTraceCallback;
    }
  ) {
    super(config, {
      providerName: "OpenRouter",
      defaultBaseUrl: "https://openrouter.ai/api/v1",
      i18n: options?.i18n,
      onTrace: options?.onTrace,
      extraHeaders: {
        ...(config.appName ? { "X-Title": config.appName } : {}),
        ...(config.siteUrl ? { "HTTP-Referer": config.siteUrl } : {})
      }
    });
  }
}
