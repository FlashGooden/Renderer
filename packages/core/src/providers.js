import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureDir } from "./fs-utils.js";

const execFileAsync = promisify(execFile);

class BaseMockProvider {
  constructor(providerId, variant) {
    this.providerId = providerId;
    this.variant = variant;
  }

  async execute(context) {
    const { sourceVideoPath, preset, runId } = context;
    const tmpDir = path.join(os.tmpdir(), "avatar-project", runId);
    await ensureDir(tmpDir);
    const outputPath = path.join(tmpDir, `${this.providerId}-output.mp4`);

    const videoFilters = [
      `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease`,
      `pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2`
    ];

    if (this.variant === "fallback") {
      videoFilters.push("eq=saturation=0.95:contrast=1.02");
    }

    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      sourceVideoPath,
      "-an",
      "-vf",
      videoFilters.join(","),
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
      usage: {
        estimatedCostUsd: this.variant === "fallback" ? 0.018 : 0.027,
        outputSizeBytes: stat.size
      }
    };
  }
}

export function createProviderRegistry() {
  const providers = new Map([
    ["mock-primary", new BaseMockProvider("mock-primary", "primary")],
    ["mock-fallback", new BaseMockProvider("mock-fallback", "fallback")]
  ]);

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

