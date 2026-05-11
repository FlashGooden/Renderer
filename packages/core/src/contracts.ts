import type {
  AnyRecord,
  ArtifactKind,
  AssetKind,
  BenchmarkCase,
  FailureCode,
  ReviewCriterionKey,
  ReviewCriterionState,
  ReviewDecision,
  ReviewTag,
  RunSpec,
  RunState
} from "./types.js";

export const ASSET_KINDS = ["reference", "driving"] as const;
export const RUN_STATES = ["queued", "running", "needs_review", "succeeded", "failed"] as const;
export const REVIEW_DECISIONS = ["approve", "reject"] as const;
export const REVIEW_CRITERIA_KEYS = ["identity", "motion", "stability", "corruption", "overall"] as const;
export const REVIEW_CRITERIA_STATES = ["pass", "fail", "needs_work", "unreviewed"] as const;
export const REVIEW_TAGS = [
  "identity",
  "motion",
  "stability",
  "corruption",
  "blur",
  "flicker",
  "freeze",
  "artifact",
  "usable",
  "needs_followup"
] as const;
export const ARTIFACT_KINDS = ["retargeted_video", "preview_still", "contact_sheet"] as const;
export const FAILURE_CODES = [
  "provider_auth",
  "provider_rate_limited",
  "provider_timeout",
  "provider_unavailable",
  "provider_validation",
  "provider_rejected_input",
  "provider_run_failed",
  "provider_canceled",
  "provider_output_missing",
  "provider_download_failed",
  "provider_unknown"
] as const;

function includesValue<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value as T[number]);
}

export function assertAssetKind(kind: unknown): asserts kind is AssetKind {
  if (!includesValue(ASSET_KINDS, kind)) {
    throw new Error(`Unsupported asset kind "${kind}". Expected one of: ${ASSET_KINDS.join(", ")}`);
  }
}

export function assertRunState(state: unknown): asserts state is RunState {
  if (!includesValue(RUN_STATES, state)) {
    throw new Error(`Unsupported run state "${state}".`);
  }
}

export function assertReviewDecision(decision: unknown): asserts decision is ReviewDecision {
  if (!includesValue(REVIEW_DECISIONS, decision)) {
    throw new Error(`Unsupported review decision "${decision}".`);
  }
}

export function assertArtifactKind(kind: unknown): asserts kind is ArtifactKind {
  if (!includesValue(ARTIFACT_KINDS, kind)) {
    throw new Error(`Unsupported artifact kind "${kind}".`);
  }
}

export function normalizeReviewTags(tags: unknown[] | unknown = []): ReviewTag[] {
  const values = Array.isArray(tags) ? tags : [tags];
  for (const tag of values) {
    if (!includesValue(REVIEW_TAGS, tag)) {
      throw new Error(`Unsupported review tag "${tag}". Expected one of: ${REVIEW_TAGS.join(", ")}`);
    }
  }
  return [...new Set(values)] as ReviewTag[];
}

export function normalizeReviewCriteria(criteria: AnyRecord = {}): Record<ReviewCriterionKey, ReviewCriterionState> {
  const normalized = {} as Record<ReviewCriterionKey, ReviewCriterionState>;
  for (const key of REVIEW_CRITERIA_KEYS) {
    const state = criteria[key] || "unreviewed";
    if (!includesValue(REVIEW_CRITERIA_STATES, state)) {
      throw new Error(
        `Unsupported review criterion state "${state}" for "${key}". Expected one of: ${REVIEW_CRITERIA_STATES.join(", ")}`
      );
    }
    normalized[key] = state;
  }
  return normalized;
}

export function validateReviewInput(input: AnyRecord = {}) {
  const decision = input.decision ?? null;
  if (decision !== null) {
    assertReviewDecision(decision);
  }

  return {
    decision,
    reviewer: input.reviewer || "",
    notes: input.notes || "",
    tags: normalizeReviewTags(input.tags || []),
    criteria: normalizeReviewCriteria(input.criteria || {})
  };
}

export function validateBenchmarkCases(cases: AnyRecord[] = []): BenchmarkCase[] {
  if (!Array.isArray(cases) || !cases.length) {
    throw new Error("Benchmark datasets require at least one case.");
  }

  return cases.map((item, index) => {
    if (!item.label) {
      throw new Error(`Benchmark case ${index + 1} is missing "label".`);
    }
    if (!item.referenceAssetId) {
      throw new Error(`Benchmark case ${index + 1} is missing "referenceAssetId".`);
    }
    if (!item.sourceVideoAssetId) {
      throw new Error(`Benchmark case ${index + 1} is missing "sourceVideoAssetId".`);
    }

    return {
      id: item.id || null,
      label: item.label,
      referenceAssetId: item.referenceAssetId,
      sourceVideoAssetId: item.sourceVideoAssetId,
      tags: normalizeReviewTags(item.tags || []),
      notes: item.notes || ""
    };
  });
}

export function validateBenchmarkDatasetInput(input: AnyRecord = {}) {
  if (!input.label) {
    throw new Error('Missing required benchmark dataset field "label".');
  }

  return {
    label: input.label,
    notes: input.notes || "",
    cases: validateBenchmarkCases(input.cases || [])
  };
}

export function validateBenchmarkRunGroupInput(input: AnyRecord = {}) {
  if (!input.label) {
    throw new Error('Missing required benchmark run group field "label".');
  }
  if (!input.benchmarkDatasetId) {
    throw new Error('Missing required benchmark run group field "benchmarkDatasetId".');
  }

  const candidateLabels = [...new Set((input.candidateLabels || []).filter(Boolean))] as string[];

  return {
    label: input.label,
    notes: input.notes || "",
    benchmarkDatasetId: input.benchmarkDatasetId,
    candidateLabels
  };
}

export function assertFailureCode(code: unknown): asserts code is FailureCode {
  if (!includesValue(FAILURE_CODES, code)) {
    throw new Error(`Unsupported failure code "${code}".`);
  }
}

export function validateRunSpec(spec: AnyRecord): RunSpec {
  const required = ["referenceAssetId", "sourceVideoAssetId", "presetId"];
  for (const field of required) {
    if (!spec[field]) {
      throw new Error(`Missing required run field "${field}".`);
    }
  }

  return {
    referenceAssetId: spec.referenceAssetId,
    sourceVideoAssetId: spec.sourceVideoAssetId,
    presetId: spec.presetId,
    outputProfile: spec.outputProfile || "preview",
    notes: spec.notes || "",
    benchmarkDatasetId: spec.benchmarkDatasetId || null,
    benchmarkCaseId: spec.benchmarkCaseId || null,
    benchmarkRunGroupId: spec.benchmarkRunGroupId || null,
    candidateLabel: spec.candidateLabel || ""
  };
}
