function round(value) {
  return Math.round(value * 1000) / 1000;
}

function compareNumeric(left, right, direction = "higher") {
  const leftValue = Number(left || 0);
  const rightValue = Number(right || 0);
  if (Math.abs(leftValue - rightValue) < 0.01) {
    return "tie";
  }

  if (direction === "lower") {
    return leftValue < rightValue ? "left" : "right";
  }

  return leftValue > rightValue ? "left" : "right";
}

function formatWinnerLabel(winner, leftLabel, rightLabel) {
  if (winner === "left") {
    return leftLabel;
  }
  if (winner === "right") {
    return rightLabel;
  }
  return "tie";
}

function buildOverallSummary(winners, leftLabel, rightLabel) {
  const leftWins = [];
  const rightWins = [];

  for (const [metric, winner] of Object.entries(winners)) {
    if (winner === "left") {
      leftWins.push(metric);
    } else if (winner === "right") {
      rightWins.push(metric);
    }
  }

  const fragments = [];
  if (leftWins.length) {
    fragments.push(`${leftLabel} wins on ${leftWins.join("/")}`);
  }
  if (rightWins.length) {
    fragments.push(`${rightLabel} wins on ${rightWins.join("/")}`);
  }

  return fragments.length ? fragments.join("; ") : "No clear winner across compared signals.";
}

export function summarizeRun(run) {
  return {
    id: run.id,
    state: run.state,
    providerId: run.providerId,
    presetId: run.presetId,
    reviewStatus: run.reviewStatus,
    referenceAssetId: run.referenceAssetId,
    sourceVideoAssetId: run.sourceVideoAssetId,
    benchmarkDatasetId: run.benchmarkDatasetId,
    benchmarkCaseId: run.benchmarkCaseId,
    benchmarkRunGroupId: run.benchmarkRunGroupId,
    candidateLabel: run.candidateLabel,
    evaluation: run.evaluation,
    estimatedCostUsd: run.cost?.estimatedUsd || 0
  };
}

export function compareRuns(leftRun, rightRun) {
  const sameInput =
    leftRun.referenceAssetId === rightRun.referenceAssetId &&
    leftRun.sourceVideoAssetId === rightRun.sourceVideoAssetId;

  const comparison = {
    sameInput,
    left: summarizeRun(leftRun),
    right: summarizeRun(rightRun)
  };

  if (!sameInput) {
    return {
      ...comparison,
      mismatch: {
        referenceAssetIdMatch: leftRun.referenceAssetId === rightRun.referenceAssetId,
        sourceVideoAssetIdMatch: leftRun.sourceVideoAssetId === rightRun.sourceVideoAssetId
      },
      summary: "Runs do not share the same reference and driving inputs."
    };
  }

  const leftEval = leftRun.evaluation || {};
  const rightEval = rightRun.evaluation || {};
  const winners = {
    identity: compareNumeric(leftEval.identityScore, rightEval.identityScore),
    motion: compareNumeric(leftEval.motionScore, rightEval.motionScore),
    stability: compareNumeric(leftEval.stabilityScore, rightEval.stabilityScore),
    corruption: compareNumeric(leftEval.corruptionScore, rightEval.corruptionScore),
    overall: compareNumeric(leftEval.overallScore, rightEval.overallScore),
    cost: compareNumeric(leftRun.cost?.estimatedUsd || 0, rightRun.cost?.estimatedUsd || 0, "lower")
  };

  const deltas = {
    overallScoreDelta: round((leftEval.overallScore || 0) - (rightEval.overallScore || 0)),
    identityScoreDelta: round((leftEval.identityScore || 0) - (rightEval.identityScore || 0)),
    motionScoreDelta: round((leftEval.motionScore || 0) - (rightEval.motionScore || 0)),
    stabilityScoreDelta: round((leftEval.stabilityScore || 0) - (rightEval.stabilityScore || 0)),
    corruptionScoreDelta: round((leftEval.corruptionScore || 0) - (rightEval.corruptionScore || 0)),
    estimatedCostDeltaUsd: round((leftRun.cost?.estimatedUsd || 0) - (rightRun.cost?.estimatedUsd || 0))
  };

  return {
    ...comparison,
    sharedInput: {
      referenceAssetId: leftRun.referenceAssetId,
      sourceVideoAssetId: leftRun.sourceVideoAssetId
    },
    winners: {
      identity: formatWinnerLabel(winners.identity, leftRun.id, rightRun.id),
      motion: formatWinnerLabel(winners.motion, leftRun.id, rightRun.id),
      stability: formatWinnerLabel(winners.stability, leftRun.id, rightRun.id),
      corruption: formatWinnerLabel(winners.corruption, leftRun.id, rightRun.id),
      overall: formatWinnerLabel(winners.overall, leftRun.id, rightRun.id),
      cost: formatWinnerLabel(winners.cost, leftRun.id, rightRun.id)
    },
    deltas,
    summary: buildOverallSummary(winners, leftRun.id, rightRun.id)
  };
}

