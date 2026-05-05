import path from "node:path";
import { ensureDir, readJson, writeJson } from "./fs-utils.js";

function normalizeReviewStorage(review) {
  if (!review) {
    return [];
  }
  if (Array.isArray(review)) {
    return review;
  }
  if (Array.isArray(review.reviewHistory)) {
    return review.reviewHistory;
  }
  return [review];
}

export class FileJobStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.assetsDir = path.join(rootDir, "assets");
    this.runsDir = path.join(rootDir, "runs");
    this.reviewsDir = path.join(rootDir, "reviews");
    this.benchmarkDatasetsDir = path.join(rootDir, "benchmark-datasets");
    this.benchmarkRunGroupsDir = path.join(rootDir, "benchmark-run-groups");
  }

  async initialize() {
    await Promise.all([
      ensureDir(this.assetsDir),
      ensureDir(this.runsDir),
      ensureDir(this.reviewsDir),
      ensureDir(this.benchmarkDatasetsDir),
      ensureDir(this.benchmarkRunGroupsDir)
    ]);
  }

  assetPath(assetId) {
    return path.join(this.assetsDir, `${assetId}.json`);
  }

  runPath(runId) {
    return path.join(this.runsDir, `${runId}.json`);
  }

  reviewPath(runId) {
    return path.join(this.reviewsDir, `${runId}.json`);
  }

  benchmarkDatasetPath(datasetId) {
    return path.join(this.benchmarkDatasetsDir, `${datasetId}.json`);
  }

  benchmarkRunGroupPath(groupId) {
    return path.join(this.benchmarkRunGroupsDir, `${groupId}.json`);
  }

  async createAsset(asset) {
    await writeJson(this.assetPath(asset.id), asset);
    return asset;
  }

  async getAsset(assetId) {
    return readJson(this.assetPath(assetId));
  }

  async createRun(run) {
    await writeJson(this.runPath(run.id), run);
    return run;
  }

  async getRun(runId) {
    return readJson(this.runPath(runId));
  }

  async updateRun(runId, updater) {
    const current = await this.getRun(runId);
    if (!current) {
      throw new Error(`Run "${runId}" was not found.`);
    }
    const next = typeof updater === "function" ? await updater(current) : { ...current, ...updater };
    await writeJson(this.runPath(runId), next);
    return next;
  }

  async appendReview(runId, reviewEntry) {
    const history = await this.getReviewHistory(runId);
    const nextHistory = [...history, reviewEntry];
    await writeJson(this.reviewPath(runId), nextHistory);
    return nextHistory;
  }

  async getReviewHistory(runId) {
    return normalizeReviewStorage(await readJson(this.reviewPath(runId)));
  }

  async createBenchmarkDataset(dataset) {
    await writeJson(this.benchmarkDatasetPath(dataset.id), dataset);
    return dataset;
  }

  async getBenchmarkDataset(datasetId) {
    return readJson(this.benchmarkDatasetPath(datasetId));
  }

  async updateBenchmarkDataset(datasetId, updater) {
    const current = await this.getBenchmarkDataset(datasetId);
    if (!current) {
      throw new Error(`Benchmark dataset "${datasetId}" was not found.`);
    }
    const next = typeof updater === "function" ? await updater(current) : { ...current, ...updater };
    await writeJson(this.benchmarkDatasetPath(datasetId), next);
    return next;
  }

  async createBenchmarkRunGroup(group) {
    await writeJson(this.benchmarkRunGroupPath(group.id), group);
    return group;
  }

  async getBenchmarkRunGroup(groupId) {
    return readJson(this.benchmarkRunGroupPath(groupId));
  }

  async updateBenchmarkRunGroup(groupId, updater) {
    const current = await this.getBenchmarkRunGroup(groupId);
    if (!current) {
      throw new Error(`Benchmark run group "${groupId}" was not found.`);
    }
    const next = typeof updater === "function" ? await updater(current) : { ...current, ...updater };
    await writeJson(this.benchmarkRunGroupPath(groupId), next);
    return next;
  }
}
