import type { AppConfig } from "../../config.js";
import type { IDebugTraceRecorder } from "../../debug/DebugTraceRecorder.js";
import { DeepSeekRelationExtractor } from "./DeepSeekRelationExtractor.js";
import type { LLMFallbackDetails } from "./LLMRelationExtractor.js";
import { OpenAIRelationExtractor } from "./OpenAIRelationExtractor.js";
import { HeuristicRelationExtractor } from "./RelationExtractor.js";
import type { IRelationExtractor } from "./RelationExtractor.js";

export function buildRelationExtractor(
  config: AppConfig,
  traceRecorder?: IDebugTraceRecorder
): IRelationExtractor {
  const recordFallback = (provider: "openai" | "deepseek", details: LLMFallbackDetails): void => {
    traceRecorder?.record("relation", `${provider}.fallback`, details);
    console.warn(
      `[relation-extractor:${provider}] fallback ${details.reason} block=${details.currentBlockId} neighbors=${details.neighborCount}`
    );
  };

  if (config.component.relationExtractor === "deepseek") {
    if (!config.service.deepseekApiKey) {
      throw new Error(
        "DEEPSEEK_API_KEY is required when relation extractor is deepseek. You can also use heuristic."
      );
    }
    return new DeepSeekRelationExtractor({
      apiKey: config.service.deepseekApiKey,
      baseUrl: config.service.deepseekBaseUrl,
      model: config.component.relationModel || config.service.deepseekModel,
      timeoutMs: config.component.relationTimeoutMs,
      onFallback: (details) => {
        recordFallback("deepseek", details);
      }
    });
  }

  if (config.component.relationExtractor === "openai") {
    if (!config.service.openaiApiKey) {
      throw new Error(
        "OPENAI_API_KEY is required when relation extractor is openai. You can also use heuristic."
      );
    }
    return new OpenAIRelationExtractor({
      apiKey: config.service.openaiApiKey,
      baseUrl: config.service.openaiBaseUrl,
      model: config.component.relationModel,
      timeoutMs: config.component.relationTimeoutMs,
      onFallback: (details) => {
        recordFallback("openai", details);
      }
    });
  }

  return new HeuristicRelationExtractor();
}
