import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRunnerServer } from "../src/server.js";

const execFileAsync = promisify(execFile);

async function createMediaFixtures(dir) {
  const referencePath = path.join(dir, "reference.png");
  const sourcePath = path.join(dir, "source.mp4");

  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=salmon:s=512x512:d=1",
    "-frames:v",
    "1",
    referencePath
  ]);

  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x360:rate=24",
    "-t",
    "2",
    sourcePath
  ]);

  return { referencePath, sourcePath };
}

async function upload(baseUrl, filePath, kind) {
  const buffer = await fs.readFile(filePath);
  const response = await fetch(new URL("/assets", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-avatar-kind": kind,
      "x-avatar-filename": path.basename(filePath)
    },
    body: buffer
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  return payload.asset.id;
}

async function getRun(baseUrl, runId) {
  const response = await fetch(new URL(`/runs/${runId}`, baseUrl));
  assert.equal(response.status, 200);
  const payload = await response.json();
  return payload.run;
}

test("runner supports upload, run, fetch, and review", async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "avatar-runner-"));
  const { referencePath, sourcePath } = await createMediaFixtures(rootDir);
  const server = await createRunnerServer({
    runnerPort: 0,
    runnerUrl: "http://127.0.0.1:0",
    dataDir: path.join(rootDir, ".avatar"),
    storageMode: "local",
    azureBlobBaseUrl: ""
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("Sandbox does not permit binding a local port.");
      return;
    }
    throw error;
  }
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const referenceAssetId = await upload(baseUrl, referencePath, "reference");
    const sourceAssetId = await upload(baseUrl, sourcePath, "driving");

    const runResponse = await fetch(new URL("/runs", baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        providerId: "mock-primary",
        spec: {
          referenceAssetId,
          sourceVideoAssetId: sourceAssetId,
          presetId: "preview-720p",
          outputProfile: "preview"
        }
      })
    });

    assert.equal(runResponse.status, 201);
    const runPayload = await runResponse.json();

    let run = await getRun(baseUrl, runPayload.run.id);
    for (let attempt = 0; attempt < 30 && ["queued", "running"].includes(run.state); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      run = await getRun(baseUrl, runPayload.run.id);
    }

    assert.equal(run.state, "needs_review");
    assert.equal(run.artifacts.length, 1);
    assert.equal(run.evaluation.outputValid, true);

    const artifactResponse = await fetch(new URL(`/runs/${run.id}/artifacts/${run.artifacts[0].id}/content`, baseUrl));
    assert.equal(artifactResponse.status, 200);
    const artifactBytes = Buffer.from(await artifactResponse.arrayBuffer());
    assert.equal(artifactBytes.length > 0, true);

    const reviewResponse = await fetch(new URL(`/runs/${run.id}/review`, baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        decision: "approve",
        notes: "usable",
        reviewer: "tester",
        tags: ["usable"],
        criteria: {
          overall: "pass"
        }
      })
    });

    assert.equal(reviewResponse.status, 200);
    const reviewed = await reviewResponse.json();
    assert.equal(reviewed.run.state, "succeeded");
    assert.equal(reviewed.run.reviewHistory.length, 1);

    const previewResponse = await fetch(new URL(`/runs/${run.id}/previews`, baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        kinds: ["preview_still", "contact_sheet"]
      })
    });

    assert.equal(previewResponse.status, 200);
    const previewPayload = await previewResponse.json();
    assert.equal(previewPayload.artifacts.length, 2);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