export function compareBenchmarkRunGroup(group, dataset, runs) {
  const casesById = new Map((dataset?.cases || []).map((item) => [item.id, item]));
  const runsById = new Map(runs.map((run) => [run.id, run]));
  const candidateSummary = new Map((group.candidateLabels || []).map((label) => [label, { wins: 0, losses: 0, ties: 0 }]));
  const caseComparisons = [];

  const membersByCase = new Map();
  for (const member of group.members || []) {
    if (!membersByCase.has(member.benchmarkCaseId)) {
      membersByCase.set(member.benchmarkCaseId, []);
    }
    membersByCase.get(member.benchmarkCaseId).push(member);
    if (member.candidateLabel && !candidateSummary.has(member.candidateLabel)) {
      candidateSummary.set(member.candidateLabel, { wins: 0, losses: 0, ties: 0 });
    }
  }

  for (const [benchmarkCaseId, members] of membersByCase.entries()) {
    const benchmarkCase = casesById.get(benchmarkCaseId) || null;
    const candidates = members
      .map((member) => {
        const run = runsById.get(member.runId);
        if (!run) {
          return null;
        }
        return {
          candidateLabel: member.candidateLabel,
          runId: member.runId,
          overallScore: run.evaluation?.overallScore || 0,
          referenceAssetId: run.referenceAssetId,
          sourceVideoAssetId: run.sourceVideoAssetId
        };
      })
      .filter(Boolean);

    let winner = null;
    let tiedCandidates = [];
    let mismatch = null;
    if (benchmarkCase) {
      mismatch = candidates.some(
        (candidate) =>
          candidate.referenceAssetId !== benchmarkCase.referenceAssetId ||
          candidate.sourceVideoAssetId !== benchmarkCase.sourceVideoAssetId
      );
    }

    if (!mismatch && candidates.length) {
      const bestScore = Math.max(...candidates.map((candidate) => candidate.overallScore));
      tiedCandidates = candidates
        .filter((candidate) => Math.abs(candidate.overallScore - bestScore) < 0.01)
        .map((candidate) => candidate.candidateLabel);
      winner = tiedCandidates.length === 1 ? tiedCandidates[0] : null;
    }

    for (const candidate of candidates) {
      const summary = candidateSummary.get(candidate.candidateLabel);
      if (!summary) {
        continue;
      }
      if (mismatch || !candidates.length) {
        summary.ties += 1;
      } else if (winner === null) {
        summary.ties += 1;
      } else if (candidate.candidateLabel === winner) {
        summary.wins += 1;
      } else {
        summary.losses += 1;
      }
    }

    caseComparisons.push({
      benchmarkCaseId,
      caseLabel: benchmarkCase?.label || null,
      mismatch,
      winner,
      tiedCandidates,
      candidates: candidates.map((candidate) => ({
        candidateLabel: candidate.candidateLabel,
        runId: candidate.runId,
        overallScore: round(candidate.overallScore)
      }))
    });
  }

  return {
    benchmarkRunGroupId: group.id,
    benchmarkDatasetId: group.benchmarkDatasetId,
    label: group.label,
    candidateSummary: Object.fromEntries(candidateSummary.entries()),
    caseComparisons
  };
}
