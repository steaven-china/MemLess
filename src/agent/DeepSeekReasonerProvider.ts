import type { I18n } from "../i18n/index.js";
import {
  ChatCompletionProvider,
  type ChatCompletionProviderConfig,
  type ChatCompletionTraceCallback
} from "./ChatCompletionProvider.js";

export interface DeepSeekReasonerProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export class DeepSeekReasonerProvider extends ChatCompletionProvider {
  constructor(
    config: DeepSeekReasonerProviderConfig,
    options?: {
      i18n?: I18n;
      onTrace?: ChatCompletionTraceCallback;
    }
  ) {
    const providerConfig: ChatCompletionProviderConfig = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model ?? "deepseek-reasoner"
    };
    super(providerConfig, {
      providerName: "DeepSeek",
      defaultBaseUrl: "https://api.deepseek.com/v1",
      i18n: options?.i18n,
      onTrace: options?.onTrace
    });
  }
}
