import path from "node:path";
import { readJson } from "./fs-utils.js";

export async function loadProjectConfig(cwd = process.cwd(), env = process.env) {
  const configPath = path.join(cwd, "avatar.config.json");
  const fileConfig = (await readJson(configPath, {})) || {};

  return {
    runnerUrl: env.AVATAR_RUNNER_URL || fileConfig.runnerUrl || "http://127.0.0.1:4010",
    runnerPort: Number(env.AVATAR_RUNNER_PORT || fileConfig.runnerPort || 4010),
    dataDir: path.resolve(cwd, env.AVATAR_DATA_DIR || fileConfig.dataDir || ".avatar"),
    storageMode: env.AVATAR_STORAGE_MODE || fileConfig.storageMode || "local",
    azureBlobBaseUrl: env.AVATAR_AZURE_BLOB_BASE_URL || fileConfig.azureBlobBaseUrl || ""
  };
}

