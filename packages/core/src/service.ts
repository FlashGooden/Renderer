import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import {
  assertAssetKind,
  assertArtifactKind,
  validateBenchmarkDatasetInput,
  validateBenchmarkRunGroupInput,
  validateReviewInput,
  validateRunSpec
} from "./contracts.js";
import { compareBenchmarkRunGroup, compareRuns } from "./compare.js";
import { createId, sha256 } from "./ids.js";
import {
  assertSupportedFilename,
  inspectMedia,
  writeTempFile,
  getExtension,
  contentTypeForExtension
} from "./media.js";
import { getPreset } from "./presets.js";
import { evaluateRun } from "./evaluation.js";
import { generateContactSheet, generatePreviewStill } from "./previews.js";
import { normalizeReplicateFailure, ProviderError } from "./providers.js";
import type { AnyRecord, Artifact, ArtifactKind, Asset, AssetKind, BenchmarkDataset, BenchmarkRunGroup, EvaluationResult, JobStore, MediaInspection, ProjectConfig, Provider, ProviderRegistry, ProviderSnapshot, ProviderState, ReviewEntry, Run, StorageDriver, StorageLocator } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function cloneAssetRef(asset: Asset) {
  return {
    assetId: asset.id,
    kind: asset.kind,
    filename: asset.filename,
    extension: asset.extension,
    contentType: asset.contentType,
    checksum: asset.checksum,
    locator: asset.locator,
    media: asset.media
  };
}

function buildProviderSnapshot(provider: Provider, state: ProviderState | null = {}): ProviderSnapshot {
  state = state || {};
  return {
    id: provider.id,
    displayName: provider.displayName || provider.id,
    modelId: state.modelId || provider.modelId || null,
    runId: state.providerRunId || null,
    status: state.status || "queued",
    submittedAt: state.createdAt || null,
    startedAt: state.startedAt || null,
    completedAt: state.completedAt || null,
    lastPolledAt: state.lastPolledAt || null,
    pollCount: Number(state.pollCount || 0)
  };
}

function deriveLatestReview(reviewHistory: ReviewEntry[]): ReviewEntry | null {
  if (!reviewHistory.length) {
    return null;
  }
  return reviewHistory[reviewHistory.length - 1];
}

function hydrateRunReview(run: Run, reviewHistory: ReviewEntry[]) {
  return {
    ...run,
    reviewHistory,
    latestReview: deriveLatestReview(reviewHistory)
  };
}

function buildArtifactFilename(runId: string, kind: string): string {
  if (kind === "preview_still") {
    return `${runId}-preview-still.png`;
  }
  if (kind === "contact_sheet") {
    return `${runId}-contact-sheet.png`;
  }
  return `${runId}.mp4`;
}

export class AvatarService {
  config: ProjectConfig;
  jobStore: JobStore;
  storageDriver: StorageDriver;
  providers: ProviderRegistry;
  activeRuns: Set<string>;

  constructor({ config, jobStore, storageDriver, providers }: { config: ProjectConfig; jobStore: JobStore; storageDriver: StorageDriver; providers: ProviderRegistry }) {
    this.config = config;
    this.jobStore = jobStore;
    this.storageDriver = storageDriver;
    this.providers = providers;
    this.activeRuns = new Set();
  }

  async initialize(): Promise<void> {
    await this.jobStore.initialize();
    await this.storageDriver.initialize();
  }

  async registerAsset({ kind, filename, label = "", buffer }: { kind: AssetKind; filename: string; label?: string; buffer: Buffer }): Promise<Asset> {
    assertAssetKind(kind);
    assertSupportedFilename(kind, filename);

    const assetId = createId("asset");
    const extension = getExtension(filename);
    const contentType = contentTypeForExtension(extension);
    const checksum = await sha256(buffer);
    const tempPath = await writeTempFile(assetId, filename, buffer);
    const media = await inspectMedia(tempPath);

    this.assertAssetMedia(kind, media);

    const { locator, bytes: storedBytes } = await this.storageDriver.putBuffer(
      `inputs/${kind}/${assetId}${extension}`,
      buffer,
      contentType
    );
    void storedBytes;

    await fs.rm(tempPath, { force: true });

    const asset = {
      id: assetId,
      kind,
      label,
      filename,
      extension,
      contentType,
      checksum,
      createdAt: nowIso(),
      locator,
      media
    };

    await this.jobStore.createAsset(asset);
    return asset;
  }

