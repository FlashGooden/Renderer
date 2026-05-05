import path from "node:path";
import { ensureDir, readJson, writeJson } from "./fs-utils.js";

export class FileJobStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.assetsDir = path.join(rootDir, "assets");
    this.runsDir = path.join(rootDir, "runs");
    this.reviewsDir = path.join(rootDir, "reviews");
  }

  async initialize() {
    await Promise.all([
      ensureDir(this.assetsDir),
      ensureDir(this.runsDir),
      ensureDir(this.reviewsDir)
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

  async saveReview(runId, review) {
    await writeJson(this.reviewPath(runId), review);
    return review;
  }

  async getReview(runId) {
    return readJson(this.reviewPath(runId));
  }
}

