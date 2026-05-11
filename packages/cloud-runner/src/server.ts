import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { loadProjectConfig } from "@avatar/core/config.js";
import { FileJobStore } from "@avatar/core/job-store.js";
import { createStorageDriver } from "@avatar/core/storage.js";
import { createProviderRegistry } from "@avatar/core/providers.js";
import { readJsonRequest, readRequestBuffer, sendJson, sendText } from "@avatar/core/http.js";
import { AvatarService } from "@avatar/core/service.js";
import type { AssetKind, ProjectConfig, ProviderRegistry, StorageDriver } from "@avatar/core/types.js";

export function createRunnerHandler({ service, storageDriver, providers }: { service: AvatarService; storageDriver: StorageDriver; providers: ProviderRegistry }) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          ok: true,
          defaultProvider: "replicate-dreamactor",
          providers: providers.list()
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/assets") {
        const kind = request.headers["x-avatar-kind"];
        const filename = request.headers["x-avatar-filename"];
        const label = request.headers["x-avatar-label"] || "";
        if (!kind || !filename) {
          sendJson(response, 400, { error: "x-avatar-kind and x-avatar-filename are required." });
          return;
        }
        const buffer = await readRequestBuffer(request);
        const asset = await service.registerAsset({ kind: String(kind) as AssetKind, filename: String(filename), label: String(label), buffer });
        sendJson(response, 201, { asset });
        return;
      }

      if (request.method === "POST" && url.pathname === "/runs") {
        const body = await readJsonRequest(request);
        const run = await service.createRun(body);
        sendJson(response, 201, { run });
        return;
      }

      if (request.method === "POST" && url.pathname === "/benchmark-datasets") {
        const body = await readJsonRequest(request);
        const dataset = await service.createBenchmarkDataset(body);
        sendJson(response, 201, { dataset });
        return;
      }

      const datasetMatch = url.pathname.match(/^\/benchmark-datasets\/([^/]+)$/);
      if (request.method === "GET" && datasetMatch) {
        const dataset = await service.getBenchmarkDataset(datasetMatch[1]);
        sendJson(response, 200, { dataset });
        return;
      }

      if (request.method === "POST" && url.pathname === "/benchmark-run-groups") {
        const body = await readJsonRequest(request);
        const group = await service.createBenchmarkRunGroup(body);
        sendJson(response, 201, { group });
        return;
      }

      const groupMatch = url.pathname.match(/^\/benchmark-run-groups\/([^/]+)$/);
      if (request.method === "GET" && groupMatch) {
        const group = await service.getBenchmarkRunGroup(groupMatch[1]);
        sendJson(response, 200, { group });
        return;
      }

      const groupCompareMatch = url.pathname.match(/^\/benchmark-run-groups\/([^/]+)\/compare$/);
      if (request.method === "GET" && groupCompareMatch) {
        const comparison = await service.compareBenchmarkRunGroup(groupCompareMatch[1]);
        sendJson(response, 200, { comparison });
        return;
      }

      const runMatch = url.pathname.match(/^\/runs\/([^/]+)$/);
      if (request.method === "GET" && runMatch) {
        const run = await service.getRun(runMatch[1]);
        sendJson(response, 200, { run });
        return;
      }

      const reviewMatch = url.pathname.match(/^\/runs\/([^/]+)\/review$/);
      if (request.method === "POST" && reviewMatch) {
        const body = await readJsonRequest(request);
        const run = await service.submitReview(reviewMatch[1], body);
        sendJson(response, 200, { run });
        return;
      }

      const previewMatch = url.pathname.match(/^\/runs\/([^/]+)\/previews$/);
      if (request.method === "POST" && previewMatch) {
        const body = await readJsonRequest(request);
        const artifacts = await service.generateRunPreviews(previewMatch[1], body);
        sendJson(response, 200, { artifacts });
        return;
      }

      const artifactMatch = url.pathname.match(/^\/runs\/([^/]+)\/artifacts\/([^/]+)\/content$/);
      if (request.method === "GET" && artifactMatch) {
        const artifact = await service.getArtifact(artifactMatch[1], artifactMatch[2]);
        const { buffer } = await storageDriver.readBuffer(artifact.locator);
        response.writeHead(200, {
          "content-type": artifact.contentType || "application/octet-stream",
          "content-length": String(buffer.length),
          "content-disposition": `attachment; filename="${artifact.filename}"`
        });
        response.end(buffer);
        return;
      }

      sendText(response, 404, "Not found");
    } catch (error: unknown) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };
}

export async function createRunnerServer(config: ProjectConfig, options: { providers?: ProviderRegistry; providerOptions?: any } = {}) {
  const jobStore = new FileJobStore(config.dataDir);
  const storageDriver = createStorageDriver(config);
  const providers = options.providers || createProviderRegistry(config, options.providerOptions || {});
  const service = new AvatarService({ config, jobStore, storageDriver, providers });
  await service.initialize();
  return http.createServer(createRunnerHandler({ service, storageDriver, providers }));
}

async function main(): Promise<void> {
  const config = await loadProjectConfig(process.cwd());
  const server = await createRunnerServer(config);

  server.listen(config.runnerPort, "127.0.0.1", () => {
    console.log(`Avatar runner listening on http://127.0.0.1:${config.runnerPort}`);
  });
}

const entrypoint = new URL(process.argv[1], "file://").href;
if (import.meta.url === entrypoint) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
