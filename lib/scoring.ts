export type SignalInputs = {
  relevance: number;
  novelty: number;
  credibility: number;
  recency: number;
  actionability: number;
  repetitionSignal: number;
};

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

export function scoreSignal(input: SignalInputs): number {
  const weighted =
    clamp(input.relevance) * 0.25 +
    clamp(input.novelty) * 0.15 +
    clamp(input.credibility) * 0.15 +
    clamp(input.recency) * 0.15 +
    clamp(input.actionability) * 0.15 +
    clamp(input.repetitionSignal) * 0.15;
  return Math.round(weighted);
}

export function scoreLearning(input: { depth: number; goalRelevance: number; practicability: number; novelty: number; evidence: number }): number {
  return Math.round(
    clamp(input.depth) * 0.25 +
    clamp(input.goalRelevance) * 0.25 +
    clamp(input.practicability) * 0.2 +
    clamp(input.novelty) * 0.15 +
    clamp(input.evidence) * 0.15,
  );
}

export function scoreTopic(input: {
  fiveDimensionScore: number;
  userFit: number;
  recency: number;
  demonstrability: number;
  credibility: number;
  novelty: number;
  historicalSimilarity: number;
}): number {
  const fiveDimension = clamp(input.fiveDimensionScore, 0, 10) * 10;
  const base =
    fiveDimension * 0.4 +
    clamp(input.userFit) * 0.2 +
    clamp(input.recency) * 0.1 +
    clamp(input.demonstrability) * 0.1 +
    clamp(input.credibility) * 0.1 +
    clamp(input.novelty) * 0.1;
  const penalty = clamp(input.historicalSimilarity) * 0.25;
  return Math.round(clamp(base - penalty));
}

export function sumFiveDimensions(scores: { frequency: number; emotion: number; cost: number; scene: number; commercial: number }): number {
  return Object.values(scores).reduce((sum, value) => sum + clamp(value, 0, 2), 0);
}
