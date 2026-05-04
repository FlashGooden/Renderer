import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureDir } from "./fs-utils.js";
import { inspectMedia } from "./media.js";

const execFileAsync = promisify(execFile);

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

async function extractFirstFrame(videoPath, outputPath) {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    outputPath
  ]);
}

async function computeSsimScore(inputA, inputB) {
  const { stderr } = await execFileAsync("ffmpeg", [
    "-i",
    inputA,
    "-i",
    inputB,
    "-lavfi",
    "ssim",
    "-f",
    "null",
    "-"
  ]);

  const match = stderr.match(/All:([0-9.]+)/);
  return match ? clamp(Number(match[1])) : 0;
}

async function computeSceneChangeRate(videoPath, durationSec) {
  if (!durationSec) {
    return 0;
  }

  const { stderr } = await execFileAsync("ffmpeg", [
    "-i",
    videoPath,
    "-filter:v",
    "select='gt(scene,0.4)',showinfo",
    "-f",
    "null",
    "-"
  ]);

  const matches = stderr.match(/showinfo/g) || [];
  return matches.length / durationSec;
}

export async function evaluateRun({ sourceVideoPath, referenceImagePath, outputVideoPath }) {
  const [sourceMeta, outputMeta] = await Promise.all([
    inspectMedia(sourceVideoPath),
    inspectMedia(outputVideoPath)
  ]);

  const frameDir = path.join(os.tmpdir(), "avatar-project", "evaluation");
  await ensureDir(frameDir);
  const firstFramePath = path.join(frameDir, `frame-${Date.now()}.png`);

  await extractFirstFrame(outputVideoPath, firstFramePath);

  const [identityScore, motionScore, sceneChangeRate] = await Promise.all([
    computeSsimScore(referenceImagePath, firstFramePath).catch(() => 0),
    computeSsimScore(sourceVideoPath, outputVideoPath).catch(() => 0),
    computeSceneChangeRate(outputVideoPath, outputMeta.durationSec).catch(() => 0)
  ]);

  await fs.rm(firstFramePath, { force: true });

  const durationDeltaSec = Math.abs(sourceMeta.durationSec - outputMeta.durationSec);
  const outputValid = outputMeta.sizeBytes > 0 && outputMeta.durationSec > 0;
  const flickerScore = clamp(1 - sceneChangeRate / 5);

  const flags = [];
  if (!outputValid) {
    flags.push("broken_output");
  }
  if (durationDeltaSec > 0.35) {
    flags.push("duration_mismatch");
  }
  if (sceneChangeRate > 3) {
    flags.push("possible_flicker");
  }
  if (identityScore < 0.35) {
    flags.push("low_identity_similarity");
  }
  if (motionScore < 0.75) {
    flags.push("low_motion_similarity");
  }

  const overallScore = clamp((identityScore + motionScore + flickerScore) / 3);

  return {
    outputValid,
    durationDeltaSec,
    sceneChangeRate,
    identityScore,
    motionScore,
    flickerScore,
    overallScore,
    flags
  };
}

