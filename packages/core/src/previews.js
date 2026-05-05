import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function generatePreviewStill({ videoPath, outputPath, timeSec }) {
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

export async function generateContactSheet({ videoPath, outputPath, durationSec, sampleCount = 6 }) {
  const effectiveDuration = Math.max(durationSec, 0.5);
  const fps = `${sampleCount}/${effectiveDuration}`;
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-vf",
    `fps=${fps},scale=320:-1,tile=3x2`,
    outputPath
  ]);
}
