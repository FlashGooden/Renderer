import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadProjectConfig } from "@avatar/core/config.js";
import { compareRuns } from "@avatar/core/compare.js";
import type { AnyRecord, ProjectConfig } from "@avatar/core/types.js";

function printUsage() {
  console.log(`Usage:
  avatar upload <file> --kind reference|driving [--label name]
  avatar run --reference <asset-id> --video <asset-id> [--preset preview-720p] [--provider replicate-dreamactor] [--notes text]
    [--benchmark-dataset <id>] [--benchmark-case <id>] [--benchmark-run-group <id>] [--candidate-label <label>]
  avatar status <run-id> [--json]
  avatar fetch <run-id> [--output-dir ./outputs]
  avatar review <run-id> [--decision approve|reject] [--notes text] [--reviewer name] [--tag name] [--criterion key=state]
  avatar preview <run-id> [--kind preview_still] [--kind contact_sheet]
  avatar compare <run-id-a> <run-id-b> [--json]
  avatar benchmark-dataset create --label <name> --case <json> [--case <json>] [--notes text]
  avatar benchmark-dataset status <dataset-id> [--json]
  avatar benchmark-run-group create --label <name> --dataset <dataset-id> [--candidate <label>] [--notes text]
  avatar benchmark-run-group status <group-id> [--json]
  avatar compare-group <group-id> [--json]`);
}

type FlagValue = string | boolean | Array<string | boolean>;
type Flags = Record<string, FlagValue>;

function parseFlags(argv: string[]): { positionals: string[]; flags: Flags } {
  const flags: Flags = {};
  const positionals: string[] = [];

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

function requireFlag(flags: Flags, name: string): string {
  const value = flags[name];
  if (!value || value === true) {
    throw new Error(`Missing required flag --${name}`);
  }
  return Array.isArray(value) ? String(value[0]) : String(value);
}

function listFlag(flags: Flags, name: string): string[] {
  if (!flags[name]) {
    return [];
  }
  const value = flags[name];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function parseJsonList(values: string[]): AnyRecord[] {
  return values.map((value) => JSON.parse(value));
}

function parseCriteria(values: string[]): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const value of values) {
    const [key, state] = String(value).split("=");
    if (!key || !state) {
      throw new Error(`Invalid criterion "${value}". Expected key=state.`);
    }
    criteria[key] = state;
  }
  return criteria;
}

function defaultReviewer(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER || process.env.USERNAME || "";
  }
}

