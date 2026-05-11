import path from "node:path";
import { ensureDir, readJson, writeJson } from "./fs-utils.js";
import type { Asset, BenchmarkDataset, BenchmarkRunGroup, JobStore, ReviewEntry, Run } from "./types.js";

function normalizeReviewStorage(review: ReviewEntry | ReviewEntry[] | { reviewHistory?: ReviewEntry[] } | null): ReviewEntry[] {
  if (!review) {
    return [];
  }
  if (Array.isArray(review)) {
    return review;
  }
  if ("reviewHistory" in review && Array.isArray(review.reviewHistory)) {
    return review.reviewHistory;
  }
  return [review as ReviewEntry];
}

export class FileJobStore implements JobStore {
  rootDir: string;
  assetsDir: string;
  runsDir: string;
  reviewsDir: string;
  benchmarkDatasetsDir: string;
  benchmarkRunGroupsDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.assetsDir = path.join(rootDir, "assets");
    this.runsDir = path.join(rootDir, "runs");
    this.reviewsDir = path.join(rootDir, "reviews");
    this.benchmarkDatasetsDir = path.join(rootDir, "benchmark-datasets");
    this.benchmarkRunGroupsDir = path.join(rootDir, "benchmark-run-groups");
  }

  async initialize(): Promise<void> {
    await Promise.all([
      ensureDir(this.assetsDir),
      ensureDir(this.runsDir),
      ensureDir(this.reviewsDir),
      ensureDir(this.benchmarkDatasetsDir),
      ensureDir(this.benchmarkRunGroupsDir)
    ]);
  }

  assetPath(assetId: string): string {
    return path.join(this.assetsDir, `${assetId}.json`);
  }

  runPath(runId: string): string {
    return path.join(this.runsDir, `${runId}.json`);
  }

  reviewPath(runId: string): string {
    return path.join(this.reviewsDir, `${runId}.json`);
  }

  benchmarkDatasetPath(datasetId: string): string {
    return path.join(this.benchmarkDatasetsDir, `${datasetId}.json`);
  }

  benchmarkRunGroupPath(groupId: string): string {
    return path.join(this.benchmarkRunGroupsDir, `${groupId}.json`);
  }

  async createAsset(asset: Asset): Promise<Asset> {
    await writeJson(this.assetPath(asset.id), asset);
    return asset;
  }

  async getAsset(assetId: string): Promise<Asset | null> {
    return readJson<Asset>(this.assetPath(assetId));
  }

  async createRun(run: Run): Promise<Run> {
    await writeJson(this.runPath(run.id), run);
    return run;
  }

  async getRun(runId: string): Promise<Run | null> {
    return readJson<Run>(this.runPath(runId));
  }

  async updateRun(runId: string, updater: Partial<Run> | ((run: Run) => Run | Promise<Run>)): Promise<Run> {
    const current = await this.getRun(runId);
    if (!current) {
      throw new Error(`Run "${runId}" was not found.`);
    }
    const next = typeof updater === "function" ? await updater(current) : { ...current, ...updater };
    await writeJson(this.runPath(runId), next);
    return next;
  }

  async appendReview(runId: string, reviewEntry: ReviewEntry): Promise<ReviewEntry[]> {
    const history = await this.getReviewHistory(runId);
    const nextHistory = [...history, reviewEntry];
    await writeJson(this.reviewPath(runId), nextHistory);
    return nextHistory;
  }

  async getReviewHistory(runId: string): Promise<ReviewEntry[]> {
    return normalizeReviewStorage(await readJson<ReviewEntry | ReviewEntry[] | { reviewHistory?: ReviewEntry[] }>(this.reviewPath(runId)));
  }

  async createBenchmarkDataset(dataset: BenchmarkDataset): Promise<BenchmarkDataset> {
    await writeJson(this.benchmarkDatasetPath(dataset.id), dataset);
    return dataset;
  }

  async getBenchmarkDataset(datasetId: string): Promise<BenchmarkDataset | null> {
    return readJson<BenchmarkDataset>(this.benchmarkDatasetPath(datasetId));
  }

  async updateBenchmarkDataset(
    datasetId: string,
    updater: Partial<BenchmarkDataset> | ((dataset: BenchmarkDataset) => BenchmarkDataset | Promise<BenchmarkDataset>)
  ): Promise<BenchmarkDataset> {
    const current = await this.getBenchmarkDataset(datasetId);
    if (!current) {
      throw new Error(`Benchmark dataset "${datasetId}" was not found.`);
    }
    const next = typeof updater === "function" ? await updater(current) : { ...current, ...updater };
    await writeJson(this.benchmarkDatasetPath(datasetId), next);
    return next;
  }

  async createBenchmarkRunGroup(group: BenchmarkRunGroup): Promise<BenchmarkRunGroup> {
    await writeJson(this.benchmarkRunGroupPath(group.id), group);
    return group;
  }

  async getBenchmarkRunGroup(groupId: string): Promise<BenchmarkRunGroup | null> {
    return readJson<BenchmarkRunGroup>(this.benchmarkRunGroupPath(groupId));
  }

  async updateBenchmarkRunGroup(
    groupId: string,
    updater: Partial<BenchmarkRunGroup> | ((group: BenchmarkRunGroup) => BenchmarkRunGroup | Promise<BenchmarkRunGroup>)
  ): Promise<BenchmarkRunGroup> {
    const current = await this.getBenchmarkRunGroup(groupId);
    if (!current) {
      throw new Error(`Benchmark run group "${groupId}" was not found.`);
    }
    const next = typeof updater === "function" ? await updater(current) : { ...current, ...updater };
    await writeJson(this.benchmarkRunGroupPath(groupId), next);
    return next;
  }
}
