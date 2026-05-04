import fs from "node:fs/promises";
import path from "node:path";
import { loadProjectConfig } from "../../core/src/config.js";

function printUsage() {
  console.log(`Usage:
  avatar upload <file> --kind reference|driving [--label name]
  avatar run --reference <asset-id> --video <asset-id> [--preset preview-720p] [--provider mock-primary] [--notes text]
  avatar status <run-id> [--json]
  avatar fetch <run-id> [--output-dir ./outputs]
  avatar review <run-id> --decision approve|reject [--notes text] [--tag name]
  avatar compare <run-id-a> <run-id-b> [--json]`);
}

function parseFlags(argv) {
  const flags = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      if (!flags[key]) {
        flags[key] = true;
      } else if (Array.isArray(flags[key])) {
        flags[key].push(true);
      } else {
        flags[key] = [flags[key], true];
      }
      continue;
    }

    index += 1;
    if (flags[key] === undefined) {
      flags[key] = next;
    } else if (Array.isArray(flags[key])) {
      flags[key].push(next);
    } else {
      flags[key] = [flags[key], next];
    }
  }

  return { positionals, flags };
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (!value || value === true) {
    throw new Error(`Missing required flag --${name}`);
  }
  return value;
}

async function requestJson(baseUrl, method, pathname, body) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: {
      "content-type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }
  return payload;
}

async function commandUpload(config, filePath, flags) {
  const kind = requireFlag(flags, "kind");
  const filename = path.basename(filePath);
  const buffer = await fs.readFile(filePath);

  const response = await fetch(new URL("/assets", config.runnerUrl), {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-avatar-kind": kind,
      "x-avatar-filename": filename,
      "x-avatar-label": flags.label || ""
    },
    body: buffer
  });

  const payload = JSON.parse(await response.text());
  if (!response.ok) {
    throw new Error(payload.error || `Upload failed with status ${response.status}`);
  }

  console.log(`Uploaded ${payload.asset.id}`);
  console.log(JSON.stringify(payload.asset, null, 2));
}

async function commandRun(config, flags) {
  const payload = await requestJson(config.runnerUrl, "POST", "/runs", {
    providerId: flags.provider || "mock-primary",
    spec: {
      referenceAssetId: requireFlag(flags, "reference"),
      sourceVideoAssetId: requireFlag(flags, "video"),
      presetId: flags.preset || "preview-720p",
      outputProfile: flags["output-profile"] || "preview",
      notes: flags.notes || ""
    }
  });

  console.log(`Submitted ${payload.run.id}`);
  console.log(JSON.stringify(payload.run, null, 2));
}

async function commandStatus(config, runId, flags) {
  const payload = await requestJson(config.runnerUrl, "GET", `/runs/${runId}`);
  if (flags.json) {
    console.log(JSON.stringify(payload.run, null, 2));
    return;
  }

  console.log(`Run: ${payload.run.id}`);
  console.log(`State: ${payload.run.state}`);
  console.log(`Review: ${payload.run.reviewStatus}`);
  console.log(`Provider: ${payload.run.providerId}`);
  console.log(`Preset: ${payload.run.presetId}`);
  console.log(`Cost (estimated): $${payload.run.cost.estimatedUsd.toFixed(3)}`);
  if (payload.run.failureReason) {
    console.log(`Failure: ${payload.run.failureReason}`);
  }
  if (payload.run.evaluation) {
    console.log(`Evaluation overall score: ${payload.run.evaluation.overallScore.toFixed(3)}`);
    if (payload.run.evaluation.flags.length) {
      console.log(`Flags: ${payload.run.evaluation.flags.join(", ")}`);
    }
  }
}

async function commandFetch(config, runId, flags) {
  const payload = await requestJson(config.runnerUrl, "GET", `/runs/${runId}`);
  const outputDir = path.resolve(flags["output-dir"] || "outputs");
  await fs.mkdir(outputDir, { recursive: true });

  const downloads = [];
  for (const artifact of payload.run.artifacts || []) {
    const response = await fetch(new URL(`/runs/${runId}/artifacts/${artifact.id}/content`, config.runnerUrl));
    if (!response.ok) {
      throw new Error(`Failed to fetch artifact ${artifact.id}`);
    }
    const destination = path.join(outputDir, artifact.filename);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(destination, buffer);
    downloads.push(destination);
  }

  for (const filePath of downloads) {
    console.log(filePath);
  }
}

async function commandReview(config, runId, flags) {
  const tags = flags.tag ? (Array.isArray(flags.tag) ? flags.tag : [flags.tag]) : [];
  const payload = await requestJson(config.runnerUrl, "POST", `/runs/${runId}/review`, {
    decision: requireFlag(flags, "decision"),
    notes: flags.notes || "",
    tags
  });

  console.log(`Reviewed ${payload.run.id}`);
  console.log(JSON.stringify(payload.run, null, 2));
}

async function commandCompare(config, runA, runB, flags) {
  const [left, right] = await Promise.all([
    requestJson(config.runnerUrl, "GET", `/runs/${runA}`),
    requestJson(config.runnerUrl, "GET", `/runs/${runB}`)
  ]);

  const comparison = {
    left: summarizeRun(left.run),
    right: summarizeRun(right.run),
    differences: {
      overallScoreDelta: round((left.run.evaluation?.overallScore || 0) - (right.run.evaluation?.overallScore || 0)),
      identityScoreDelta: round((left.run.evaluation?.identityScore || 0) - (right.run.evaluation?.identityScore || 0)),
      motionScoreDelta: round((left.run.evaluation?.motionScore || 0) - (right.run.evaluation?.motionScore || 0)),
      estimatedCostDeltaUsd: round((left.run.cost?.estimatedUsd || 0) - (right.run.cost?.estimatedUsd || 0))
    }
  };

  if (flags.json) {
    console.log(JSON.stringify(comparison, null, 2));
    return;
  }

  console.log(`Compare ${runA} vs ${runB}`);
  console.log(JSON.stringify(comparison, null, 2));
}

function summarizeRun(run) {
  return {
    id: run.id,
    state: run.state,
    providerId: run.providerId,
    presetId: run.presetId,
    reviewStatus: run.reviewStatus,
    evaluation: run.evaluation,
    estimatedCostUsd: run.cost?.estimatedUsd || 0
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === "--help" || command === "help") {
    printUsage();
    return;
  }

  const config = await loadProjectConfig(process.cwd());
  const { positionals, flags } = parseFlags(argv.slice(1));

  switch (command) {
    case "upload":
      if (!positionals[0]) {
        throw new Error("Missing file path.");
      }
      await commandUpload(config, positionals[0], flags);
      return;
    case "run":
      await commandRun(config, flags);
      return;
    case "status":
      if (!positionals[0]) {
        throw new Error("Missing run ID.");
      }
      await commandStatus(config, positionals[0], flags);
      return;
    case "fetch":
      if (!positionals[0]) {
        throw new Error("Missing run ID.");
      }
      await commandFetch(config, positionals[0], flags);
      return;
    case "review":
      if (!positionals[0]) {
        throw new Error("Missing run ID.");
      }
      await commandReview(config, positionals[0], flags);
      return;
    case "compare":
      if (!positionals[0] || !positionals[1]) {
        throw new Error("Missing run IDs.");
      }
      await commandCompare(config, positionals[0], positionals[1], flags);
      return;
    default:
      throw new Error(`Unknown command "${command}".`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

