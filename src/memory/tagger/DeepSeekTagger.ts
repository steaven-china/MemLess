import {
  LLMTagger,
  type LLMTaggerConfig
} from "./LLMTagger.js";

export interface DeepSeekTaggerConfig extends LLMTaggerConfig {}

const DEEPSEEK_TAGGER_SYSTEM_PROMPT =
  "Tag memory block importance. Return JSON only. " +
  'Format: {"tags":["important"|"normal"],"importantScore":0.0-1.0}. ';

export class DeepSeekTagger extends LLMTagger {
  constructor(config: DeepSeekTaggerConfig) {
    super(config, {
      providerName: "DeepSeek",
      defaultBaseUrl: "https://api.deepseek.com/v1",
      systemPrompt: DEEPSEEK_TAGGER_SYSTEM_PROMPT
    });
  }
}
