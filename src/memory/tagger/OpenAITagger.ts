import {
  LLMTagger,
  type LLMTaggerConfig
} from "./LLMTagger.js";

export interface OpenAITaggerConfig extends LLMTaggerConfig {}

const OPENAI_TAGGER_SYSTEM_PROMPT =
  "You are a strict memory tagger. Return JSON only. " +
  'Format: {"tags":["important"|"normal"],"importantScore":0.0-1.0}. ';

export class OpenAITagger extends LLMTagger {
  constructor(config: OpenAITaggerConfig) {
    super(config, {
      providerName: "OpenAI",
      defaultBaseUrl: "https://api.openai.com/v1",
      systemPrompt: OPENAI_TAGGER_SYSTEM_PROMPT
    });
  }
}
