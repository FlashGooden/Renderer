import path from "node:path";
import { readJson } from "./fs-utils.js";
import type { AnyRecord, ProjectConfig } from "./types.js";

function numberConfig(envValue: string | undefined, fileValue: unknown, fallback: number): number {
  const value = envValue ?? fileValue;
  return value === undefined || value === null || value === "" ? fallback : Number(value);
}

export async function loadProjectConfig(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): Promise<ProjectConfig> {
  const configPath = path.join(cwd, "avatar.config.json");
  const fileConfig = ((await readJson<AnyRecord>(configPath, {})) || {}) as AnyRecord;
  const providerTimeoutSec = numberConfig(env.AVATAR_PROVIDER_TIMEOUT_SEC, fileConfig.providerTimeoutSec, 600);

  return {
    runnerUrl: env.AVATAR_RUNNER_URL || fileConfig.runnerUrl || "http://127.0.0.1:4010",
    runnerPort: numberConfig(env.AVATAR_RUNNER_PORT, fileConfig.runnerPort, 4010),
    dataDir: path.resolve(cwd, env.AVATAR_DATA_DIR || fileConfig.dataDir || ".avatar"),
    storageMode: env.AVATAR_STORAGE_MODE || fileConfig.storageMode || "local",
    azureBlobBaseUrl: env.AVATAR_AZURE_BLOB_BASE_URL || fileConfig.azureBlobBaseUrl || "",
    replicateApiToken: env.AVATAR_REPLICATE_API_TOKEN || fileConfig.replicateApiToken || "",
    replicateModel: env.AVATAR_REPLICATE_MODEL || fileConfig.replicateModel || "bytedance/dreamactor-m2.0",
    providerTimeoutSec,
    providerPollIntervalMs: numberConfig(env.AVATAR_PROVIDER_POLL_INTERVAL_MS, fileConfig.providerPollIntervalMs, 2000),
    queuePollIntervalMs: numberConfig(env.AVATAR_QUEUE_POLL_INTERVAL_MS, fileConfig.queuePollIntervalMs, 500),
    queueMaxConcurrent: numberConfig(env.AVATAR_QUEUE_MAX_CONCURRENT, fileConfig.queueMaxConcurrent, 2),
    staleRunThresholdMs: numberConfig(
      env.AVATAR_STALE_RUN_THRESHOLD_MS,
      fileConfig.staleRunThresholdMs,
      providerTimeoutSec * 2000
    ),
    staleRunSweepIntervalMs: numberConfig(
      env.AVATAR_STALE_RUN_SWEEP_INTERVAL_MS,
      fileConfig.staleRunSweepIntervalMs,
      60000
    ),
    tempFileMaxAgeSec: numberConfig(env.AVATAR_TEMP_FILE_MAX_AGE_SEC, fileConfig.tempFileMaxAgeSec, 3600),
    artifactRetentionDays: numberConfig(env.AVATAR_ARTIFACT_RETENTION_DAYS, fileConfig.artifactRetentionDays, 30),
    videoRetentionDays: numberConfig(env.AVATAR_VIDEO_RETENTION_DAYS, fileConfig.videoRetentionDays, 90),
    metadataRetentionDays: numberConfig(env.AVATAR_METADATA_RETENTION_DAYS, fileConfig.metadataRetentionDays, 180),
    replicateCostPerSecondUsd: numberConfig(
      env.AVATAR_REPLICATE_COST_PER_SECOND_USD,
      fileConfig.replicateCostPerSecondUsd,
      0.00055
    ),
    azureBlobWriteUsdPerGb: numberConfig(
      env.AVATAR_AZURE_BLOB_WRITE_USD_PER_GB,
      fileConfig.azureBlobWriteUsdPerGb,
      0
    ),
    azureBlobReadUsdPerGb: numberConfig(
      env.AVATAR_AZURE_BLOB_READ_USD_PER_GB,
      fileConfig.azureBlobReadUsdPerGb,
      0
    ),
    computeUsdPerMs: numberConfig(env.AVATAR_COMPUTE_USD_PER_MS, fileConfig.computeUsdPerMs, 0)
  };
}
