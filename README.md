# Personal Azure Avatar Project

CLI-first personal tooling for short avatar motion-retargeting experiments. The repo currently ships a working local stack with:

- `packages/cli`: upload, run, status, fetch, review, and compare commands
- `packages/cloud-runner`: a minimal HTTP runner that can run locally or be deployed to Azure-hosted compute
- `packages/core`: contracts, storage, evaluation, presets, provider adapters, and persistence

The default provider implementation is intentionally offline-friendly. It mirrors the driving video into a preset-shaped output clip so the full orchestration path is testable before you wire in real motion-generation APIs.

## Quick Start

1. Start the runner:

```bash
npm run runner
```

2. Generate sample media or use your own:

```bash
ffmpeg -y -f lavfi -i color=c=lightblue:s=512x512:d=1 -frames:v 1 reference.png
ffmpeg -y -f lavfi -i testsrc=size=1280x720:rate=24 -t 4 source.mp4
```

3. Upload assets:

```bash
npm run avatar -- upload reference.png --kind reference
npm run avatar -- upload source.mp4 --kind driving
```

4. Submit a run:

```bash
npm run avatar -- run --reference <reference-asset-id> --video <driving-asset-id>
```

5. Check status, fetch artifacts, and review:

```bash
npm run avatar -- status <run-id>
npm run avatar -- fetch <run-id> --output-dir ./outputs
npm run avatar -- review <run-id> --decision approve --notes "Looks usable"
```

## Configuration

Configuration is read from environment variables and optionally from `avatar.config.json` in the repo root.

### CLI

- `AVATAR_RUNNER_URL`: default `http://127.0.0.1:4010`

### Runner

- `AVATAR_RUNNER_PORT`: default `4010`
- `AVATAR_DATA_DIR`: default `<repo>/.avatar`
- `AVATAR_STORAGE_MODE`: `local` or `azure-blob`
- `AVATAR_AZURE_BLOB_BASE_URL`: container URL with SAS token for PUT/GET operations when `azure-blob` mode is used

### Example `avatar.config.json`

```json
{
  "runnerUrl": "http://127.0.0.1:4010",
  "dataDir": ".avatar",
  "storageMode": "local",
  "azureBlobBaseUrl": ""
}
```

## Azure Shape

The current runner is intentionally small:

- run the HTTP service on Azure Container Apps or a small VM
- use Azure Blob Storage for uploaded media and generated outputs by switching `AVATAR_STORAGE_MODE=azure-blob`
- keep metadata on attached disk for now; swap to a managed store later when you need stronger durability or remote concurrency

## Commands

- `avatar upload <file> --kind reference|driving`
- `avatar run --reference <asset-id> --video <asset-id> [--preset preview-720p] [--provider mock-primary]`
- `avatar status <run-id> [--json]`
- `avatar fetch <run-id> [--output-dir ./outputs]`
- `avatar review <run-id> --decision approve|reject [--notes "..."] [--tag quality]`
- `avatar compare <run-id-a> <run-id-b> [--json]`

