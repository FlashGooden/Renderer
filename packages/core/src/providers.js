import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureDir } from "./fs-utils.js";
import { contentTypeForExtension, createDataUrl } from "./media.js";

const execFileAsync = promisify(execFile);

const SUCCESS_STATUSES = new Set(["succeeded", "successful"]);
const FAILURE_STATUSES = new Set(["failed", "canceled", "cancelled"]);

export class ProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.details = details;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildReplicateHeaders(apiToken, extraHeaders = {}) {
  return {
    authorization: `Bearer ${apiToken}`,
    "content-type": "application/json",
    prefer: "wait=1",
    ...extraHeaders
  };
}

function parseModelRef(modelRef) {
  const [owner, model] = String(modelRef || "").split("/");
  if (!owner || !model) {
    throw new ProviderError("provider_validation", `Replicate model "${modelRef}" must use owner/model format.`);
  }
  return { owner, model };
}

function createReplicateApiUrl(modelRef) {
  const { owner, model } = parseModelRef(modelRef);
  return `https://api.replicate.com/v1/models/${owner}/${model}/predictions`;
}

function getPresetOptions(preset, providerId) {
  return preset.providers?.[providerId] || {};
}

function isTerminalStatus(status) {
  return SUCCESS_STATUSES.has(status) || FAILURE_STATUSES.has(status);
}

function extractOutputUrl(output) {
  if (!output) {
    return null;
  }
  if (typeof output === "string") {
    return output;
  }
  if (Array.isArray(output)) {
    const first = output.find((value) => typeof value === "string");
    return first || null;
  }
  if (typeof output === "object") {
    if (typeof output.url === "string") {
      return output.url;
    }
    if (typeof output.href === "string") {
      return output.href;
    }
  }
  return null;
}

export function normalizeReplicateFailure(error, context = {}) {
  if (error instanceof ProviderError) {
    return {
      code: error.code,
      message: error.message,
      retryable: Boolean(error.details.retryable),
      providerStatus: error.details.providerStatus || context.providerStatus || null,
      details: error.details
    };
  }

  const message = error?.message || "Provider request failed.";
  return {
    code: "provider_unknown",
    message,
    retryable: false,
    providerStatus: context.providerStatus || null,
    details: {}
  };
}

export class ReplicateDreamActorProvider {
  constructor({
    apiToken,
    modelId = "bytedance/dreamactor-m2.0",
    timeoutSec = 600,
    pollIntervalMs = 2000,
    fetchImpl = fetch
  } = {}) {
    this.id = "replicate-dreamactor";
    this.displayName = "Replicate DreamActor M2.0";
    this.apiToken = apiToken;
    this.modelId = modelId;
    this.timeoutSec = timeoutSec;
    this.pollIntervalMs = pollIntervalMs;
    this.fetchImpl = fetchImpl;
  }

  listCapabilities() {
    return {
      defaultModelId: this.modelId,
      pollIntervalMs: this.pollIntervalMs,
      timeoutSec: this.timeoutSec
    };
  }

  validateRun({ referenceAsset, sourceAsset, preset }) {
    this.assertConfigured();
    this.assertImageAsset(referenceAsset);
    this.assertDrivingAsset(sourceAsset, preset);
  }

  buildPredictionInput({ preset, referenceInput, sourceInput }) {
    const providerOptions = getPresetOptions(preset, this.id);
    return {
      image: referenceInput,
      video: sourceInput,
      cut_first_second: Boolean(providerOptions.cutFirstSecond)
    };
  }

  async submitRun(context) {
    this.assertConfigured();

    const referenceInput = await this.resolveInput(context.referenceAsset, context.referenceImagePath);
    const sourceInput = await this.resolveInput(context.sourceAsset, context.sourceVideoPath);
    const input = this.buildPredictionInput({
      preset: context.preset,
      referenceInput,
      sourceInput
    });
    const requestBody = {
      input
    };

    const response = await this.fetchReplicate(createReplicateApiUrl(this.modelId), {
      method: "POST",
      headers: buildReplicateHeaders(this.apiToken, {
        "Cancel-After": `${this.timeoutSec}s`
      }),
      body: JSON.stringify(requestBody)
    });
    const payload = await response.json();
    this.assertReplicateOk(response, payload);

    return {
      providerRunId: payload.id,
      providerState: this.toProviderState(payload),
      rawRequest: {
        model: this.modelId,
        body: requestBody
      },
      rawResponse: payload
    };
  }