  async createBenchmarkDataset(input: AnyRecord) {
    const validated = validateBenchmarkDatasetInput(input);
    const createdAt = nowIso();
    const cases: any[] = [];

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

  async getBenchmarkDataset(datasetId: string): Promise<BenchmarkDataset> {
    const dataset = await this.jobStore.getBenchmarkDataset(datasetId);
    if (!dataset) {
      throw new Error(`Benchmark dataset "${datasetId}" was not found.`);
    }
    return dataset;
  }

  async createBenchmarkRunGroup(input: AnyRecord) {
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

  async getBenchmarkRunGroup(groupId: string): Promise<BenchmarkRunGroup> {
    const group = await this.jobStore.getBenchmarkRunGroup(groupId);
    if (!group) {
      throw new Error(`Benchmark run group "${groupId}" was not found.`);
    }
    return group;
  }

  async compareBenchmarkRunGroup(groupId: string) {
    const group = await this.getBenchmarkRunGroup(groupId);
    const dataset = await this.getBenchmarkDataset(group.benchmarkDatasetId);
    const runs = await Promise.all((group.members || []).map((member) => this.getRun(member.runId)));
    return compareBenchmarkRunGroup(group, dataset, runs);
  }

  async createRun({ providerId = "replicate-dreamactor", spec }: { providerId?: string; spec: AnyRecord }): Promise<Run> {
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

    let benchmarkDataset: BenchmarkDataset | null = null;
    let benchmarkRunGroup: BenchmarkRunGroup | null = null;
    let benchmarkCase: any = null;
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
      benchmarkCase = benchmarkDataset.cases.find((item) => item.id === validatedSpec.benchmarkCaseId) || null;
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
    const provider = this.providers.get(providerId);
    provider.validateRun({ referenceAsset, sourceAsset, preset });

    const runId = createId("run");
    const createdAt = nowIso();
    const run: Run = {
      id: runId,
      state: "queued",
      reviewStatus: "pending",
      providerId,
      provider: buildProviderSnapshot(provider),
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
      retryState: null,
      deadLetteredAt: null,
      deadLetterReason: null,
      evaluation: null,
      failure: null,
      failureReason: null,
      lineage: {
        inputAssets: {
          reference: cloneAssetRef(referenceAsset),
          driving: cloneAssetRef(sourceAsset)
        },
        providerPayloads: {
          submitRequestArtifactId: null,
          submitResponseArtifactId: null,
          pollArtifactIds: [],
          terminalArtifactId: null,
          cancelArtifactId: null
        },
        finalOutput: null
      },
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

  async getRun(runId: string) {
    const run = await this.jobStore.getRun(runId);
    if (!run) {
      throw new Error(`Run "${runId}" was not found.`);
    }

    const reviewHistory = await this.jobStore.getReviewHistory(runId);
    return hydrateRunReview(run, reviewHistory);
  }

  async submitReview(runId: string, input: AnyRecord = {}) {
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
    const nextFields: Partial<Run> = {
      updatedAt: reviewedAt
    };

    if (validated.decision === "approve") {
      nextFields.state = "succeeded";
      nextFields.reviewStatus = "approved";
      nextFields.failure = null;
      nextFields.failureReason = null;
      nextFields.completedAt = run.completedAt || reviewedAt;
    } else if (validated.decision === "reject") {
      nextFields.state = "failed";
      nextFields.reviewStatus = "rejected";
      nextFields.failure = {
        code: "provider_unknown",
        message: "Rejected during manual review.",
        retryable: false,
        providerStatus: null,
        details: {}
      };
      nextFields.failureReason = nextFields.failure.message;
      nextFields.completedAt = run.completedAt || reviewedAt;
    }

    const updatedRun = await this.jobStore.updateRun(runId, (current) => ({
      ...current,
      ...nextFields
    }));

    return hydrateRunReview(updatedRun, reviewHistory);
  }

  async compareRuns(runAId: string, runBId: string) {
    const [leftRun, rightRun] = await Promise.all([this.getRun(runAId), this.getRun(runBId)]);
    return compareRuns(leftRun, rightRun);
  }

  async getArtifact(runId: string, artifactId: string): Promise<Artifact> {
    const run = await this.getRun(runId);
    const artifact = run.artifacts.find((item) => item.id === artifactId);
    if (!artifact) {
      throw new Error(`Artifact "${artifactId}" was not found for run "${runId}".`);
    }
    return artifact;
  }

  async generateRunPreviews(runId: string, { kinds = ["preview_still", "contact_sheet"] }: { kinds?: ArtifactKind[] } = {}): Promise<Artifact[]> {
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

    const existingArtifacts = run.artifacts.filter((artifact) => kinds.includes(artifact.kind as ArtifactKind));
    if (existingArtifacts.length === kinds.length) {
      return existingArtifacts;
    }

    const materializedPaths: string[] = [];
    try {
      const videoPath = await this.materializeLocator(outputArtifact.locator, outputArtifact.filename, materializedPaths);
      const outputMeta = await inspectMedia(videoPath);
      const tempDir = path.join(os.tmpdir(), "avatar-project", runId, "previews");
      await fs.mkdir(tempDir, { recursive: true });

      const createdArtifacts: Artifact[] = [];
      for (const kind of kinds) {
        const existing = run.artifacts.find((artifact) => artifact.kind === kind);
        if (existing) {
          createdArtifacts.push(existing);
          continue;
        }

        const filename = buildArtifactFilename(run.id, kind);
        const outputPath = path.join(tempDir, filename);

        if (kind === "preview_still") {
          await generatePreviewStill({
            videoPath,
            outputPath,
            timeSec: Math.max(outputMeta.durationSec / 2, 0)
          });
        } else {
          await generateContactSheet({
            videoPath,
            outputPath,
            durationSec: outputMeta.durationSec
          });
        }

        createdArtifacts.push(
          await this.persistFileArtifact(run.id, {
            kind,
            filename,
            sourcePath: outputPath,
            contentType: "image/png",
            metadata: {
              sourceArtifactId: outputArtifact.id
            }
          })
        );
      }

      return createdArtifacts;
    } finally {
      await this.cleanupMaterializedFiles(materializedPaths);
    }
  }

  async executeRun(runId: string): Promise<void> {
    if (this.activeRuns.has(runId)) {
      return;
    }
    this.activeRuns.add(runId);

    let providerState: ProviderState | null = null;
    const materializedPaths: string[] = [];

    try {
      const run = await this.jobStore.getRun(runId);
      if (!run) {
        throw new Error(`Run "${runId}" was not found.`);
      }
      const provider = this.providers.get(run.providerId);

      await this.jobStore.updateRun(runId, (current) => ({
        ...current,
        state: "running",
        attempts: current.attempts + 1,
        provider: {
          ...current.provider,
          ...buildProviderSnapshot(provider, providerState),
          status: "running"
        },
        startedAt: current.startedAt || nowIso(),
        updatedAt: nowIso()
      }));

      const activeRun = await this.getRun(runId);
      const preset = getPreset(activeRun.presetId);
      const referenceAsset = await this.jobStore.getAsset(activeRun.referenceAssetId);
      const sourceAsset = await this.jobStore.getAsset(activeRun.sourceVideoAssetId);
      if (!referenceAsset || !sourceAsset) {
        throw new Error(`Run "${runId}" is missing materialized assets.`);
      }

      const [referencePath, sourcePath] = await Promise.all([
        this.materializeLocator(referenceAsset.locator, `reference-${referenceAsset.id}${referenceAsset.extension}`, materializedPaths),
        this.materializeLocator(sourceAsset.locator, `driving-${sourceAsset.id}${sourceAsset.extension}`, materializedPaths)
      ]);

      const submission = await provider.submitRun({
        runId,
        preset,
        referenceAsset,
        sourceAsset,
        sourceVideoPath: sourcePath,
        referenceImagePath: referencePath
      });
      providerState = {
        ...submission.providerState,
        lastPolledAt: null,
        pollCount: 0
      };

      const submitRequestArtifact = await this.persistJsonArtifact(runId, {
        kind: "provider_submit_request",
        filename: `${runId}-provider-submit-request.json`,
        payload: submission.rawRequest
      });
      const submitResponseArtifact = await this.persistJsonArtifact(runId, {
        kind: "provider_submit_response",
        filename: `${runId}-provider-submit-response.json`,
        payload: submission.rawResponse
      });

      await this.jobStore.updateRun(runId, (current) => ({
        ...current,
        provider: buildProviderSnapshot(provider, providerState),
        artifacts: [...current.artifacts, submitRequestArtifact, submitResponseArtifact],
        lineage: {
          ...current.lineage,
          providerPayloads: {
            ...current.lineage.providerPayloads,
            submitRequestArtifactId: submitRequestArtifact.id,
            submitResponseArtifactId: submitResponseArtifact.id
          }
        },
        updatedAt: nowIso()
      }));

      const pollStart = Date.now();
      let pollSequence = 0;

      while (true) {
        if (Date.now() - pollStart >= this.config.providerTimeoutSec * 1000) {
          const cancelPayload = await provider.cancelRun(providerState!).catch(() => null);
          if (cancelPayload) {
            const cancelArtifact = await this.persistJsonArtifact(runId, {
              kind: "provider_cancel_response",
              filename: `${runId}-provider-cancel-response.json`,
              payload: cancelPayload
            });
            await this.jobStore.updateRun(runId, (current) => ({
              ...current,
              artifacts: [...current.artifacts, cancelArtifact],
              lineage: {
                ...current.lineage,
                providerPayloads: {
                  ...current.lineage.providerPayloads,
                  cancelArtifactId: cancelArtifact.id
                }
              },
              updatedAt: nowIso()
            }));
          }
          throw new ProviderError("provider_timeout", `Provider timed out after ${this.config.providerTimeoutSec} seconds.`, {
            providerStatus: providerState?.status || "running",
            retryable: true
          });
        }

        const pollResult = await provider.pollRun(providerState!);
        pollSequence += 1;
        providerState = {
          ...pollResult.providerState,
          pollCount: pollSequence,
          lastPolledAt: nowIso()
        };

        const pollArtifact = await this.persistJsonArtifact(runId, {
          kind: "provider_poll_response",
          filename: `${runId}-provider-poll-${String(pollSequence).padStart(3, "0")}.json`,
          payload: pollResult.rawResponse
        });

        await this.jobStore.updateRun(runId, (current) => ({
          ...current,
          provider: buildProviderSnapshot(provider, providerState),
          artifacts: [...current.artifacts, pollArtifact],
          lineage: {
            ...current.lineage,
            providerPayloads: {
              ...current.lineage.providerPayloads,
              pollArtifactIds: [...current.lineage.providerPayloads.pollArtifactIds, pollArtifact.id]
            }
          },
          updatedAt: nowIso()
        }));

        if (pollResult.terminal) {
          const terminalArtifact = await this.persistJsonArtifact(runId, {
            kind: "provider_terminal_response",
            filename: `${runId}-provider-terminal-response.json`,
            payload: pollResult.rawResponse
          });

          await this.jobStore.updateRun(runId, (current) => ({
            ...current,
            artifacts: [...current.artifacts, terminalArtifact],
            lineage: {
              ...current.lineage,
              providerPayloads: {
                ...current.lineage.providerPayloads,
                terminalArtifactId: terminalArtifact.id
              }
            },
            updatedAt: nowIso()
          }));
          break;
        }

        await delay(this.config.providerPollIntervalMs);
      }

      const terminalFailure = provider.normalizeTerminalState(providerState!);
      if (terminalFailure) {
        throw terminalFailure;
      }

      const providerResult = await provider.collectResult(providerState!, { runId });
      const outputArtifact = await this.persistFileArtifact(runId, {
        kind: "retargeted_video",
        filename: `${runId}.mp4`,
        sourcePath: providerResult.outputPath,
        contentType: "video/mp4",
        metadata: {
          sourceProviderUrl: providerResult.outputUrl
        }
      });
      const { buffer: outputBuffer, bytes: outputBytes } = await this.storageDriver.readBuffer(outputArtifact.locator);
      void outputBytes;
      const outputChecksum = await sha256(outputBuffer);
      const outputMeta = await inspectMedia(providerResult.outputPath);
      const evaluation = await evaluateRun({
        sourceVideoPath: sourcePath,
        referenceImagePath: referencePath,
        outputVideoPath: providerResult.outputPath
      });

      await this.jobStore.updateRun(runId, (current) => ({
        ...current,
        state: "needs_review",
        reviewStatus: current.reviewStatus === "approved" ? "approved" : "pending",
        provider: buildProviderSnapshot(provider, providerState),
        artifacts: current.artifacts.map((artifact) =>
          artifact.id === outputArtifact.id
            ? {
                ...artifact,
                metadata: {
                  ...artifact.metadata,
                  checksum: outputChecksum,
                  sizeBytes: outputMeta.sizeBytes,
                  durationSec: outputMeta.durationSec,
                  width: outputMeta.width,
                  height: outputMeta.height,
                  contentType: "video/mp4"
                }
              }
            : artifact
        ),
        cost: {
          estimatedUsd: providerResult.usage.estimatedCostUsd || 0
        },
        evaluation,
        failure: null,
        failureReason: null,
        lineage: {
          ...current.lineage,
          finalOutput: {
            artifactId: outputArtifact.id,
            checksum: outputChecksum,
            sizeBytes: outputMeta.sizeBytes,
            durationSec: outputMeta.durationSec,
            width: outputMeta.width,
            height: outputMeta.height,
            contentType: "video/mp4",
            sourceProviderUrl: providerResult.outputUrl
          }
        },
        updatedAt: nowIso(),
        completedAt: nowIso()
      }));
    } catch (error) {
      const failure = normalizeReplicateFailure(error, { providerStatus: providerState?.status || null });
      await this.jobStore.updateRun(runId, (current) => ({
        ...current,
        state: "failed",
        provider: {
          ...current.provider,
          status: providerState?.status || "failed",
          runId: providerState?.providerRunId || current.provider?.runId || null,
          modelId: providerState?.modelId || current.provider?.modelId || null,
          completedAt: providerState?.completedAt || nowIso(),
          lastPolledAt: providerState?.lastPolledAt || current.provider?.lastPolledAt || null,
          pollCount: providerState?.pollCount || current.provider?.pollCount || 0
        },
        failure,
        failureReason: failure.message,
        updatedAt: nowIso(),
        completedAt: nowIso()
      }));
    } finally {
      await this.cleanupMaterializedFiles(materializedPaths);
      this.activeRuns.delete(runId);
    }
  }

  async materializeLocator(locator: StorageLocator, filename: string, materializedPaths: string[] = []): Promise<string> {
    if (locator.type === "local") {
      if (!locator.path) {
        throw new Error("Local storage locator is missing a path.");
      }
      return locator.path;
    }
    const { buffer, bytes: readBytes } = await this.storageDriver.readBuffer(locator);
    void readBytes;
    const tempDir = path.join(os.tmpdir(), "avatar-project", "materialized");
    await fs.mkdir(tempDir, { recursive: true });
    const filePath = path.join(tempDir, `${Date.now()}-${filename}`);
    await fs.writeFile(filePath, buffer);
    materializedPaths.push(filePath);
    return filePath;
  }

  async cleanupMaterializedFiles(filePaths: string[]): Promise<void> {
    await Promise.all(filePaths.map((filePath) => fs.rm(filePath, { force: true }).catch(() => {})));
  }

  _buildArtifactRecord({ artifactId, kind, filename, locator, contentType, metadata }: { artifactId: string; kind: ArtifactKind | string; filename: string; locator: StorageLocator; contentType: string; metadata: AnyRecord }): Artifact {
    return {
      id: artifactId,
      kind,
      filename,
      locator,
      contentType,
      createdAt: nowIso(),
      metadata
    };
  }

  async persistJsonArtifact(runId: string, { kind, filename, payload }: { kind: ArtifactKind | string; filename: string; payload: unknown }): Promise<Artifact> {
    const buffer = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return this.persistBufferArtifact(runId, {
      kind,
      filename,
      buffer,
      contentType: "application/json",
      metadata: {}
    });
  }

  async persistFileArtifact(runId: string, { kind, filename, sourcePath, contentType, metadata = {} }: { kind: ArtifactKind | string; filename: string; sourcePath: string; contentType: string; metadata?: AnyRecord }): Promise<Artifact> {
    const artifactId = createId("artifact");
    const { locator, bytes: storedBytes } = await this.storageDriver.putFile(
      `outputs/${runId}/${artifactId}${path.extname(filename)}`,
      sourcePath,
      contentType
    );
    void storedBytes;

    const artifact = this._buildArtifactRecord({ artifactId, kind, filename, locator, contentType, metadata });

    await this.jobStore.updateRun(runId, (current) => ({
      ...current,
      artifacts: [...current.artifacts, artifact],
      updatedAt: nowIso()
    }));

    return artifact;
  }

  async persistBufferArtifact(runId: string, { kind, filename, buffer, contentType, metadata = {} }: { kind: ArtifactKind | string; filename: string; buffer: Buffer; contentType: string; metadata?: AnyRecord }): Promise<Artifact> {
    const artifactId = createId("artifact");
    const { locator, bytes: storedBytes } = await this.storageDriver.putBuffer(
      `outputs/${runId}/${artifactId}${path.extname(filename)}`,
      buffer,
      contentType
    );

    return this._buildArtifactRecord({
      artifactId,
      kind,
      filename,
      locator,
      contentType,
      metadata: { ...metadata, sizeBytes: storedBytes }
    });
  }

  assertAssetMedia(kind: AssetKind, media: MediaInspection): void {
    if (kind === "driving") {
      if (!media.hasVideoStream) {
        throw new Error("Driving media must contain a video stream.");
      }
      if (!media.sizeBytes || !media.width || !media.height) {
        throw new Error("Driving video must have non-zero size and dimensions.");
      }
      if (!media.durationSec) {
        throw new Error("Driving video must have non-zero duration.");
      }
      return;
    }
    if (!media.sizeBytes || !media.width || !media.height) {
      throw new Error("Reference image must have non-zero size and dimensions.");
    }
  }
}
