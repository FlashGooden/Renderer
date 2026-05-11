// @ts-nocheck
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { FileJobStore } from "@avatar/core/job-store.js";
import { createStorageDriver } from "@avatar/core/storage.js";
import { AvatarService } from "@avatar/core/service.js";
import { createRunnerHandler } from "../src/server.js";

const execFileAsync = promisify(execFile);

class FakeHandlerProvider {
  constructor() {
    this.id = "fake-handler-provider";
    this.displayName = "Fake Handler Provider";
    this.modelId = "fake/handler";
  }

  validateRun() {}

  async submitRun(context) {
    this.sourceVideoPath = context.sourceVideoPath;
    return {
      providerRunId: "handler_run_123",
      providerState: {
        providerRunId: "handler_run_123",
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
        id: "handler_run_123",
        status: "starting"
      }
    };
  }

  async pollRun(state) {
    this.pollCount = (this.pollCount || 0) + 1;
    const terminal = this.pollCount > 1;
    return {
      providerState: {
        ...state,
        status: terminal ? "succeeded" : "processing",
        output: terminal ? "https://replicate.delivery/handler-output.mp4" : null,
        completedAt: terminal ? new Date().toISOString() : null
      },
      rawResponse: {
        id: state.providerRunId,
        status: terminal ? "succeeded" : "processing",
        output: terminal ? "https://replicate.delivery/handler-output.mp4" : null
      },
      terminal
    };
  }

  async cancelRun() {
    return null;
  }

  normalizeTerminalState() {
    return null;
  }

  async collectResult(state, { runId }) {
    const outputPath = path.join(os.tmpdir(), "avatar-project", runId, "handler-output.mp4");
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.copyFile(this.sourceVideoPath, outputPath);
    return {
      outputPath,
      outputUrl: state.output,
      usage: {
        estimatedCostUsd: 0.12
      }
    };
  }
}

async function createMediaFixtures(dir) {
  const referencePath = path.join(dir, "reference.png");
  const sourcePath = path.join(dir, "source.mp4");

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
    "2",
    sourcePath
  ]);

  return { referencePath, sourcePath };
}

async function createHarness() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "avatar-runner-handler-"));
  const config = {
    runnerPort: 0,
    runnerUrl: "http://127.0.0.1:0",
    dataDir: path.join(rootDir, ".avatar"),
    storageMode: "local",
    azureBlobBaseUrl: "",
    replicateApiToken: "test-token",
    replicateModel: "bytedance/dreamactor-m2.0",
    providerTimeoutSec: 1,
    providerPollIntervalMs: 5
  };
  const provider = new FakeHandlerProvider();
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
  const jobStore = new FileJobStore(config.dataDir);
  const storageDriver = createStorageDriver(config);
  const service = new AvatarService({ config, jobStore, storageDriver, providers });
  await service.initialize();

  return {
    service,
    storageDriver,
    providers,
    handler: createRunnerHandler({ service, storageDriver, providers })
  };
}

async function invoke(handler, method, url, { headers = {}, body = null } = {}) {
  const request = Readable.from(body ? [body] : []);
  request.method = method;
  request.url = url;
  request.headers = headers;

  let statusCode = null;
  let responseHeaders = {};
  const chunks = [];
  const response = {
    writeHead(code, nextHeaders) {
      statusCode = code;
      responseHeaders = nextHeaders;
    },
    end(chunk = "") {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
    }
  };

  await handler(request, response);

  const buffer = Buffer.concat(chunks);
  const contentType = responseHeaders["content-type"] || "";
  return {
    statusCode,
    headers: responseHeaders,
    buffer,
    text: buffer.toString("utf8"),
    json: buffer.length && contentType.includes("application/json") ? JSON.parse(buffer.toString("utf8")) : null
  };
}

async function waitForRun(handler, runId) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const response = await invoke(handler, "GET", `/runs/${runId}`);
    const run = response.json.run;
    if (!["queued", "running"].includes(run.state)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Run ${runId} did not complete`);
}

test("runner handler supports upload, run, fetch, review, previews, and async provider metadata", async () => {
  const harness = await createHarness();
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "avatar-handler-media-"));
  const { referencePath, sourcePath } = await createMediaFixtures(rootDir);

  const health = await invoke(harness.handler, "GET", "/health");
  assert.equal(health.statusCode, 200);
  assert.equal(health.json.defaultProvider, "replicate-dreamactor");

  const referenceUpload = await invoke(harness.handler, "POST", "/assets", {
    headers: {
      "x-avatar-kind": "reference",
      "x-avatar-filename": path.basename(referencePath)
    },
    body: await fs.readFile(referencePath)
  });
  assert.equal(referenceUpload.statusCode, 201);

  const sourceUpload = await invoke(harness.handler, "POST", "/assets", {
    headers: {
      "x-avatar-kind": "driving",
      "x-avatar-filename": path.basename(sourcePath)
    },
    body: await fs.readFile(sourcePath)
  });
  assert.equal(sourceUpload.statusCode, 201);

  const runResponse = await invoke(harness.handler, "POST", "/runs", {
    headers: {
      "content-type": "application/json"
    },
    body: Buffer.from(
      JSON.stringify({
        providerId: "fake-handler-provider",
        spec: {
          referenceAssetId: referenceUpload.json.asset.id,
          sourceVideoAssetId: sourceUpload.json.asset.id,
          presetId: "preview-720p"
        }
      })
    )
  });
  assert.equal(runResponse.statusCode, 201);

  const run = await waitForRun(harness.handler, runResponse.json.run.id);
  assert.equal(run.state, "needs_review");
  assert.equal(run.provider.runId, "handler_run_123");
  assert.equal(run.lineage.finalOutput.sourceProviderUrl, "https://replicate.delivery/handler-output.mp4");

  const outputArtifact = run.artifacts.find((artifact) => artifact.kind === "retargeted_video");
  const artifactResponse = await invoke(
    harness.handler,
    "GET",
    `/runs/${run.id}/artifacts/${outputArtifact.id}/content`
  );
  assert.equal(artifactResponse.statusCode, 200);
  assert.equal(artifactResponse.buffer.length > 0, true);

  const reviewResponse = await invoke(harness.handler, "POST", `/runs/${run.id}/review`, {
    headers: {
      "content-type": "application/json"
    },
    body: Buffer.from(
      JSON.stringify({
        decision: "approve",
        notes: "usable",
        reviewer: "tester",
        tags: ["usable"],
        criteria: {
          overall: "pass"
        }
      })
    )
  });
  assert.equal(reviewResponse.statusCode, 200);
  assert.equal(reviewResponse.json.run.state, "succeeded");
  assert.equal(reviewResponse.json.run.reviewHistory.length, 1);

  const previewResponse = await invoke(harness.handler, "POST", `/runs/${run.id}/previews`, {
    headers: {
      "content-type": "application/json"
    },
    body: Buffer.from(
      JSON.stringify({
        kinds: ["preview_still", "contact_sheet"]
      })
    )
  });
  assert.equal(previewResponse.statusCode, 200);
  assert.equal(previewResponse.json.artifacts.length, 2);
});