  async pollRun(state) {
    this.assertConfigured();
    const pollUrl = state.pollUrl || state.getUrl;
    if (!pollUrl) {
      throw new ProviderError("provider_unknown", "Replicate prediction is missing a poll URL.");
    }

    const response = await this.fetchReplicate(pollUrl, {
      method: "GET",
      headers: buildReplicateHeaders(this.apiToken)
    });
    const payload = await response.json();
    this.assertReplicateOk(response, payload);

    return {
      providerState: this.toProviderState(payload),
      rawResponse: payload,
      terminal: isTerminalStatus(payload.status)
    };
  }

  async cancelRun(state) {
    if (!state.cancelUrl || !this.apiToken) {
      return null;
    }

    const response = await this.fetchReplicate(state.cancelUrl, {
      method: "POST",
      headers: buildReplicateHeaders(this.apiToken)
    });

    if (response.status === 404) {
      return null;
    }

    const payload = await response.json();
    this.assertReplicateOk(response, payload);
    return payload;
  }

  async collectResult(state, context) {
    const outputUrl = extractOutputUrl(state.output);
    if (!outputUrl) {
      throw new ProviderError("provider_output_missing", "Replicate completed without an output URL.", {
        providerStatus: state.status
      });
    }

    const response = await this.fetchImpl(outputUrl);
    if (!response.ok) {
      throw new ProviderError("provider_download_failed", `Failed to download provider output (${response.status}).`, {
        providerStatus: state.status,
        httpStatus: response.status
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const tmpDir = path.join(os.tmpdir(), "avatar-project", context.runId);
    await ensureDir(tmpDir);
    const outputPath = path.join(tmpDir, `${this.id}-output.mp4`);
    await fs.writeFile(outputPath, buffer);

    return {
      outputPath,
      outputUrl,
      usage: {
        estimatedCostUsd: 0,
        predictTimeSec: Number(state.metrics?.predict_time || 0),
        totalTimeSec: Number(state.metrics?.total_time || 0)
      }
    };
  }

  toProviderState(payload) {
    return {
      providerRunId: payload.id,
      modelId: payload.model || this.modelId,
      status: payload.status || "unknown",
      getUrl: payload.urls?.get || null,
      pollUrl: payload.urls?.get || null,
      cancelUrl: payload.urls?.cancel || null,
      output: payload.output ?? null,
      error: payload.error || null,
      logs: payload.logs || null,
      metrics: payload.metrics || null,
      createdAt: payload.created_at || null,
      startedAt: payload.started_at || null,
      completedAt: payload.completed_at || null
    };
  }

  normalizeTerminalState(state) {
    if (SUCCESS_STATUSES.has(state.status)) {
      return null;
    }
    if (state.status === "canceled" || state.status === "cancelled") {
      return new ProviderError("provider_canceled", "Replicate canceled the prediction.", {
        providerStatus: state.status
      });
    }
    const errorText = String(state.error || "").toLowerCase();
    if (errorText.includes("input") || errorText.includes("dimension") || errorText.includes("duration") || errorText.includes("unsupported")) {
      return new ProviderError("provider_rejected_input", state.error || "Replicate rejected the submitted media.", {
        providerStatus: state.status
      });
    }
    return new ProviderError("provider_run_failed", state.error || "Replicate failed the prediction.", {
      providerStatus: state.status
    });
  }

  async resolveInput(asset, filePath) {
    if (asset.locator?.type === "azure-blob" && asset.locator.url) {
      return asset.locator.url;
    }

    const buffer = await fs.readFile(filePath);
    return createDataUrl(asset.contentType || contentTypeForExtension(asset.extension), buffer);
  }

  assertConfigured() {
    if (!this.apiToken) {
      throw new ProviderError("provider_auth", "AVATAR_REPLICATE_API_TOKEN is required for Replicate runs.");
    }
  }

  assertImageAsset(asset) {
    const withinWidth = asset.media.width >= 480 && asset.media.width <= 1920;
    const withinHeight = asset.media.height >= 480 && asset.media.height <= 1080;
    if (!asset.media.sizeBytes || !asset.media.width || !asset.media.height || !withinWidth || !withinHeight) {
      throw new ProviderError(
        "provider_validation",
        "Reference image dimensions must be between 480x480 and 1920x1080 with non-zero size."
      );
    }
  }

  assertDrivingAsset(asset, preset) {
    const maxDurationSec = Math.min(preset.maxDurationSec, 30);
    const withinWidth = asset.media.width >= 200 && asset.media.width <= 2048;
    const withinHeight = asset.media.height >= 200 && asset.media.height <= 1440;
    if (!asset.media.hasVideoStream) {
      throw new ProviderError("provider_validation", "Driving media must contain a video stream.");
    }
    if (!asset.media.sizeBytes || !asset.media.durationSec) {
      throw new ProviderError("provider_validation", "Driving video must have non-zero size and duration.");
    }
    if (!withinWidth || !withinHeight) {
      throw new ProviderError("provider_validation", "Driving video dimensions must be between 200x200 and 2048x1440.");
    }
    if (asset.media.durationSec > maxDurationSec) {
      throw new ProviderError(
        "provider_validation",
        `Driving video exceeds the preset limit (${asset.media.durationSec.toFixed(2)}s > ${maxDurationSec}s).`
      );
    }
  }

  async fetchReplicate(url, init) {
    try {
      return await this.fetchImpl(url, init);
    } catch (error) {
      throw new ProviderError("provider_unavailable", `Replicate request failed: ${error.message}`, {
        retryable: true
      });
    }
  }

  assertReplicateOk(response, payload) {
    if (response.ok) {
      return;
    }

    const detail = payload?.detail || payload?.error || `Replicate request failed with status ${response.status}.`;
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError("provider_auth", detail, { httpStatus: response.status });
    }
    if (response.status === 429) {
      throw new ProviderError("provider_rate_limited", detail, {
        httpStatus: response.status,
        retryable: true
      });
    }
    if (response.status === 400 || response.status === 422) {
      throw new ProviderError("provider_validation", detail, { httpStatus: response.status });
    }
    if (response.status >= 500) {
      throw new ProviderError("provider_unavailable", detail, {
        httpStatus: response.status,
        retryable: true
      });
    }
    throw new ProviderError("provider_unknown", detail, { httpStatus: response.status });
  }
}

class AsyncMockProvider {
  constructor(providerId = "mock-provider", fetchImpl = fetch) {
    this.id = providerId;
    this.displayName = "Mock Retargeting Provider";
    this.fetchImpl = fetchImpl;
    this.modelId = "mock/model";
    this.pollIntervalMs = 10;
    this.timeoutSec = 5;
  }

  listCapabilities() {
    return {
      defaultModelId: this.modelId,
      pollIntervalMs: this.pollIntervalMs,
      timeoutSec: this.timeoutSec
    };
  }

  validateRun() {}

  buildPredictionInput({ preset }) {
    return {
      width: preset.width,
      height: preset.height
    };
  }

  async submitRun(context) {
    return {
      providerRunId: `mock-${context.runId}`,
      providerState: {
        providerRunId: `mock-${context.runId}`,
        modelId: this.modelId,
        status: "starting",
        createdAt: new Date().toISOString(),
        mockContext: {
          sourceVideoPath: context.sourceVideoPath,
          preset: context.preset
        }
      },
      rawRequest: {
        input: this.buildPredictionInput({ preset: context.preset })
      },
      rawResponse: {
        id: `mock-${context.runId}`,
        status: "starting"
      }
    };
  }

  async pollRun(state) {
    await sleep(this.pollIntervalMs);
    return {
      providerState: {
        ...state,
        status: "succeeded",
        completedAt: new Date().toISOString(),
        output: "mock://output"
      },
      rawResponse: {
        id: state.providerRunId,
        status: "succeeded"
      },
      terminal: true
    };
  }

  async cancelRun() {
    return null;
  }

  async collectResult(state, context) {
    const { sourceVideoPath, preset } = state.mockContext;
    const tmpDir = path.join(os.tmpdir(), "avatar-project", context.runId);
    await ensureDir(tmpDir);
    const outputPath = path.join(tmpDir, `${this.id}-output.mp4`);

    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      sourceVideoPath,
      "-an",
      "-vf",
      [
        `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease`,
        `pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2`
      ].join(","),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outputPath
    ]);

    const stat = await fs.stat(outputPath);
    return {
      outputPath,
      outputUrl: null,
      usage: {
        estimatedCostUsd: 0.01,
        outputSizeBytes: stat.size
      }
    };
  }

  normalizeTerminalState() {
    return null;
  }
}

export function createProviderRegistry(config = {}, options = {}) {
  const providers = new Map();
  const replicateProvider = new ReplicateDreamActorProvider({
    apiToken: config.replicateApiToken,
    modelId: config.replicateModel,
    timeoutSec: config.providerTimeoutSec,
    pollIntervalMs: config.providerPollIntervalMs,
    fetchImpl: options.fetchImpl || fetch
  });

  providers.set(replicateProvider.id, replicateProvider);

  if (options.includeMocks) {
    const mockProvider = new AsyncMockProvider(options.mockProviderId || "mock-provider", options.fetchImpl || fetch);
    providers.set(mockProvider.id, mockProvider);
  }

  for (const provider of options.extraProviders || []) {
    providers.set(provider.id, provider);
  }

  return {
    get(providerId) {
      const provider = providers.get(providerId);
      if (!provider) {
        throw new Error(`Unknown provider "${providerId}". Available providers: ${[...providers.keys()].join(", ")}`);
      }
      return provider;
    },
    list() {
      return [...providers.keys()];
    }
  };
}
