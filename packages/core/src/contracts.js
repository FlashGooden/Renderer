export const ASSET_KINDS = ["reference", "driving"];
export const RUN_STATES = ["queued", "running", "needs_review", "succeeded", "failed"];
export const REVIEW_DECISIONS = ["approve", "reject"];
export const REVIEW_CRITERIA_KEYS = ["identity", "motion", "stability", "corruption", "overall"];
export const REVIEW_CRITERIA_STATES = ["pass", "fail", "needs_work", "unreviewed"];
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
];
export const ARTIFACT_KINDS = ["retargeted_video", "preview_still", "contact_sheet"];
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
];

export function assertAssetKind(kind) {
  if (!ASSET_KINDS.includes(kind)) {
    throw new Error(`Unsupported asset kind "${kind}". Expected one of: ${ASSET_KINDS.join(", ")}`);
  }
}

export function assertRunState(state) {
  if (!RUN_STATES.includes(state)) {
    throw new Error(`Unsupported run state "${state}".`);
  }
}

export function assertReviewDecision(decision) {
  if (!REVIEW_DECISIONS.includes(decision)) {
    throw new Error(`Unsupported review decision "${decision}".`);
  }
}

export function assertArtifactKind(kind) {
  if (!ARTIFACT_KINDS.includes(kind)) {
    throw new Error(`Unsupported artifact kind "${kind}".`);
  }
}

export function normalizeReviewTags(tags = []) {
  const values = Array.isArray(tags) ? tags : [tags];
  for (const tag of values) {
    if (!REVIEW_TAGS.includes(tag)) {
      throw new Error(`Unsupported review tag "${tag}". Expected one of: ${REVIEW_TAGS.join(", ")}`);
    }
  }
  return [...new Set(values)];
}

export function normalizeReviewCriteria(criteria = {}) {
  const normalized = {};
  for (const key of REVIEW_CRITERIA_KEYS) {
    const state = criteria[key] || "unreviewed";
    if (!REVIEW_CRITERIA_STATES.includes(state)) {
      throw new Error(
        `Unsupported review criterion state "${state}" for "${key}". Expected one of: ${REVIEW_CRITERIA_STATES.join(", ")}`
      );
    }
    normalized[key] = state;
  }
  return normalized;
}

export function validateReviewInput(input = {}) {
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

export function validateBenchmarkCases(cases = []) {
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

export function validateBenchmarkDatasetInput(input = {}) {
  if (!input.label) {
    throw new Error('Missing required benchmark dataset field "label".');
  }

  return {
    label: input.label,
    notes: input.notes || "",
    cases: validateBenchmarkCases(input.cases || [])
  };
}

export function validateBenchmarkRunGroupInput(input = {}) {
  if (!input.label) {
    throw new Error('Missing required benchmark run group field "label".');
  }
  if (!input.benchmarkDatasetId) {
    throw new Error('Missing required benchmark run group field "benchmarkDatasetId".');
  }

  const candidateLabels = [...new Set((input.candidateLabels || []).filter(Boolean))];

  return {
    label: input.label,
    notes: input.notes || "",
    benchmarkDatasetId: input.benchmarkDatasetId,
    candidateLabels
  };
}

export function assertFailureCode(code) {
  if (!FAILURE_CODES.includes(code)) {
    throw new Error(`Unsupported failure code "${code}".`);
  }
}

export function validateRunSpec(spec) {
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
