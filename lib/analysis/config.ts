import { sha256 } from "../dedupe";

export const CREATOR_PROMPT_VERSION = "creator-content-v3";
export const EVENT_PROMPT_VERSION = "event-analysis-v3";
export const TREND_PROMPT_VERSION = "cross-source-v2";
export const ANALYSIS_VERSION = "2026-08-17.1";

export type AnalysisJobIdentity = {
  entityType:"content"|"event"|"trend";
  entityId:string;
  inputHash:string;
  promptVersion:string;
  profileVersion:number;
  analysisVersion?:string;
};

export function analysisJobKey(type:string,identity:AnalysisJobIdentity) {
  return [
    type,
    identity.entityId,
    identity.inputHash,
    identity.promptVersion,
    String(identity.profileVersion),
    identity.analysisVersion ?? ANALYSIS_VERSION,
  ].join(":");
}

export function contentAnalysisInputHash(input:{
  contentHash:string;
  transcriptHash?:string|null;
}) {
  return sha256(JSON.stringify({contentHash:input.contentHash,transcriptHash:input.transcriptHash ?? null}));
}

