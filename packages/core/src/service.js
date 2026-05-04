import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ASSET_KINDS, assertAssetKind, assertReviewDecision, validateRunSpec } from "./contracts.js";
import { createId, sha256 } from "./ids.js";
import { assertSupportedFilename, inspectMedia, writeTempFile, getExtension } from "./media.js";
import { getPreset } from "./presets.js";
import { evaluateRun } from "./evaluation.js";

function nowIso() {
  return new Date().toISOString();
}

function contentTypeForExtension(extension) {
  switch (extension) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    default:
      return "video/mp4";
  }
}

export class AvatarService {
  constructor({ config, jobStore, storageDriver, providers }) {
    this.config = config;
    this.jobStore = jobStore;
    this.storageDriver = storageDriver;
    this.providers = providers;
    this.activeRuns = new Set();
  }

  async initialize() {
    await this.jobStore.initialize();
    await this.storageDriver.initialize();
  }

  async registerAsset({ kind, filename, label = "", buffer }) {
    assertAssetKind(kind);
    assertSupportedFilename(kind, filename);

    const assetId = createId("asset");
    const extension = getExtension(filename);
    const checksum = await sha256(buffer);
    const tempPath = await writeTempFile(assetId, filename, buffer);
    const media = await inspectMedia(tempPath);

    if (kind === "driving" && media.durationSec > 10) {
      throw new Error(`Driving video exceeds the 10 second limit (${media.durationSec.toFixed(2)}s).`);
    }

    const locator = await this.storageDriver.putBuffer(
      `inputs/${kind}/${assetId}${extension}`,
      buffer,
      contentTypeForExtension(extension)
    );

    await fs.rm(tempPath, { force: true });

    const asset = {
      id: assetId,
      kind,
      label,
      filename,
      extension,
      checksum,
      createdAt: nowIso(),
      locator,
      media
    };

    await this.jobStore.createAsset(asset);
    return asset;
  }

  async createRun({ providerId = "mock-primary", spec }) {
    const validatedSpec = validateRunSpec(spec);
    const [referenceAsset, sourceAsset] = await Promise.all([
      this.jobStore.getAsset(validatedSpec.referenceAssetId),
      this.jobStore.getAsset(validatedSpec.sourceVideoAssetId)
    ]);

    if (!referenceAsset) {
      throw new Error(`Reference asset "${validatedSpec.referenceAssetId}" was not found.`);
    }
    if (!sourceAsset) {
      throw new Error(`Driving asset "${validatedSpec.sourceVideoAssetId}" was not found.`);
    }

    const preset = getPreset(validatedSpec.presetId);
    const runId = createId("run");
    const createdAt = nowIso();

    const run = {
      id: runId,
      state: "queued",
      reviewStatus: "pending",
      providerId,
      presetId: preset.id,
      outputProfile: validatedSpec.outputProfile,
      notes: validatedSpec.notes,
      referenceAssetId: referenceAsset.id,
      sourceVideoAssetId: sourceAsset.id,
      artifacts: [],
      attempts: 0,
      cost: {
        estimatedUsd: 0
      },
      evaluation: null,
      failureReason: null,
      createdAt,
      updatedAt: createdAt,
      startedAt: null,
      completedAt: null
    };

    await this.jobStore.createRun(run);
    setImmediate(() => {
      this.executeRun(runId).catch((error) => {
        console.error(`Run ${runId} failed:`, error);
      });
    });

    return run;
  }

  async getRun(runId) {
    const run = await this.jobStore.getRun(runId);
    if (!run) {
      throw new Error(`Run "${runId}" was not found.`);
    }

    const review = await this.jobStore.getReview(runId);
    return {
      ...run,
      review
    };
  }

  async submitReview(runId, { decision, notes = "", tags = [] }) {
    assertReviewDecision(decision);
    const run = await this.getRun(runId);

    if (!["needs_review", "succeeded", "failed"].includes(run.state)) {
      throw new Error(`Run "${runId}" cannot be reviewed while in "${run.state}" state.`);
    }

    const reviewedAt = nowIso();
    const review = {
      runId,
      decision,
      notes,
      tags,
      reviewedAt
    };

    await this.jobStore.saveReview(runId, review);
    const nextState = decision === "approve" ? "succeeded" : "failed";
    const failureReason = decision === "reject" ? "Rejected during manual review." : null;

    return this.jobStore.updateRun(runId, (current) => ({
      ...current,
      state: nextState,
      reviewStatus: decision === "approve" ? "approved" : "rejected",
      failureReason,
      updatedAt: reviewedAt,
      completedAt: current.completedAt || reviewedAt
    }));
  }

  async getArtifact(runId, artifactId) {
    const run = await this.getRun(runId);
    const artifact = run.artifacts.find((item) => item.id === artifactId);
    if (!artifact) {
      throw new Error(`Artifact "${artifactId}" was not found for run "${runId}".`);
    }
    return artifact;
  }

  async executeRun(runId) {
    if (this.activeRuns.has(runId)) {
      return;
    }
    this.activeRuns.add(runId);

    try {
      await this.jobStore.updateRun(runId, (current) => ({
        ...current,
        state: "running",
        attempts: current.attempts + 1,
        startedAt: current.startedAt || nowIso(),
        updatedAt: nowIso()
      }));

      const run = await this.getRun(runId);
      const preset = getPreset(run.presetId);
      const provider = this.providers.get(run.providerId);
      const referenceAsset = await this.jobStore.getAsset(run.referenceAssetId);
      const sourceAsset = await this.jobStore.getAsset(run.sourceVideoAssetId);

      const [referencePath, sourcePath] = await Promise.all([
        this.materializeLocator(referenceAsset.locator, `reference-${referenceAsset.id}${referenceAsset.extension}`),
        this.materializeLocator(sourceAsset.locator, `driving-${sourceAsset.id}${sourceAsset.extension}`)
      ]);

      const providerResult = await provider.execute({
        runId,
        preset,
        sourceVideoPath: sourcePath,
        referenceImagePath: referencePath
      });

      const artifactId = createId("artifact");
      const artifactLocator = await this.storageDriver.putFile(
        `outputs/${runId}/${artifactId}.mp4`,
        providerResult.outputPath,
        "video/mp4"
      );

      const evaluation = await evaluateRun({
        sourceVideoPath: sourcePath,
        referenceImagePath: referencePath,
        outputVideoPath: providerResult.outputPath
      });

      await this.jobStore.updateRun(runId, (current) => ({
        ...current,
        state: "needs_review",
        artifacts: [
          {
            id: artifactId,
            kind: "retargeted_video",
            filename: `${runId}.mp4`,
            locator: artifactLocator
          }
        ],
        cost: {
          estimatedUsd: providerResult.usage.estimatedCostUsd
        },
        evaluation,
        failureReason: null,
        updatedAt: nowIso(),
        completedAt: nowIso()
      }));
    } catch (error) {
      await this.jobStore.updateRun(runId, (current) => ({
        ...current,
        state: "failed",
        failureReason: error.message,
        updatedAt: nowIso(),
        completedAt: nowIso()
      }));
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  async materializeLocator(locator, filename) {
    if (locator.type === "local") {
      return locator.path;
    }
    const buffer = await this.storageDriver.readBuffer(locator);
    const tempDir = path.join(os.tmpdir(), "avatar-project", "materialized");
    await fs.mkdir(tempDir, { recursive: true });
    const filePath = path.join(tempDir, `${Date.now()}-${filename}`);
    await fs.writeFile(filePath, buffer);
    return filePath;
  }
}
