import type { I18n } from "../i18n/index.js";
import {
  ChatCompletionProvider,
  type ChatCompletionProviderConfig,
  type ChatCompletionTraceCallback
} from "./ChatCompletionProvider.js";

export interface OpenAIProviderConfig extends ChatCompletionProviderConfig {}

export class OpenAIProvider extends ChatCompletionProvider {
  constructor(
    config: OpenAIProviderConfig,
    options?: {
      i18n?: I18n;
      onTrace?: ChatCompletionTraceCallback;
    }
  ) {
    super(config, {
      providerName: "OpenAI",
      defaultBaseUrl: "https://api.openai.com/v1",
      i18n: options?.i18n,
      onTrace: options?.onTrace
    });
  }
}
