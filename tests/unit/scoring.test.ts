import test from "node:test";
import assert from "node:assert/strict";
import { scoreLearning, scoreSignal, scoreTopic, sumFiveDimensions } from "../../lib/scoring";

test("signal score follows documented weights", () => {
  assert.equal(scoreSignal({ relevance: 100, novelty: 80, credibility: 60, recency: 40, actionability: 20, repetitionSignal: 0 }), 55);
});

test("learning score follows documented weights", () => {
  assert.equal(scoreLearning({ depth: 100, goalRelevance: 100, practicability: 50, novelty: 0, evidence: 0 }), 60);
});

test("topic score applies historical similarity as a penalty", () => {
  const lowSimilarity = scoreTopic({ fiveDimensionScore: 8, userFit: 90, recency: 80, demonstrability: 80, credibility: 80, novelty: 80, historicalSimilarity: 10 });
  const highSimilarity = scoreTopic({ fiveDimensionScore: 8, userFit: 90, recency: 80, demonstrability: 80, credibility: 80, novelty: 80, historicalSimilarity: 90 });
  assert.ok(lowSimilarity > highSimilarity);
  assert.equal(sumFiveDimensions({ frequency: 2, emotion: 2, cost: 2, scene: 1, commercial: 1 }), 8);
});
