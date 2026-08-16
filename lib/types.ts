export type PageKey =
  | "today"
  | "inbox"
  | "learning"
  | "intelligence"
  | "topics"
  | "knowledge"
  | "review"
  | "sources"
  | "settings";

export type ContentStatus =
  | "unread"
  | "skimmed"
  | "saved"
  | "queued_learning"
  | "archived"
  | "ignored";

export type ContentItem = {
  id: string;
  source: "YouTube" | "AIHot" | "Get 笔记";
  sourceType: "youtube" | "aihot" | "get_notes";
  title: string;
  author: string;
  summary: string;
  publishedAt: string;
  duration?: string;
  score: number;
  learningScore: number;
  topicScore: number;
  topics: string[];
  status: ContentStatus;
  hasTranscript: boolean;
  provenance: "demo" | "verified_live";
};

export type TopicStatus =
  | "candidate"
  | "researching"
  | "testing"
  | "confirmed"
  | "ready"
  | "producing"
  | "published"
  | "reviewed"
  | "abandoned";

export type TopicCandidate = {
  id: string;
  topic: string;
  audience: string;
  painPoint: string;
  angle: string;
  whyNow: string;
  validationTask: string;
  format: string;
  score: number;
  similarity: number;
  status: TopicStatus;
  evidenceCount: number;
  type: "实测型" | "方法型" | "观点型";
};
