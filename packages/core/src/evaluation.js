import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inspectMedia } from "./media.js";

const execFileAsync = promisify(execFile);

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function buildResult({
  outputValid,
  decodeSuccessful,
  durationDeltaSec,
  frameRateDelta,
  sceneChangeRate,
  identityScore,
  identityFrameScores,
  identitySampleTimesSec,
  motionScore,
  motionSimilarityScore,
  motionSampleTimesSec,
  freezeRisk,
  sourceMotionEnergy,
  outputMotionEnergy,
  stabilityScore,
  excessMotionEnergy,
  corruptionScore,
  blackFrameRatio,
  hasVideoStream,
  flags
}) {
  const overallScore = clamp(
    identityScore * 0.3 + motionScore * 0.3 + stabilityScore * 0.2 + corruptionScore * 0.2
  );

  return {
    outputValid,
    decodeSuccessful,
    hasVideoStream,
    durationDeltaSec: round(durationDeltaSec),
    frameRateDelta: round(frameRateDelta),
    sceneChangeRate: round(sceneChangeRate),
    identityRetention: {
      score: round(identityScore),
      sampledFrameScores: identityFrameScores.map(round),
      sampledFrameTimesSec: identitySampleTimesSec.map(round)
    },
    motionFidelity: {
      score: round(motionScore),
      sampledSimilarityScore: round(motionSimilarityScore),
      sampledFrameTimesSec: motionSampleTimesSec.map(round),
      freezeRisk: round(freezeRisk),
      sourceMotionEnergy: round(sourceMotionEnergy),
      outputMotionEnergy: round(outputMotionEnergy),
      durationDeltaSec: round(durationDeltaSec),
      frameRateDelta: round(frameRateDelta)
    },
    temporalStability: {
      score: round(stabilityScore),
      excessMotionEnergy: round(excessMotionEnergy),
      sourceMotionEnergy: round(sourceMotionEnergy),
      outputMotionEnergy: round(outputMotionEnergy),
      sceneChangeRate: round(sceneChangeRate)
    },
    corruption: {
      score: round(corruptionScore),
      decodeSuccessful,
      hasVideoStream,
      blackFrameRatio: round(blackFrameRatio),
      severeDurationMismatch: durationDeltaSec > 0.75,
      severeFrameRateMismatch: frameRateDelta > 8
    },
    identityScore: round(identityScore),
    motionScore: round(motionScore),
    stabilityScore: round(stabilityScore),
    corruptionScore: round(corruptionScore),
    flickerScore: round(stabilityScore),
    overallScore: round(overallScore),
    flags
  };
}

function sampleTimes(durationSec, count = 5) {
  const effectiveDuration = Math.max(durationSec, 0.1);
  if (count <= 1 || effectiveDuration <= 0.2) {
    return [0];
  }

  const start = Math.min(0.05, effectiveDuration * 0.1);
  const end = Math.max(start, effectiveDuration - Math.min(0.05, effectiveDuration * 0.1));
  if (Math.abs(end - start) < 0.001) {
    return [start];
  }

  return Array.from({ length: count }, (_, index) => start + ((end - start) * index) / (count - 1));
}

