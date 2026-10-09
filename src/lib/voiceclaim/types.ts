/**
 * Domain model for VoiceClaim Auditor.
 *
 * These types are the contract between the UI and the verification backend.
 * Today they are fulfilled by mock services (src/lib/voiceclaim/services);
 * swapping in Speechmatics / Bright Data Web MCP / AI-ML API implementations
 * must not require changing anything in this file or in the components.
 */

export type VerificationMode = "general" | "investor" | "academic" | "custom";
export type VerificationDepth = "quick" | "deep";
export type IntervalPreset = "fast" | "balanced" | "long";

export type StatementClassification = "verifiable_fact" | "opinion" | "prediction" | "context";

export type ClaimState =
  | "DETECTED"
  | "QUEUED"
  | "RESEARCHING"
  | "CHALLENGING"
  | "SYNTHESIZING"
  | "COMPLETED"
  | "INSUFFICIENT_EVIDENCE"
  | "VERIFICATION_ERROR";

export type Verdict =
  | "supported"
  | "mostly_supported"
  | "mixed"
  | "misleading"
  | "contradicted"
  | "insufficient_evidence";

export type EvidenceRelation = "supports" | "contradicts" | "contextual";

export type SourceCategory =
  | "government"
  | "scientific"
  | "financial_filing"
  | "company"
  | "news"
  | "fact_check"
  | "social"
  | "custom_corpus";

export type QualitativeLevel = "low" | "medium" | "high";

export interface TranscriptSegment {
  id: string;
  /** Milliseconds from session start. */
  startMs: number;
  endMs: number;
  /** Exactly what was said. Never overwritten by normalization. */
  text: string;
  /** True while Speechmatics is still refining this segment. */
  interim: boolean;
  classification?: StatementClassification | undefined;
}

export interface TranscriptChunk {
  id: string;
  sessionId: string;
  sourceSegmentIds: string[];
  startMs: number;
  endMs: number;
  /** Exact concatenated wording; never normalized in place. */
  text: string;
  intervalWindows: number;
  forced: boolean;
}

export interface EvidenceItem {
  id: string;
  title: string;
  domain: string;
  url: string;
  category: SourceCategory;
  excerpt: string;
  translatedTitle?: string | undefined;
  translatedExcerpt?: string | undefined;
  relation: EvidenceRelation;
  publishedAt?: string | undefined;
  retrievedAt: string;
  /** Authority relative to this specific claim, not in the abstract. */
  authority: QualitativeLevel;
  /** False when the item repeats an upstream report already counted. */
  independent: boolean;
  upstreamOf?: string | undefined;
}

export interface EvidenceConfidence {
  /** 0-100. Confidence in the verdict given retrieved evidence — not a probability of truth. */
  score: number;
  evidenceStrength: QualitativeLevel;
  contradiction: QualitativeLevel;
  freshness: QualitativeLevel;
}

export interface VerificationResult {
  verdict: Verdict;
  confidence: EvidenceConfidence;
  summary: string;
  explanation: string;
  challengeSummary: string;
  evidenceGaps: string[];
  recommendedActions: string[];
  roundsRun: number;
}

export interface AtomicClaim {
  id: string;
  sessionId: string;
  sourceSegmentIds: string[];
  /** Original spoken wording — always preserved. */
  originalText: string;
  /** Normalized, self-contained assertion. */
  normalizedClaim: string;
  context: string;
  timestampMs: number;
  mode: VerificationMode;
  depth: VerificationDepth;
  state: ClaimState;
  priority: number;
  manual: boolean;
  /** Evidence streams in progressively; incomplete until state is terminal. */
  evidence: EvidenceItem[];
  result?: VerificationResult | undefined;
  error?: string | undefined;
}

export type SessionStatus =
  "idle" | "listening" | "processing" | "reconnecting" | "completed" | "error";

export type SessionSource = "microphone" | "audio_upload" | "video_upload";

export type SessionProgressStage =
  | "connecting"
  | "uploading"
  | "transcribing"
  | "extracting"
  | "researching"
  | "challenging"
  | "synthesizing"
  | "finalizing"
  | "completed"
  | "error";

export interface SessionProgress {
  stage: SessionProgressStage;
  label: string;
  detail: string;
  /** Overall progress for finite uploaded recordings. Live microphone sessions are indeterminate. */
  percent?: number | undefined;
}

export interface CustomSource {
  id: string;
  name: string;
  kind: "pdf" | "txt" | "csv";
  sizeBytes: number;
  parserStatus: "stored" | "parsing" | "parsed" | "indexing" | "ready" | "error";
  pageCount?: number | undefined;
  rowCount?: number | undefined;
  chunkCount: number;
  indexingError?: string | undefined;
}

export interface SessionSettings {
  mode: VerificationMode;
  depth: VerificationDepth;
  intervalPreset: IntervalPreset;
  /** Sources targeted per research round. */
  sourceCount: number;
  concurrency: number;
}

export interface Session {
  id: string;
  title: string;
  source: SessionSource;
  settings: SessionSettings;
  customSources: CustomSource[];
  startedAt: string;
  endedAt?: string | undefined;
  status: SessionStatus;
  durationMs: number;
  segments: TranscriptSegment[];
  claims: AtomicClaim[];
  extractionErrors?: string[] | undefined;
  progress?: SessionProgress | undefined;
}

export const INTERVAL_SECONDS: Record<IntervalPreset, number> = {
  fast: 6,
  balanced: 14,
  long: 28,
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  supported: "Supported",
  mostly_supported: "Mostly supported",
  mixed: "Mixed evidence",
  misleading: "Misleading",
  contradicted: "Contradicted",
  insufficient_evidence: "Insufficient evidence",
};

export const MODE_LABELS: Record<VerificationMode, string> = {
  general: "General",
  investor: "Business",
  academic: "Academic",
  custom: "Custom sources",
};

export const SOURCE_CATEGORY_LABELS: Record<SourceCategory, string> = {
  government: "Government or official source",
  scientific: "Scientific paper",
  financial_filing: "Official report",
  company: "Company statement",
  news: "News",
  fact_check: "Fact-checking source",
  social: "Social media",
  custom_corpus: "Your documents",
};

export const CLAIM_STAGE_LABELS: Record<ClaimState, string> = {
  DETECTED: "Claim detected",
  QUEUED: "Queued",
  RESEARCHING: "Searching sources",
  CHALLENGING: "Checking counterevidence",
  SYNTHESIZING: "Preparing result",
  COMPLETED: "Result ready",
  INSUFFICIENT_EVIDENCE: "Insufficient evidence",
  VERIFICATION_ERROR: "Verification error",
};

export const TERMINAL_STATES: ClaimState[] = [
  "COMPLETED",
  "INSUFFICIENT_EVIDENCE",
  "VERIFICATION_ERROR",
];

export function isTerminal(state: ClaimState) {
  return TERMINAL_STATES.includes(state);
}

export type ClaimFilter = "all" | "supported" | "questionable" | "contradicted" | "insufficient";

export function matchesFilter(claim: AtomicClaim, filter: ClaimFilter) {
  if (filter === "all") return true;
  const verdict = claim.result?.verdict;
  if (!verdict) return false;
  switch (filter) {
    case "supported":
      return verdict === "supported";
    case "questionable":
      return verdict === "mostly_supported" || verdict === "mixed" || verdict === "misleading";
    case "contradicted":
      return verdict === "contradicted";
    case "insufficient":
      return verdict === "insufficient_evidence";
  }
}

export function formatTimestamp(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
