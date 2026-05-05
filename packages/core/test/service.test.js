import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FileJobStore } from "../src/job-store.js";
import { createStorageDriver } from "../src/storage.js";
import { AvatarService } from "../src/service.js";
import { createProviderRegistry, ProviderError } from "../src/providers.js";

const execFileAsync = promisify(execFile);

class FakeSuccessProvider {
  constructor() {
    this.id = "fake-success";
    this.displayName = "Fake Success Provider";
    this.modelId = "fake/success";
  }

  validateRun() {}

  async submitRun(context) {
    this.sourceVideoPath = context.sourceVideoPath;
    return {
      providerRunId: "provider_success_123",
      providerState: {
        providerRunId: "provider_success_123",
        modelId: this.modelId,
        status: "starting",
        createdAt: new Date().toISOString()
      },
      rawRequest: {
        input: {
          presetId: context.preset.id
        }
      },
      rawResponse: {
        id: "provider_success_123",
        status: "starting"
      }
    };
  }

  async pollRun(state) {
    this.pollCount = (this.pollCount || 0) + 1;
    if (this.pollCount === 1) {
      return {
        providerState: {
          ...state,
          status: "processing",
          startedAt: new Date().toISOString()
        },
        rawResponse: {
          id: state.providerRunId,
          status: "processing"
        },
        terminal: false
      };
    }

    return {
      providerState: {
        ...state,
        status: "succeeded",
        completedAt: new Date().toISOString(),
        output: "https://replicate.delivery/fake-output.mp4",
        metrics: {
          predict_time: 3.2,
          total_time: 5.1
        }
      },
      rawResponse: {
        id: state.providerRunId,
        status: "succeeded",
        output: "https://replicate.delivery/fake-output.mp4"
      },
      terminal: true
    };
  }

  async cancelRun() {
    return null;
  }

  normalizeTerminalState() {
    return null;
  }

  async collectResult(state, { runId }) {
    const outputPath = path.join(os.tmpdir(), "avatar-project", runId, "fake-output.mp4");
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.copyFile(this.sourceVideoPath, outputPath);
    return {
      outputPath,
      outputUrl: state.output,
      usage: {
        estimatedCostUsd: 0.42
      }
    };
  }
}

class FakeTimeoutProvider {
  constructor() {
    this.id = "fake-timeout";
    this.displayName = "Fake Timeout Provider";
    this.modelId = "fake/timeout";
  }

  validateRun() {}

  async submitRun() {
    return {
      providerRunId: "provider_timeout_123",
      providerState: {
        providerRunId: "provider_timeout_123",
        modelId: this.modelId,
        status: "starting",
        createdAt: new Date().toISOString()
      },
      rawRequest: {
        input: {}
      },
      rawResponse: {
        id: "provider_timeout_123",
        status: "starting"
      }
    };
  }

  async pollRun(state) {
    return {
      providerState: {
        ...state,
        status: "processing",
        startedAt: state.startedAt || new Date().toISOString()
      },
      rawResponse: {
        id: state.providerRunId,
        status: "processing"
      },
      terminal: false
    };
  }

  async cancelRun() {
    return {
      id: "provider_timeout_123",
      status: "cancelled"
    };
  }

  normalizeTerminalState() {
    return null;
  }

  async collectResult() {
    throw new Error("collectResult should not run for timeout paths");
  }
}

class RemoteMemoryStorageDriver {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.buffers = new Map();
  }

  async initialize() {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  async putBuffer(relativePath, buffer) {
    this.buffers.set(relativePath, Buffer.from(buffer));
    return {
      type: "azure-blob",
      url: `https://example.invalid/${relativePath}`,
      key: relativePath
    };
  }

  async putFile(relativePath, sourcePath) {
    const buffer = await fs.readFile(sourcePath);
    return this.putBuffer(relativePath, buffer);
  }

  async readBuffer(locator) {
    return Buffer.from(this.buffers.get(locator.key));
  }
}

