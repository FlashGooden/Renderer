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

test("evaluateRun returns stable metrics for a valid output video", async () => {
  const dir = await makeFixtureDir();
  const sourcePath = path.join(dir, "source.mp4");
  const referencePath = path.join(dir, "reference.png");
  const outputPath = path.join(dir, "output.mp4");

  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x240:rate=24",
    "-t",
    "2",
    sourcePath
  ]);

  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=lightblue:s=320x240:d=1",
    "-frames:v",
    "1",
    referencePath
  ]);

  await fs.copyFile(sourcePath, outputPath);
  const result = await evaluateRun({
    sourceVideoPath: sourcePath,
    referenceImagePath: referencePath,
    outputVideoPath: outputPath
  });

  assert.equal(result.outputValid, true);
  assert.equal(result.durationDeltaSec < 0.1, true);
  assert.equal(result.motionScore > 0.95, true);
});

