import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { evaluateRun } from "../src/evaluation.js";

const execFileAsync = promisify(execFile);

async function makeFixtureDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "avatar-eval-"));
}

async function makeReferenceImage(filePath, color = "lightblue") {
  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=320x240:d=1`,
    "-frames:v",
    "1",
    filePath
  ]);
}

async function makeVideo(filePath, input) {
  await execFileAsync("ffmpeg", ["-y", "-f", "lavfi", "-i", input, "-t", "2", filePath]);
}

test("evaluateRun returns structured metrics for a valid output video", async () => {
  const dir = await makeFixtureDir();
  const sourcePath = path.join(dir, "source.mp4");
  const referencePath = path.join(dir, "reference.png");
  const outputPath = path.join(dir, "output.mp4");

  await makeVideo(sourcePath, "testsrc=size=320x240:rate=24");
  await makeReferenceImage(referencePath);
  await fs.copyFile(sourcePath, outputPath);

  const result = await evaluateRun({
    sourceVideoPath: sourcePath,
    referenceImagePath: referencePath,
    outputVideoPath: outputPath
  });

  assert.equal(result.outputValid, true);
  assert.equal(result.decodeSuccessful, true);
  assert.equal(result.motionScore > 0.9, true);
  assert.equal(result.corruptionScore > 0.9, true);
  assert.equal(Array.isArray(result.identityRetention.sampledFrameScores), true);
});

test("evaluateRun flags duration mismatch", async () => {
  const dir = await makeFixtureDir();
  const sourcePath = path.join(dir, "source.mp4");
  const referencePath = path.join(dir, "reference.png");
  const outputPath = path.join(dir, "output-short.mp4");

  await makeVideo(sourcePath, "testsrc=size=320x240:rate=24");
  await makeReferenceImage(referencePath);
  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x240:rate=24",
    "-t",
    "0.5",
    outputPath
  ]);

  const result = await evaluateRun({
    sourceVideoPath: sourcePath,
    referenceImagePath: referencePath,
    outputVideoPath: outputPath
  });

  assert.equal(result.flags.includes("duration_mismatch"), true);
  assert.equal(result.durationDeltaSec > 0.35, true);
});

test("evaluateRun flags black output as corruption risk", async () => {
  const dir = await makeFixtureDir();
  const sourcePath = path.join(dir, "source.mp4");
  const referencePath = path.join(dir, "reference.png");
  const outputPath = path.join(dir, "output-black.mp4");

  await makeVideo(sourcePath, "testsrc=size=320x240:rate=24");
  await makeReferenceImage(referencePath);
  await makeVideo(outputPath, "color=c=black:s=320x240:r=24");

  const result = await evaluateRun({
    sourceVideoPath: sourcePath,
    referenceImagePath: referencePath,
    outputVideoPath: outputPath
  });

  assert.equal(result.flags.includes("blank_frames_detected"), true);
  assert.equal(result.flags.includes("corruption_risk"), true);
  assert.equal(result.corruptionScore < 0.8, true);
});

test("evaluateRun treats unreadable output as broken", async () => {
  const dir = await makeFixtureDir();
  const sourcePath = path.join(dir, "source.mp4");
  const referencePath = path.join(dir, "reference.png");
  const outputPath = path.join(dir, "output-bad.mp4");

  await makeVideo(sourcePath, "testsrc=size=320x240:rate=24");
  await makeReferenceImage(referencePath);
  await fs.writeFile(outputPath, "not-a-real-video");

  const result = await evaluateRun({
    sourceVideoPath: sourcePath,
    referenceImagePath: referencePath,
    outputVideoPath: outputPath
  });

  assert.equal(result.outputValid, false);
  assert.equal(result.flags.includes("broken_output"), true);
  assert.equal(result.flags.includes("decode_failure"), true);
});

test("evaluateRun lowers motion fidelity for frozen output", async () => {
  const dir = await makeFixtureDir();
  const sourcePath = path.join(dir, "source.mp4");
  const referencePath = path.join(dir, "reference.png");
  const frozenFramePath = path.join(dir, "frozen.png");
  const outputPath = path.join(dir, "output-frozen.mp4");

  await makeVideo(sourcePath, "testsrc=size=320x240:rate=24");
  await makeReferenceImage(referencePath);
  await execFileAsync("ffmpeg", ["-y", "-i", sourcePath, "-frames:v", "1", frozenFramePath]);
  await execFileAsync("ffmpeg", [
    "-y",
    "-loop",
    "1",
    "-i",
    frozenFramePath,
    "-t",
    "2",
    "-vf",
    "format=yuv420p",
    outputPath
  ]);

  const result = await evaluateRun({
    sourceVideoPath: sourcePath,
    referenceImagePath: referencePath,
    outputVideoPath: outputPath
  });

  assert.equal(result.motionFidelity.freezeRisk > 0.45, true);
  assert.equal(result.flags.includes("possible_freeze"), true);
  assert.equal(result.motionScore < 0.8, true);
});

test("evaluateRun lowers stability for temporally unstable output", async () => {
  const dir = await makeFixtureDir();
  const sourcePath = path.join(dir, "source-static.mp4");
  const referencePath = path.join(dir, "reference.png");
  const outputPath = path.join(dir, "output-unstable.mp4");

  await makeVideo(sourcePath, "color=c=gray:s=320x240:r=24");
  await makeReferenceImage(referencePath);
  await makeVideo(outputPath, "nullsrc=s=320x240:r=24,geq=lum='if(mod(N,2),255,0)':cb=128:cr=128");

  const result = await evaluateRun({
    sourceVideoPath: sourcePath,
    referenceImagePath: referencePath,
    outputVideoPath: outputPath
  });

  assert.equal(result.temporalStability.score < 0.8, true);
  assert.equal(result.temporalStability.excessMotionEnergy > 0.1, true);
});
