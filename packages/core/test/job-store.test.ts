// @ts-nocheck
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { FileJobStore } from "../src/job-store.js";

function makeRun(id, state = "queued", createdAt = "2026-01-01T00:00:00.000Z", overrides = {}) {
  return {
    id,
    state,
    reviewStatus: "pending",
    providerId: "test-provider",
    provider: {
      id: "test-provider",
      displayName: "Test Provider",
      modelId: "test/model",
      runId: null,
      status: state,
      submittedAt: null,
      startedAt: null,
      completedAt: null,
      lastPolledAt: null,
      pollCount: 0
    },
    presetId: "preview-720p",
    outputProfile: "",
    notes: "",
    referenceAssetId: "asset_reference",
    sourceVideoAssetId: "asset_driving",
    benchmarkDatasetId: null,
    benchmarkCaseId: null,
    benchmarkRunGroupId: null,
    candidateLabel: "",
    artifacts: [],
    attempts: 0,
    cost: {
      estimatedUsd: 0
    },
    retryState: null,
    deadLetteredAt: null,
    deadLetterReason: null,
    evaluation: null,
    failure: null,
    failureReason: null,
    lineage: {},
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    completedAt: null,
    ...overrides
  };
}

test("FileJobStore creates archive runs directory on initialize", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "avatar-job-store-"));
  const store = new FileJobStore(rootDir);

  await store.initialize();

  const stat = await fs.stat(path.join(rootDir, "archive", "runs"));
  assert.equal(stat.isDirectory(), true);
});

test("FileJobStore moves archived runs and falls back to archive path", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "avatar-job-store-"));
  const store = new FileJobStore(rootDir);
  await store.initialize();

  await store.createRun(makeRun("run_live", "queued", "2026-01-01T00:00:00.000Z"));
  await store.createRun(makeRun("run_done", "succeeded", "2026-01-02T00:00:00.000Z"));

  const archived = await store.archiveRun("run_done", "retention");

  assert.equal(archived.id, "run_done");
  assert.equal(archived.archived, true);
  await assert.rejects(fs.stat(path.join(rootDir, "runs", "run_done.json")));
  assert.equal((await fs.stat(path.join(rootDir, "archive", "runs", "run_done.json"))).isFile(), true);

  const fallbackRun = await store.getRun("run_done");
  assert.equal(fallbackRun?.id, "run_done");
  assert.equal(fallbackRun?.archived, true);

  const liveRuns = await store.listRuns();
  assert.deepEqual(liveRuns.map((run) => run.id), ["run_live"]);

  const allRuns = await store.listRuns({ includeArchived: true });
  assert.deepEqual(allRuns.map((run) => run.id), ["run_done", "run_live"]);
  assert.equal(allRuns[0].archived, true);

  const succeededRuns = await store.listRuns({ includeArchived: true, states: ["succeeded"] });
  assert.deepEqual(succeededRuns.map((run) => run.id), ["run_done"]);
});

test("FileJobStore updates archived runs without restoring them to live listings", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "avatar-job-store-"));
  const store = new FileJobStore(rootDir);
  await store.initialize();

  await store.createRun(makeRun("run_done", "succeeded", "2026-01-02T00:00:00.000Z"));
  await store.archiveRun("run_done", "retention");

  const updated = await store.updateRun("run_done", (current) => ({
    ...current,
    notes: "reviewed after archive",
    archived: false,
    updatedAt: "2026-01-03T00:00:00.000Z"
  }));

  assert.equal(updated.notes, "reviewed after archive");
  assert.equal(updated.archived, true);
  await assert.rejects(fs.stat(path.join(rootDir, "runs", "run_done.json")));

  const archivedRecord = JSON.parse(await fs.readFile(path.join(rootDir, "archive", "runs", "run_done.json"), "utf8"));
  assert.equal(archivedRecord.notes, "reviewed after archive");
  assert.equal(archivedRecord.archived, true);

  const fallbackRun = await store.getRun("run_done");
  assert.equal(fallbackRun?.notes, "reviewed after archive");
  assert.equal(fallbackRun?.archived, true);

  assert.deepEqual(await store.listRuns(), []);
  const allRuns = await store.listRuns({ includeArchived: true });
  assert.deepEqual(allRuns.map((run) => run.id), ["run_done"]);
  assert.equal(allRuns[0].notes, "reviewed after archive");
  assert.equal(allRuns[0].archived, true);
});

test("FileJobStore updates live runs without creating archived records", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "avatar-job-store-"));
  const store = new FileJobStore(rootDir);
  await store.initialize();

  await store.createRun(makeRun("run_live", "running", "2026-01-02T00:00:00.000Z"));

  const updated = await store.updateRun("run_live", {
    notes: "still active",
    updatedAt: "2026-01-03T00:00:00.000Z"
  });

  assert.equal(updated.notes, "still active");
  assert.equal(updated.archived, undefined);
  assert.equal((await fs.stat(path.join(rootDir, "runs", "run_live.json"))).isFile(), true);
  await assert.rejects(fs.stat(path.join(rootDir, "archive", "runs", "run_live.json")));

  const liveRecord = JSON.parse(await fs.readFile(path.join(rootDir, "runs", "run_live.json"), "utf8"));
  assert.equal(liveRecord.notes, "still active");
  assert.equal(liveRecord.archived, undefined);

  const liveRuns = await store.listRuns();
  assert.deepEqual(liveRuns.map((run) => run.id), ["run_live"]);
  assert.equal(liveRuns[0].notes, "still active");
});

test("FileJobStore applies default and capped listRuns limits", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "avatar-job-store-"));
  const store = new FileJobStore(rootDir);
  await store.initialize();

  await Promise.all(
    Array.from({ length: 505 }, (_, index) =>
      store.createRun(makeRun(`run_${String(index).padStart(3, "0")}`, "queued", `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`))
    )
  );

  assert.equal((await store.listRuns()).length, 100);
  assert.equal((await store.listRuns({ limit: 3 })).length, 3);
  assert.equal((await store.listRuns({ limit: 1000 })).length, 500);
});
