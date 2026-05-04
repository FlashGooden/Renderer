export const ASSET_KINDS = ["reference", "driving"];
export const RUN_STATES = ["queued", "running", "needs_review", "succeeded", "failed"];
export const REVIEW_DECISIONS = ["approve", "reject"];

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
    notes: spec.notes || ""
  };
}