async function createMediaFixtures(dir, options = {}) {
  const referencePath = path.join(dir, "reference.png");
  const sourcePath = path.join(dir, options.audioOnly ? "source-audio.mp4" : "source.mp4");
  const referenceSize = options.referenceSize || "512x512";
  const videoSize = options.videoSize || "640x360";
  const durationSec = options.durationSec || 2;

  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=salmon:s=${referenceSize}:d=1`,
    "-frames:v",
    "1",
    referencePath
  ]);

  if (options.audioOnly) {
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=880:duration=${durationSec}`,
      "-c:a",
      "aac",
      sourcePath
    ]);
  } else {
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc=size=${videoSize}:rate=24`,
      "-t",
      String(durationSec),
      sourcePath
    ]);
  }

  return { referencePath, sourcePath };
}

async function createTestService({ providers, configOverrides = {}, storageDriver = null }) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "avatar-service-"));
  const config = {
    runnerPort: 0,
    runnerUrl: "http://127.0.0.1:0",
    dataDir: path.join(rootDir, ".avatar"),
    storageMode: "local",
    azureBlobBaseUrl: "",
    replicateApiToken: "test-token",
    replicateModel: "bytedance/dreamactor-m2.0",
    providerTimeoutSec: 1,
    providerPollIntervalMs: 5,
    ...configOverrides
  };
  const jobStore = new FileJobStore(config.dataDir);
  const resolvedStorageDriver = storageDriver || createStorageDriver(config);
  const service = new AvatarService({ config, jobStore, storageDriver: resolvedStorageDriver, providers });
  await service.initialize();
  return { rootDir, config, service, storageDriver: resolvedStorageDriver };
}

async function uploadAsset(service, filePath, kind) {
  const buffer = await fs.readFile(filePath);
  return service.registerAsset({
    kind,
    filename: path.basename(filePath),
    buffer
  });
}

async function waitForTerminalRun(service, runId, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = await service.getRun(runId);
    if (!["queued", "running"].includes(run.state)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Run ${runId} did not complete within ${timeoutMs}ms`);
}

test("AvatarService persists provider lineage and final output metadata for async runs", async () => {
  const provider = new FakeSuccessProvider();
  const providers = {
    get(providerId) {
      if (providerId !== provider.id) {
        throw new Error(`Unknown provider ${providerId}`);
      }
      return provider;
    },
    list() {
      return [provider.id];
    }
  };
  const { rootDir, service } = await createTestService({ providers });
  const { referencePath, sourcePath } = await createMediaFixtures(rootDir);
  const referenceAsset = await uploadAsset(service, referencePath, "reference");
  const sourceAsset = await uploadAsset(service, sourcePath, "driving");

  const run = await service.createRun({
    providerId: provider.id,
    spec: {
      referenceAssetId: referenceAsset.id,
      sourceVideoAssetId: sourceAsset.id,
      presetId: "preview-720p"
    }
  });

  const completed = await waitForTerminalRun(service, run.id);
  assert.equal(completed.state, "needs_review");
  assert.equal(completed.provider.runId, "provider_success_123");
  assert.equal(completed.provider.status, "succeeded");
  assert.equal(completed.lineage.providerPayloads.submitRequestArtifactId !== null, true);
  assert.equal(completed.lineage.providerPayloads.submitResponseArtifactId !== null, true);
  assert.equal(completed.lineage.providerPayloads.pollArtifactIds.length >= 2, true);
  assert.equal(completed.lineage.providerPayloads.terminalArtifactId !== null, true);
  assert.equal(completed.lineage.finalOutput.contentType, "video/mp4");
  assert.equal(completed.lineage.finalOutput.sourceProviderUrl, "https://replicate.delivery/fake-output.mp4");
  assert.equal(completed.lineage.finalOutput.durationSec > 0, true);
  assert.equal(completed.cost.estimatedUsd, 0.42);
  assert.equal(completed.evaluation.outputValid, true);

  const outputArtifact = completed.artifacts.find((artifact) => artifact.kind === "retargeted_video");
  assert.equal(Boolean(outputArtifact), true);
  assert.equal(outputArtifact.metadata.width > 0, true);
  assert.equal(outputArtifact.metadata.height > 0, true);
  assert.equal(typeof outputArtifact.metadata.checksum, "string");
});

