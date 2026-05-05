import crypto from "node:crypto";

export function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export async function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