async function extractFrameAtTime(videoPath, timeSec, outputPath) {
  await execFileAsync("ffmpeg", [
    "-y",
    "-ss",
    String(Math.max(timeSec, 0)),
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
    "-filter_complex",
    "[0:v]scale=256:256:force_original_aspect_ratio=decrease,pad=256:256:(ow-iw)/2:(oh-ih)/2,setsar=1[a];[1:v]scale=256:256:force_original_aspect_ratio=decrease,pad=256:256:(ow-iw)/2:(oh-ih)/2,setsar=1[b];[a][b]ssim",
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

async function probeDecode(videoPath) {
  try {
    const { stderr } = await execFileAsync("ffmpeg", [
      "-v",
      "error",
      "-i",
      videoPath,
      "-map",
      "0:v:0",
      "-f",
      "null",
      "-"
    ]);
    return {
      success: !String(stderr || "").trim()
    };
  } catch {
    return {
      success: false
    };
  }
}

async function computeFrameBrightness(imagePath) {
  const { stdout } = await execFileAsync(
    "ffmpeg",
    ["-i", imagePath, "-vf", "scale=1:1", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { encoding: "buffer", maxBuffer: 1024 * 1024 }
  );

  if (!stdout || !stdout.length) {
    return 0;
  }
  return stdout[0] / 255;
}

async function extractFrames(videoPath, timesSec, frameDir, prefix) {
  const frames = [];
  for (let index = 0; index < timesSec.length; index += 1) {
    const timeSec = timesSec[index];
    const framePath = path.join(frameDir, `${prefix}-${index}.png`);
    await extractFrameAtTime(videoPath, timeSec, framePath);
    frames.push(framePath);
  }
  return frames;
}

async function computeAdjacentMotionEnergy(framePaths) {
  if (framePaths.length < 2) {
    return 0;
  }
  const ssims = [];
  for (let index = 0; index < framePaths.length - 1; index += 1) {
    ssims.push(await computeSsimScore(framePaths[index], framePaths[index + 1]).catch(() => 0));
  }
  return average(ssims.map((value) => 1 - value));
}

async function computeBrightnessRatio(framePaths) {
  if (!framePaths.length) {
    return 0;
  }
  const brightnesses = [];
  for (const framePath of framePaths) {
    brightnesses.push(await computeFrameBrightness(framePath).catch(() => 0));
  }
  const darkCount = brightnesses.filter((value) => value < 0.03).length;
  return darkCount / framePaths.length;
}

export async function evaluateRun({ sourceVideoPath, referenceImagePath, outputVideoPath }) {
  const sourceMeta = await inspectMedia(sourceVideoPath);
  let outputMeta;
  try {
    outputMeta = await inspectMedia(outputVideoPath);
  } catch {
    return buildResult({
      outputValid: false,
      decodeSuccessful: false,
      durationDeltaSec: sourceMeta.durationSec,
      frameRateDelta: sourceMeta.frameRate,
      sceneChangeRate: 0,
      identityScore: 0,
      identityFrameScores: [],
      identitySampleTimesSec: [],
      motionScore: 0,
      motionSimilarityScore: 0,
      motionSampleTimesSec: [],
      freezeRisk: 1,
      sourceMotionEnergy: 0,
      outputMotionEnergy: 0,
      stabilityScore: 0,
      excessMotionEnergy: 0,
      corruptionScore: 0,
      blackFrameRatio: 0,
      hasVideoStream: false,
      flags: ["broken_output", "decode_failure", "corruption_risk"]
    });
  }

  const frameDir = await fs.mkdtemp(path.join(os.tmpdir(), "avatar-eval-"));
  try {
    const identityTimes = sampleTimes(outputMeta.durationSec, 5);
    const motionDuration = Math.min(sourceMeta.durationSec || 0, outputMeta.durationSec || 0);
    const motionTimes = sampleTimes(motionDuration, 5);
    const outputFrames = await extractFrames(outputVideoPath, identityTimes, frameDir, "output");
    const sourceFrames = await extractFrames(sourceVideoPath, motionTimes, frameDir, "source");
    const matchedOutputFrames = motionTimes.length === identityTimes.length ? outputFrames : await extractFrames(outputVideoPath, motionTimes, frameDir, "motion-output");

    const [decodeProbe, sceneChangeRate, blackFrameRatio] = await Promise.all([
      probeDecode(outputVideoPath),
      computeSceneChangeRate(outputVideoPath, outputMeta.durationSec).catch(() => 0),
      computeBrightnessRatio(outputFrames).catch(() => 0)
    ]);

    const identityFrameScores = [];
    for (const framePath of outputFrames) {
      identityFrameScores.push(await computeSsimScore(referenceImagePath, framePath).catch(() => 0));
    }

    const motionFrameScores = [];
    for (let index = 0; index < Math.min(sourceFrames.length, matchedOutputFrames.length); index += 1) {
      motionFrameScores.push(await computeSsimScore(sourceFrames[index], matchedOutputFrames[index]).catch(() => 0));
    }

    const [sourceMotionEnergy, outputMotionEnergy] = await Promise.all([
      computeAdjacentMotionEnergy(sourceFrames).catch(() => 0),
      computeAdjacentMotionEnergy(matchedOutputFrames).catch(() => 0)
    ]);

    const durationDeltaSec = Math.abs(sourceMeta.durationSec - outputMeta.durationSec);
    const frameRateDelta = Math.abs(sourceMeta.frameRate - outputMeta.frameRate);
    const outputValid =
      outputMeta.sizeBytes > 0 &&
      outputMeta.durationSec > 0 &&
      outputMeta.width > 0 &&
      outputMeta.height > 0;
    const decodeSuccessful = decodeProbe.success;
    const hasVideoStream = Boolean(outputMeta.width && outputMeta.height);
    const identityScore = average(identityFrameScores);
    const motionSimilarityScore = average(motionFrameScores);
    const durationScore = clamp(1 - durationDeltaSec / 0.5);
    const frameRateScore = clamp(1 - frameRateDelta / 12);
    const freezeRisk = sourceMotionEnergy > 0.02 ? clamp((sourceMotionEnergy - outputMotionEnergy) / sourceMotionEnergy) : 0;
    const motionScore = clamp(
      motionSimilarityScore * 0.45 + durationScore * 0.25 + frameRateScore * 0.15 + (1 - freezeRisk) * 0.15
    );
    const excessMotionEnergy = Math.max(0, outputMotionEnergy - sourceMotionEnergy);
    const instabilityPenalty = clamp(excessMotionEnergy / 0.35);
    const scenePenalty = clamp(sceneChangeRate / 6);
    const stabilityScore = clamp(1 - (instabilityPenalty * 0.7 + scenePenalty * 0.3));

    let corruptionPenalty = 0;
    if (!outputValid) {
      corruptionPenalty += 0.5;
    }
    if (!decodeSuccessful) {
      corruptionPenalty += 0.4;
    }
    if (!hasVideoStream) {
      corruptionPenalty += 0.4;
    }
    if (blackFrameRatio > 0.6) {
      corruptionPenalty += 0.3;
    }
    if (durationDeltaSec > 0.75) {
      corruptionPenalty += 0.2;
    }
    if (frameRateDelta > 8) {
      corruptionPenalty += 0.1;
    }
    const corruptionScore = clamp(1 - corruptionPenalty);

    const flags = [];
    if (!outputValid) {
      flags.push("broken_output");
    }
    if (!decodeSuccessful) {
      flags.push("decode_failure");
    }
    if (blackFrameRatio > 0.6) {
      flags.push("blank_frames_detected");
    }
    if (durationDeltaSec > 0.35) {
      flags.push("duration_mismatch");
    }
    if (frameRateDelta > 5) {
      flags.push("framerate_mismatch");
    }
    if (sceneChangeRate > 3) {
      flags.push("possible_flicker");
    }
    if (identityScore < 0.4) {
      flags.push("low_identity_similarity");
    }
    if (motionScore < 0.65) {
      flags.push("low_motion_fidelity");
    }
    if (freezeRisk > 0.45) {
      flags.push("possible_freeze");
    }
    if (stabilityScore < 0.6) {
      flags.push("temporal_instability");
    }
    if (corruptionScore < 0.75) {
      flags.push("corruption_risk");
    }

    return buildResult({
      outputValid,
      decodeSuccessful,
      durationDeltaSec,
      frameRateDelta,
      sceneChangeRate,
      identityScore,
      identityFrameScores,
      identitySampleTimesSec: identityTimes,
      motionScore,
      motionSimilarityScore,
      motionSampleTimesSec: motionTimes,
      freezeRisk,
      sourceMotionEnergy,
      outputMotionEnergy,
      stabilityScore,
      excessMotionEnergy,
      corruptionScore,
      blackFrameRatio,
      hasVideoStream,
      flags
    });
  } finally {
    await fs.rm(frameDir, { force: true, recursive: true });
  }
}
