import type { Preset } from "./types.js";

export const PRESETS = {
  "preview-720p": {
    id: "preview-720p",
    label: "Landscape preview",
    maxDurationSec: 10,
    width: 1280,
    height: 720,
    aspectRatio: "16:9",
    identityStrength: 0.8,
    motionStrength: 0.75,
    providers: {
      "replicate-dreamactor": {
        cutFirstSecond: false
      }
    }
  },
  "vertical-720p": {
    id: "vertical-720p",
    label: "Vertical short",
    maxDurationSec: 10,
    width: 720,
    height: 1280,
    aspectRatio: "9:16",
    identityStrength: 0.8,
    motionStrength: 0.75,
    providers: {
      "replicate-dreamactor": {
        cutFirstSecond: false
      }
    }
  },
  "square-512": {
    id: "square-512",
    label: "Square experiment",
    maxDurationSec: 8,
    width: 512,
    height: 512,
    aspectRatio: "1:1",
    identityStrength: 0.7,
    motionStrength: 0.7,
    providers: {
      "replicate-dreamactor": {
        cutFirstSecond: false
      }
    }
  }
} as const satisfies Record<string, Preset>;

export function getPreset(presetId: string): Preset {
  const preset = PRESETS[presetId as keyof typeof PRESETS];
  if (!preset) {
    throw new Error(`Unknown preset "${presetId}".`);
  }
  return preset;
}
