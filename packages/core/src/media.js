import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureDir, sanitizeFilename } from "./fs-utils.js";

const execFileAsync = promisify(execFile);

export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
export const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm"]);

export function getExtension(filename) {
  return path.extname(filename || "").toLowerCase();
}

export function contentTypeForExtension(extension) {
  switch (extension) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    default:
      return "video/mp4";
  }
}

export function assertSupportedFilename(kind, filename) {
  const extension = getExtension(filename);
  if (kind === "reference" && !IMAGE_EXTENSIONS.has(extension)) {
    throw new Error(`Reference images must use one of: ${[...IMAGE_EXTENSIONS].join(", ")}`);
  }
  if (kind === "driving" && !VIDEO_EXTENSIONS.has(extension)) {
    throw new Error(`Driving videos must use one of: ${[...VIDEO_EXTENSIONS].join(", ")}`);
  }
}

export async function inspectMedia(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    filePath
  ]);

  const payload = JSON.parse(stdout);
  const videoStream = payload.streams?.find((stream) => stream.codec_type === "video");
  const format = payload.format || {};
  const formatNames = String(format.format_name || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    durationSec: Number(format.duration || 0),
    sizeBytes: Number(format.size || 0),
    width: Number(videoStream?.width || 0),
    height: Number(videoStream?.height || 0),
    codecName: videoStream?.codec_name || null,
    frameRate: parseFrameRate(videoStream?.avg_frame_rate),
    formatName: format.format_name || null,
    formatNames,
    hasVideoStream: Boolean(videoStream)
  };
}

export function parseFrameRate(value) {
  if (!value || value === "0/0") {
    return 0;
  }
  const [num, den] = value.split("/").map(Number);
  if (!num || !den) {
    return 0;
  }
  return num / den;
}

export async function writeTempFile(prefix, filename, buffer) {
  const tmpDir = path.join(os.tmpdir(), "avatar-project");
  await ensureDir(tmpDir);
  const filePath = path.join(tmpDir, `${prefix}-${Date.now()}-${sanitizeFilename(filename)}`);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export function createDataUrl(contentType, buffer) {
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}