async function requestJson(baseUrl: string, method: string, pathname: string, body: unknown = undefined): Promise<any> {
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

async function commandUpload(config: ProjectConfig, filePath: string, flags: Flags): Promise<void> {
  const kind = requireFlag(flags, "kind");
  const filename = path.basename(filePath);
  const buffer = await fs.readFile(filePath);

  const response = await fetch(new URL("/assets", config.runnerUrl), {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-avatar-kind": kind,
      "x-avatar-filename": filename,
      "x-avatar-label": flags.label ? requireFlag(flags, "label") : ""
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

async function commandRun(config: ProjectConfig, flags: Flags): Promise<void> {
  const payload = await requestJson(config.runnerUrl, "POST", "/runs", {
    providerId: flags.provider || "replicate-dreamactor",
    spec: {
      referenceAssetId: requireFlag(flags, "reference"),
      sourceVideoAssetId: requireFlag(flags, "video"),
      presetId: flags.preset || "preview-720p",
      outputProfile: flags["output-profile"] || "preview",
      notes: flags.notes || "",
      benchmarkDatasetId: flags["benchmark-dataset"] || null,
      benchmarkCaseId: flags["benchmark-case"] || null,
      benchmarkRunGroupId: flags["benchmark-run-group"] || null,
      candidateLabel: flags["candidate-label"] || ""
    }
  });

  console.log(`Submitted ${payload.run.id}`);
  console.log(JSON.stringify(payload.run, null, 2));
}

async function commandStatus(config: ProjectConfig, runId: string, flags: Flags): Promise<void> {
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
  if (payload.run.provider) {
    console.log(`Provider status: ${payload.run.provider.status}`);
    if (payload.run.provider.runId) {
      console.log(`Provider run: ${payload.run.provider.runId}`);
    }
  }
  if (payload.run.benchmarkRunGroupId) {
    console.log(`Benchmark: ${payload.run.benchmarkDatasetId}/${payload.run.benchmarkCaseId} (${payload.run.candidateLabel})`);
  }
  if (payload.run.failureReason) {
    console.log(`Failure: ${payload.run.failureReason}`);
  }
  if (payload.run.evaluation) {
    console.log(`Evaluation overall score: ${payload.run.evaluation.overallScore.toFixed(3)}`);
    console.log(`Identity: ${payload.run.evaluation.identityScore.toFixed(3)}`);
    console.log(`Motion: ${payload.run.evaluation.motionScore.toFixed(3)}`);
    console.log(`Stability: ${payload.run.evaluation.stabilityScore.toFixed(3)}`);
    console.log(`Corruption: ${payload.run.evaluation.corruptionScore.toFixed(3)}`);
    if (payload.run.evaluation.flags.length) {
      console.log(`Flags: ${payload.run.evaluation.flags.join(", ")}`);
    }
  }
  if (payload.run.latestReview) {
    const reviewerSuffix = payload.run.latestReview.reviewer ? ` by ${payload.run.latestReview.reviewer}` : "";
    const decision = payload.run.latestReview.decision || "note";
    console.log(`Latest review: ${decision}${reviewerSuffix}`);
  }
}

async function commandFetch(config: ProjectConfig, runId: string, flags: Flags): Promise<void> {
  const payload = await requestJson(config.runnerUrl, "GET", `/runs/${runId}`);
  const outputDir = path.resolve(flags["output-dir"] ? requireFlag(flags, "output-dir") : "outputs");
  await fs.mkdir(outputDir, { recursive: true });

  const downloads: string[] = [];
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

async function commandReview(config: ProjectConfig, runId: string, flags: Flags): Promise<void> {
  const tags = listFlag(flags, "tag");
  const criteria = parseCriteria(listFlag(flags, "criterion"));
  const decision = flags.decision && flags.decision !== true ? flags.decision : null;
  const payload = await requestJson(config.runnerUrl, "POST", `/runs/${runId}/review`, {
    decision,
    reviewer: flags.reviewer || defaultReviewer(),
    notes: flags.notes || "",
    tags,
    criteria
  });

  console.log(`Reviewed ${payload.run.id}`);
  console.log(JSON.stringify(payload.run.latestReview, null, 2));
}

async function commandPreview(config: ProjectConfig, runId: string, flags: Flags): Promise<void> {
  const kinds = listFlag(flags, "kind");
  const payload = await requestJson(config.runnerUrl, "POST", `/runs/${runId}/previews`, {
    kinds: kinds.length ? kinds : ["preview_still", "contact_sheet"]
  });

  console.log(JSON.stringify(payload.artifacts, null, 2));
}

async function commandCompare(config: ProjectConfig, runA: string, runB: string, flags: Flags): Promise<void> {
  const [left, right] = await Promise.all([
    requestJson(config.runnerUrl, "GET", `/runs/${runA}`),
    requestJson(config.runnerUrl, "GET", `/runs/${runB}`)
  ]);

  const comparison = compareRuns(left.run, right.run);
  if (flags.json) {
    console.log(JSON.stringify(comparison, null, 2));
    return;
  }

  console.log(`Compare ${runA} vs ${runB}`);
  console.log(comparison.summary);
  console.log(JSON.stringify(comparison, null, 2));
}

async function commandBenchmarkDataset(config: ProjectConfig, positionals: string[], flags: Flags): Promise<void> {
  const action = positionals[0];
  if (action === "create") {
    const payload = await requestJson(config.runnerUrl, "POST", "/benchmark-datasets", {
      label: requireFlag(flags, "label"),
      notes: flags.notes || "",
      cases: parseJsonList(listFlag(flags, "case"))
    });
    console.log(`Created ${payload.dataset.id}`);
    console.log(JSON.stringify(payload.dataset, null, 2));
    return;
  }

  if (action === "status") {
    if (!positionals[1]) {
      throw new Error("Missing benchmark dataset ID.");
    }
    const payload = await requestJson(config.runnerUrl, "GET", `/benchmark-datasets/${positionals[1]}`);
    console.log(JSON.stringify(payload.dataset, null, 2));
    return;
  }

  throw new Error(`Unsupported benchmark-dataset action "${action}".`);
}

async function commandBenchmarkRunGroup(config: ProjectConfig, positionals: string[], flags: Flags): Promise<void> {
  const action = positionals[0];
  if (action === "create") {
    const payload = await requestJson(config.runnerUrl, "POST", "/benchmark-run-groups", {
      label: requireFlag(flags, "label"),
      benchmarkDatasetId: requireFlag(flags, "dataset"),
      notes: flags.notes || "",
      candidateLabels: listFlag(flags, "candidate")
    });
    console.log(`Created ${payload.group.id}`);
    console.log(JSON.stringify(payload.group, null, 2));
    return;
  }

  if (action === "status") {
    if (!positionals[1]) {
      throw new Error("Missing benchmark run group ID.");
    }
    const payload = await requestJson(config.runnerUrl, "GET", `/benchmark-run-groups/${positionals[1]}`);
    console.log(JSON.stringify(payload.group, null, 2));
    return;
  }

  throw new Error(`Unsupported benchmark-run-group action "${action}".`);
}

async function commandCompareGroup(config: ProjectConfig, groupId: string, flags: Flags): Promise<void> {
  const payload = await requestJson(config.runnerUrl, "GET", `/benchmark-run-groups/${groupId}/compare`);
  if (flags.json) {
    console.log(JSON.stringify(payload.comparison, null, 2));
    return;
  }
  console.log(JSON.stringify(payload.comparison, null, 2));
}

async function main(): Promise<void> {
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
    case "preview":
      if (!positionals[0]) {
        throw new Error("Missing run ID.");
      }
      await commandPreview(config, positionals[0], flags);
      return;
    case "compare":
      if (!positionals[0] || !positionals[1]) {
        throw new Error("Missing run IDs.");
      }
      await commandCompare(config, positionals[0], positionals[1], flags);
      return;
    case "benchmark-dataset":
      await commandBenchmarkDataset(config, positionals, flags);
      return;
    case "benchmark-run-group":
      await commandBenchmarkRunGroup(config, positionals, flags);
      return;
    case "compare-group":
      if (!positionals[0]) {
        throw new Error("Missing benchmark run group ID.");
      }
      await commandCompareGroup(config, positionals[0], flags);
      return;
    default:
      throw new Error(`Unknown command "${command}".`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
