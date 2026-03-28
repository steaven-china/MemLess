import type { I18n } from "../i18n/index.js";
import {
  ChatCompletionProvider,
  type ChatCompletionProviderConfig,
  type ChatCompletionTraceCallback
} from "./ChatCompletionProvider.js";

export interface OpenAICompatibleProviderConfig extends ChatCompletionProviderConfig {}

export class OpenAICompatibleProvider extends ChatCompletionProvider {
  constructor(
    config: OpenAICompatibleProviderConfig,
    options?: {
      i18n?: I18n;
      onTrace?: ChatCompletionTraceCallback;
    }
  ) {
    super(config, {
      providerName: "OpenAI-Compatible",
      defaultBaseUrl: config.baseUrl ?? "https://api.openai.com/v1",
      i18n: options?.i18n,
      onTrace: options?.onTrace
    });
  }
}
