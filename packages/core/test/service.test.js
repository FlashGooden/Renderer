import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FileJobStore } from "../src/job-store.js";
import { LocalStorageDriver } from "../src/storage.js";
import { createProviderRegistry } from "../src/providers.js";
import { AvatarService } from "../src/service.js";

const execFileAsync = promisify(execFile);

async function createMediaFixtures(dir) {
  const referencePath = path.join(dir, "reference.png");
  const sourcePath = path.join(dir, "source.mp4");
  const altSourcePath = path.join(dir, "source-alt.mp4");

  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=salmon:s=512x512:d=1",
    "-frames:v",
    "1",
    referencePath
  ]);

  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x360:rate=24",
    "-t",
    "1",
    sourcePath
  ]);

  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:s=640x360:r=24",
    "-t",
    "1",
    altSourcePath
  ]);

  return { referencePath, sourcePath, altSourcePath };
}

async function createService(rootDir) {
  const config = {
    runnerPort: 0,
    runnerUrl: "http://127.0.0.1:0",
    dataDir: path.join(rootDir, ".avatar"),
    storageMode: "local",
    azureBlobBaseUrl: ""
  };
  const service = new AvatarService({
    config,
    jobStore: new FileJobStore(config.dataDir),
    storageDriver: new LocalStorageDriver(config.dataDir),
    providers: createProviderRegistry()
  });
  await service.initialize();
  return service;
}

async function registerAsset(service, filePath, kind) {
  const buffer = await fs.readFile(filePath);
  return service.registerAsset({
    kind,
    filename: path.basename(filePath),
    buffer
  });
}

async function waitForRun(service, runId) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const run = await service.getRun(runId);
    if (!["queued", "running"].includes(run.state)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for run ${runId}`);
}

test("service persists benchmark entities, review history, previews, and compare summaries", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "avatar-service-"));
  const service = await createService(rootDir);
  const { referencePath, sourcePath } = await createMediaFixtures(rootDir);

  const referenceAsset = await registerAsset(service, referencePath, "reference");
  const sourceAsset = await registerAsset(service, sourcePath, "driving");
  const dataset = await service.createBenchmarkDataset({
    label: "smoke dataset",
    cases: [
      {
        label: "case 1",
        referenceAssetId: referenceAsset.id,
        sourceVideoAssetId: sourceAsset.id,
        tags: ["motion"]
      }
    ]
  });
  const group = await service.createBenchmarkRunGroup({
    label: "candidate compare",
    benchmarkDatasetId: dataset.id,
    candidateLabels: ["primary", "fallback"]
  });

  const primaryRun = await service.createRun({
    providerId: "mock-primary",
    spec: {
      referenceAssetId: referenceAsset.id,
      sourceVideoAssetId: sourceAsset.id,
      presetId: "square-512",
      benchmarkDatasetId: dataset.id,
      benchmarkCaseId: dataset.cases[0].id,
      benchmarkRunGroupId: group.id,
      candidateLabel: "primary"
    }
  });
  const fallbackRun = await service.createRun({
    providerId: "mock-fallback",
    spec: {
      referenceAssetId: referenceAsset.id,
      sourceVideoAssetId: sourceAsset.id,
      presetId: "square-512",
      benchmarkDatasetId: dataset.id,
      benchmarkCaseId: dataset.cases[0].id,
      benchmarkRunGroupId: group.id,
      candidateLabel: "fallback"
    }
  });

  const reviewedCandidate = await waitForRun(service, primaryRun.id);
  await waitForRun(service, fallbackRun.id);
  assert.equal(reviewedCandidate.state, "needs_review");

  await service.submitReview(primaryRun.id, {
    reviewer: "alice",
    notes: "needs a closer pass",
    tags: ["needs_followup"],
    criteria: {
      overall: "needs_work"
    }
  });
  await service.submitReview(primaryRun.id, {
    reviewer: "alice",
    decision: "approve",
    notes: "usable",
    tags: ["usable"],
    criteria: {
      identity: "pass",
      motion: "pass",
      overall: "pass"
    }
  });

  const finalPrimaryRun = await service.getRun(primaryRun.id);
  assert.equal(finalPrimaryRun.state, "succeeded");
  assert.equal(finalPrimaryRun.reviewHistory.length, 2);
  assert.equal(finalPrimaryRun.latestReview.decision, "approve");
  assert.equal(finalPrimaryRun.reviewHistory[0].criteria.overall, "needs_work");

  const previewArtifacts = await service.generateRunPreviews(primaryRun.id);
  const previewKinds = previewArtifacts.map((artifact) => artifact.kind).sort();
  assert.deepEqual(previewKinds, ["contact_sheet", "preview_still"]);
  const previewBytes = await Promise.all(previewArtifacts.map((artifact) => service.storageDriver.readBuffer(artifact.locator)));
  assert.equal(previewBytes.every((buffer) => buffer.length > 0), true);

  const sameInputComparison = await service.compareRuns(primaryRun.id, fallbackRun.id);
  assert.equal(sameInputComparison.sameInput, true);
  assert.equal(Boolean(sameInputComparison.summary), true);

  const groupSummary = await service.compareBenchmarkRunGroup(group.id);
  assert.equal(groupSummary.caseComparisons.length, 1);
  assert.equal(Object.keys(groupSummary.candidateSummary).includes("primary"), true);

  const storedGroup = await service.getBenchmarkRunGroup(group.id);
  assert.equal(storedGroup.members.length, 2);
});

test("service rejects invalid review tags and mismatched compares", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "avatar-service-"));
  const service = await createService(rootDir);
  const { referencePath, sourcePath, altSourcePath } = await createMediaFixtures(rootDir);

  const referenceAsset = await registerAsset(service, referencePath, "reference");
  const sourceAsset = await registerAsset(service, sourcePath, "driving");
  const altSourceAsset = await registerAsset(service, altSourcePath, "driving");

  const runA = await service.createRun({
    providerId: "mock-primary",
    spec: {
      referenceAssetId: referenceAsset.id,
      sourceVideoAssetId: sourceAsset.id,
      presetId: "square-512"
    }
  });
  const runB = await service.createRun({
    providerId: "mock-primary",
    spec: {
      referenceAssetId: referenceAsset.id,
      sourceVideoAssetId: altSourceAsset.id,
      presetId: "square-512"
    }
  });

  await waitForRun(service, runA.id);
  await waitForRun(service, runB.id);

  await assert.rejects(
    () =>
      service.submitReview(runA.id, {
        reviewer: "alice",
        tags: ["not-a-real-tag"]
      }),
    /Unsupported review tag/
  );

  const comparison = await service.compareRuns(runA.id, runB.id);
  assert.equal(comparison.sameInput, false);
  assert.equal(Boolean(comparison.mismatch), true);
});
