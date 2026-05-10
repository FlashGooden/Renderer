import path from "node:path";
import { readJson } from "./fs-utils.js";
import type { AnyRecord, ProjectConfig } from "./types.js";

export async function loadProjectConfig(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): Promise<ProjectConfig> {
  const configPath = path.join(cwd, "avatar.config.json");
  const fileConfig = ((await readJson<AnyRecord>(configPath, {})) || {}) as AnyRecord;

  return {
    runnerUrl: env.AVATAR_RUNNER_URL || fileConfig.runnerUrl || "http://127.0.0.1:4010",
    runnerPort: Number(env.AVATAR_RUNNER_PORT || fileConfig.runnerPort || 4010),
    dataDir: path.resolve(cwd, env.AVATAR_DATA_DIR || fileConfig.dataDir || ".avatar"),
    storageMode: env.AVATAR_STORAGE_MODE || fileConfig.storageMode || "local",
    azureBlobBaseUrl: env.AVATAR_AZURE_BLOB_BASE_URL || fileConfig.azureBlobBaseUrl || "",
    replicateApiToken: env.AVATAR_REPLICATE_API_TOKEN || fileConfig.replicateApiToken || "",
    replicateModel: env.AVATAR_REPLICATE_MODEL || fileConfig.replicateModel || "bytedance/dreamactor-m2.0",
    providerTimeoutSec: Number(env.AVATAR_PROVIDER_TIMEOUT_SEC || fileConfig.providerTimeoutSec || 600),
    providerPollIntervalMs: Number(env.AVATAR_PROVIDER_POLL_INTERVAL_MS || fileConfig.providerPollIntervalMs || 2000)
  };
}
