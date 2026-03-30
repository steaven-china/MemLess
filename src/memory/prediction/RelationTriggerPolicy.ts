export interface RelationTriggerThresholds {
  lowInfoThreshold: number;
  highEntropyThreshold: number;
  shortChainMaxSize: number;
}

export interface RelationTriggerDecisionInput {
  relationProbabilities: number[];
  thresholds: RelationTriggerThresholds;
}

export interface RelationTriggerDecision {
  matched: boolean;
  matchedByShortChain: boolean;
  matchedByHighEntropyLowInfo: boolean;
  totalConditionalInfo: number;
  conditionalEntropy: number;
  activeChainSize: number;
}

export function decideRelationLowInfoHighEntropy(
  input: RelationTriggerDecisionInput
): RelationTriggerDecision {
  const normalized = normalizeProbabilities(input.relationProbabilities);
  if (normalized.length === 0) {
    return {
      matched: false,
      matchedByShortChain: false,
      matchedByHighEntropyLowInfo: false,
      totalConditionalInfo: 0,
      conditionalEntropy: 0,
      activeChainSize: 0
    };
  }

  const conditionalEntropy = computeNormalizedEntropy(normalized);
  const totalConditionalInfo = 1 - conditionalEntropy;
  const matchedByHighEntropyLowInfo =
    totalConditionalInfo < input.thresholds.lowInfoThreshold &&
    conditionalEntropy > input.thresholds.highEntropyThreshold;
  const shortChainMaxSize = Math.max(1, Math.floor(input.thresholds.shortChainMaxSize));
  const matchedByShortChain = normalized.length <= shortChainMaxSize;

  return {
    matched: matchedByHighEntropyLowInfo || matchedByShortChain,
    matchedByShortChain,
    matchedByHighEntropyLowInfo,
    totalConditionalInfo,
    conditionalEntropy,
    activeChainSize: normalized.length
  };
}

function normalizeProbabilities(values: number[]): number[] {
  const safe = values.filter((value) => Number.isFinite(value) && value > 0);
  if (safe.length === 0) return [];
  const total = safe.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [];
  return safe.map((value) => value / total);
}

function computeNormalizedEntropy(probabilities: number[]): number {
  if (probabilities.length <= 1) return 0;
  const entropy = -probabilities.reduce((sum, probability) => {
    return sum + probability * Math.log(probability + 1e-12);
  }, 0);
  return entropy / Math.log(probabilities.length);
}