test("AvatarService records timeout failures and cancel lineage", async () => {
  const provider = new FakeTimeoutProvider();
  const providers = {
    get(providerId) {
      if (providerId !== provider.id) {
        throw new Error(`Unknown provider ${providerId}`);
      }
      return provider;
    },
    list() {
      return [provider.id];
    }
  };
  const { rootDir, service } = await createTestService({
    providers,
    configOverrides: {
      providerTimeoutSec: 0.05,
      providerPollIntervalMs: 5
    }
  });
  const { referencePath, sourcePath } = await createMediaFixtures(rootDir);
  const referenceAsset = await uploadAsset(service, referencePath, "reference");
  const sourceAsset = await uploadAsset(service, sourcePath, "driving");

  const run = await service.createRun({
    providerId: provider.id,
    spec: {
      referenceAssetId: referenceAsset.id,
      sourceVideoAssetId: sourceAsset.id,
      presetId: "preview-720p"
    }
  });

  const completed = await waitForTerminalRun(service, run.id);
  assert.equal(completed.state, "failed");
  assert.equal(completed.failure.code, "provider_timeout");
  assert.equal(completed.lineage.providerPayloads.cancelArtifactId !== null, true);
});

test("AvatarService cleans up materialized temp media for remote locators", async () => {
  const provider = new FakeSuccessProvider();
  const providers = {
    get(providerId) {
      if (providerId !== provider.id) {
        throw new Error(`Unknown provider ${providerId}`);
      }
      return provider;
    },
    list() {
      return [provider.id];
    }
  };
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "avatar-remote-storage-"));
  const remoteStorageDriver = new RemoteMemoryStorageDriver(tempDir);
  const { rootDir, service } = await createTestService({
    providers,
    storageDriver: remoteStorageDriver
  });
  const { referencePath, sourcePath } = await createMediaFixtures(rootDir);
  const referenceAsset = await uploadAsset(service, referencePath, "reference");
  const sourceAsset = await uploadAsset(service, sourcePath, "driving");

  const run = await service.createRun({
    providerId: provider.id,
    spec: {
      referenceAssetId: referenceAsset.id,
      sourceVideoAssetId: sourceAsset.id,
      presetId: "preview-720p"
    }
  });

  const completed = await waitForTerminalRun(service, run.id);
  assert.equal(completed.state, "needs_review");

  const materializedDir = path.join(os.tmpdir(), "avatar-project", "materialized");
  const remainingFiles = await fs.readdir(materializedDir).catch(() => []);
  const leakedFiles = remainingFiles.filter(
    (name) => name.includes(referenceAsset.id) || name.includes(sourceAsset.id)
  );
  assert.deepEqual(leakedFiles, []);
});

test("AvatarService validates Replicate provider constraints at run creation", async () => {
  const providers = createProviderRegistry({
    replicateApiToken: "test-token",
    replicateModel: "bytedance/dreamactor-m2.0",
    providerTimeoutSec: 600,
    providerPollIntervalMs: 5
  });
  const { rootDir, service } = await createTestService({ providers });
  const { referencePath, sourcePath } = await createMediaFixtures(rootDir, {
    referenceSize: "320x240",
    durationSec: 12
  });
  const referenceAsset = await uploadAsset(service, referencePath, "reference");
  const sourceAsset = await uploadAsset(service, sourcePath, "driving");

  await assert.rejects(
    () =>
      service.createRun({
        providerId: "replicate-dreamactor",
        spec: {
          referenceAssetId: referenceAsset.id,
          sourceVideoAssetId: sourceAsset.id,
          presetId: "preview-720p"
        }
      }),
    (error) => error instanceof ProviderError && error.code === "provider_validation"
  );
});

test("AvatarService rejects unsupported edge-case media at upload time", async () => {
  const providers = createProviderRegistry({
    replicateApiToken: "test-token",
    replicateModel: "bytedance/dreamactor-m2.0",
    providerTimeoutSec: 600,
    providerPollIntervalMs: 5
  });
  const { rootDir, service } = await createTestService({ providers });
  const { sourcePath } = await createMediaFixtures(rootDir, {
    audioOnly: true
  });

  await assert.rejects(
    () => uploadAsset(service, sourcePath, "driving"),
    /Driving media must contain a video stream/
  );

  const webpPath = path.join(rootDir, "reference.webp");
  await fs.writeFile(webpPath, "not-a-real-webp");
  await assert.rejects(
    () => uploadAsset(service, webpPath, "reference"),
    /Reference images must use one of/
  );
});
