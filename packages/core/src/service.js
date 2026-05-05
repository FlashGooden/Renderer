import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { assertAssetKind, assertArtifactKind, validateBenchmarkDatasetInput, validateBenchmarkRunGroupInput, validateReviewInput, validateRunSpec } from "./contracts.js";
import { compareBenchmarkRunGroup, compareRuns } from "./compare.js";
import { createId, sha256 } from "./ids.js";
import { assertSupportedFilename, inspectMedia, writeTempFile, getExtension } from "./media.js";
import { getPreset } from "./presets.js";
import { evaluateRun } from "./evaluation.js";
import { generateContactSheet, generatePreviewStill } from "./previews.js";

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

function deriveLatestReview(reviewHistory) {
  if (!reviewHistory.length) {
    return null;
  }
  return reviewHistory[reviewHistory.length - 1];
}

function hydrateRunReview(run, reviewHistory) {
  return {
    ...run,
    reviewHistory,
    latestReview: deriveLatestReview(reviewHistory)
  };
}

function buildArtifactFilename(runId, kind) {
  if (kind === "preview_still") {
    return `${runId}-preview-still.png`;
  }
  if (kind === "contact_sheet") {
    return `${runId}-contact-sheet.png`;
  }
  return `${runId}.mp4`;
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

  async createBenchmarkDataset(input) {
    const validated = validateBenchmarkDatasetInput(input);
    const createdAt = nowIso();
    const cases = [];

    for (const benchmarkCase of validated.cases) {
      const [referenceAsset, sourceAsset] = await Promise.all([
        this.jobStore.getAsset(benchmarkCase.referenceAssetId),
        this.jobStore.getAsset(benchmarkCase.sourceVideoAssetId)
      ]);
      if (!referenceAsset) {
        throw new Error(`Reference asset "${benchmarkCase.referenceAssetId}" was not found.`);
      }
      if (!sourceAsset) {
        throw new Error(`Driving asset "${benchmarkCase.sourceVideoAssetId}" was not found.`);
      }
      cases.push({
        ...benchmarkCase,
        id: benchmarkCase.id || createId("benchmark_case")
      });
    }

    const dataset = {
      id: createId("benchmark_dataset"),
      label: validated.label,
      notes: validated.notes,
      cases,
      createdAt,
      updatedAt: createdAt
    };

    return this.jobStore.createBenchmarkDataset(dataset);
  }

  async getBenchmarkDataset(datasetId) {
    const dataset = await this.jobStore.getBenchmarkDataset(datasetId);
    if (!dataset) {
      throw new Error(`Benchmark dataset "${datasetId}" was not found.`);
    }
    return dataset;
  }

  async createBenchmarkRunGroup(input) {
    const validated = validateBenchmarkRunGroupInput(input);
    await this.getBenchmarkDataset(validated.benchmarkDatasetId);

    const createdAt = nowIso();
    const group = {
      id: createId("benchmark_group"),
      label: validated.label,
      notes: validated.notes,
      benchmarkDatasetId: validated.benchmarkDatasetId,
      candidateLabels: validated.candidateLabels,
      members: [],
      createdAt,
      updatedAt: createdAt
    };

    return this.jobStore.createBenchmarkRunGroup(group);
  }

  async getBenchmarkRunGroup(groupId) {
    const group = await this.jobStore.getBenchmarkRunGroup(groupId);
    if (!group) {
      throw new Error(`Benchmark run group "${groupId}" was not found.`);
    }
    return group;
  }

  async compareBenchmarkRunGroup(groupId) {
    const group = await this.getBenchmarkRunGroup(groupId);
    const dataset = await this.getBenchmarkDataset(group.benchmarkDatasetId);
    const runs = await Promise.all((group.members || []).map((member) => this.getRun(member.runId)));
    return compareBenchmarkRunGroup(group, dataset, runs);
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

    let benchmarkDataset = null;
    let benchmarkRunGroup = null;
    let benchmarkCase = null;
    if (validatedSpec.benchmarkDatasetId) {
      benchmarkDataset = await this.getBenchmarkDataset(validatedSpec.benchmarkDatasetId);
    }
    if (validatedSpec.benchmarkRunGroupId) {
      benchmarkRunGroup = await this.getBenchmarkRunGroup(validatedSpec.benchmarkRunGroupId);
      if (!validatedSpec.candidateLabel) {
        throw new Error("benchmarkRunGroupId requires candidateLabel.");
      }
      if (benchmarkDataset && benchmarkRunGroup.benchmarkDatasetId !== benchmarkDataset.id) {
        throw new Error("Benchmark run group and dataset do not match.");
      }
      benchmarkDataset = benchmarkDataset || (await this.getBenchmarkDataset(benchmarkRunGroup.benchmarkDatasetId));
    }
    if (validatedSpec.benchmarkCaseId) {
      if (!benchmarkDataset) {
        throw new Error("benchmarkCaseId requires a matching benchmarkDatasetId or benchmarkRunGroupId.");
      }
      benchmarkCase = benchmarkDataset?.cases?.find((item) => item.id === validatedSpec.benchmarkCaseId) || null;
      if (!benchmarkCase) {
        throw new Error(`Benchmark case "${validatedSpec.benchmarkCaseId}" was not found.`);
      }
      if (
        benchmarkCase.referenceAssetId !== validatedSpec.referenceAssetId ||
        benchmarkCase.sourceVideoAssetId !== validatedSpec.sourceVideoAssetId
      ) {
        throw new Error("Run inputs do not match the selected benchmark case.");
      }
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
      benchmarkDatasetId: benchmarkDataset?.id || null,
      benchmarkCaseId: benchmarkCase?.id || validatedSpec.benchmarkCaseId || null,
      benchmarkRunGroupId: benchmarkRunGroup?.id || null,
      candidateLabel: validatedSpec.candidateLabel || "",
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
    if (benchmarkRunGroup) {
      await this.jobStore.updateBenchmarkRunGroup(benchmarkRunGroup.id, (current) => ({
        ...current,
        candidateLabels: [...new Set([...current.candidateLabels, run.candidateLabel])],
        members: [
          ...current.members.filter((item) => item.runId !== run.id),
          {
            runId: run.id,
            benchmarkCaseId: run.benchmarkCaseId,
            candidateLabel: run.candidateLabel
          }
        ],
        updatedAt: nowIso()
      }));
    }

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

    const reviewHistory = await this.jobStore.getReviewHistory(runId);
    return hydrateRunReview(run, reviewHistory);
  }

  async submitReview(runId, input = {}) {
    const validated = validateReviewInput(input);
    const run = await this.getRun(runId);

    if (!["needs_review", "succeeded", "failed"].includes(run.state)) {
      throw new Error(`Run "${runId}" cannot be reviewed while in "${run.state}" state.`);
    }

    const reviewedAt = nowIso();
    const reviewEntry = {
      runId,
      reviewer: validated.reviewer,
      decision: validated.decision,
      notes: validated.notes,
      tags: validated.tags,
      criteria: validated.criteria,
      reviewedAt
    };

    const reviewHistory = await this.jobStore.appendReview(runId, reviewEntry);
    const nextFields = {
      updatedAt: reviewedAt
    };

    if (validated.decision === "approve") {
      nextFields.state = "succeeded";
      nextFields.reviewStatus = "approved";
      nextFields.failureReason = null;
      nextFields.completedAt = run.completedAt || reviewedAt;
    } else if (validated.decision === "reject") {
      nextFields.state = "failed";
      nextFields.reviewStatus = "rejected";
      nextFields.failureReason = "Rejected during manual review.";
      nextFields.completedAt = run.completedAt || reviewedAt;
    }

    const updatedRun = await this.jobStore.updateRun(runId, (current) => ({
      ...current,
      ...nextFields
    }));

    return hydrateRunReview(updatedRun, reviewHistory);
  }

  async compareRuns(runAId, runBId) {
    const [leftRun, rightRun] = await Promise.all([this.getRun(runAId), this.getRun(runBId)]);
    return compareRuns(leftRun, rightRun);
  }

  async getArtifact(runId, artifactId) {
    const run = await this.getRun(runId);
    const artifact = run.artifacts.find((item) => item.id === artifactId);
    if (!artifact) {
      throw new Error(`Artifact "${artifactId}" was not found for run "${runId}".`);
    }
    return artifact;
  }

  async generateRunPreviews(runId, { kinds = ["preview_still", "contact_sheet"] } = {}) {
    const run = await this.getRun(runId);
    const outputArtifact = run.artifacts.find((item) => item.kind === "retargeted_video");
    if (!outputArtifact) {
      throw new Error(`Run "${runId}" does not have a retargeted video artifact yet.`);
    }

    for (const kind of kinds) {
      assertArtifactKind(kind);
      if (!["preview_still", "contact_sheet"].includes(kind)) {
        throw new Error(`Artifact kind "${kind}" is not preview-generatable.`);
      }
    }

    const existingArtifacts = run.artifacts.filter((artifact) => kinds.includes(artifact.kind));
    if (existingArtifacts.length === kinds.length) {
      return existingArtifacts;
    }

    const videoPath = await this.materializeLocator(outputArtifact.locator, outputArtifact.filename);
    const outputMeta = await inspectMedia(videoPath);
    const tempDir = path.join(os.tmpdir(), "avatar-project", runId, "previews");
    await fs.mkdir(tempDir, { recursive: true });

    const createdArtifacts = [];
    for (const kind of kinds) {
      if (run.artifacts.some((artifact) => artifact.kind === kind)) {
        createdArtifacts.push(run.artifacts.find((artifact) => artifact.kind === kind));
        continue;
      }

      const artifactId = createId("artifact");
      const filename = buildArtifactFilename(run.id, kind);
      const outputPath = path.join(tempDir, filename);

      if (kind === "preview_still") {
        await generatePreviewStill({
          videoPath,
          outputPath,
          timeSec: Math.max(outputMeta.durationSec / 2, 0)
        });
      } else if (kind === "contact_sheet") {
        await generateContactSheet({
          videoPath,
          outputPath,
          durationSec: outputMeta.durationSec
        });
      }

      const locator = await this.storageDriver.putFile(`outputs/${run.id}/${artifactId}.png`, outputPath, "image/png");
      createdArtifacts.push({
        id: artifactId,
        kind,
        filename,
        locator
      });
    }

    if (createdArtifacts.length) {
      await this.jobStore.updateRun(run.id, (current) => ({
        ...current,
        artifacts: [...current.artifacts, ...createdArtifacts],
        updatedAt: nowIso()
      }));
    }

    return createdArtifacts;
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
        reviewStatus: current.reviewStatus === "approved" ? "approved" : "pending",
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
