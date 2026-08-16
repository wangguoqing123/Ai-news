import { z } from "zod";

export const quickPreviewSchema = z.object({
  headlineZh: z.string(), oneSentenceSummary: z.string(), contentType: z.string(), topics: z.array(z.string()),
  relevanceScore: z.number().min(0).max(100), learningValueScore: z.number().min(0).max(100), topicSignalScore: z.number().min(0).max(100),
  noveltyScore: z.number().min(0).max(100), reasonToOpen: z.array(z.string()), recommendedAction: z.enum(["skip","skim","learn","topic"]),
  recommendedSegments: z.array(z.object({ startMs: z.number().nonnegative(), endMs: z.number().nonnegative(), title: z.string(), reason: z.string() })),
  caveats: z.array(z.string()), confidence: z.number().min(0).max(1),
});

export const deepLearningSchema = z.object({
  problem: z.string(), thesis: z.string(), framework: z.array(z.object({ name: z.string(), purpose: z.string(), inputs: z.array(z.string()), steps: z.array(z.string()), successCriteria: z.array(z.string()), evidenceRefs: z.array(z.string()) })),
  decisionRules: z.array(z.string()), examples: z.array(z.unknown()), limitations: z.array(z.string()), authorOpinions: z.array(z.string()),
  verifiableClaims: z.array(z.string()), knowledgeCardDrafts: z.array(z.unknown()), practiceTaskDraft: z.record(z.string(), z.unknown()), topicDirections: z.array(z.unknown()), confidence: z.number().min(0).max(1),
});

export const competitorAnalysisSchema = z.object({
  targetAudience: z.string(), painPoint: z.string(), triggerScene: z.string(), promisedResult: z.string(), titlePattern: z.string(), openingHook: z.string(),
  structure: z.array(z.string()), evidence: z.array(z.string()), commentNeeds: z.array(z.string()), whyItMayWork: z.array(z.string()), unmetNeeds: z.array(z.string()),
  nonCopyableParts: z.array(z.string()), differentiationOpportunities: z.array(z.string()), confidence: z.number().min(0).max(1),
});

export const topicOutputSchema = z.object({
  topic: z.string(), targetAudience: z.string(), painPoint: z.string(), triggerScene: z.string(), expectedResult: z.string(), coreViewpoint: z.string(),
  differentiatedAngle: z.string(), whyNow: z.string(), validationTask: z.string(), recommendedFormat: z.string(), sourceRefs: z.array(z.string()),
  scores: z.object({ frequency: z.number().min(0).max(2), emotion: z.number().min(0).max(2), cost: z.number().min(0).max(2), scene: z.number().min(0).max(2), commercial: z.number().min(0).max(2) }),
  risks: z.array(z.string()), similarityToHistory: z.number().min(0).max(100),
});
