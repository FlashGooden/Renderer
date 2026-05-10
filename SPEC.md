# Personal Azure Avatar Project Specification

## Status

This document describes the functionality present on `main` at commit `2f6af49` (`Merge pull request #1 from FlashGooden/codex/complete-phase-1-mvp`).

The current system is a CLI-first Phase 1 MVP for short avatar motion-retargeting experiments. It supports local execution, optional Azure Blob-backed asset storage, asynchronous provider execution through Replicate DreamActor M2.0, artifact capture, lightweight automated evaluation, and manual review.

## Product Scope

The application lets a user:

1. Upload a reference image.
2. Upload a driving video.
3. Submit a retargeting run against a preset and provider.
4. Track run state while the provider job executes asynchronously.
5. Persist provider request, response, poll, terminal, cancel, and output artifacts.
6. Evaluate generated output with basic media metrics.
7. Fetch generated artifacts locally.
8. Approve or reject a completed run.
9. Compare two completed runs by score and estimated cost.

The default production provider is Replicate DreamActor M2.0. Mock providers exist only for tests and offline fixtures.

## Architecture

The repository is a Node.js workspace with three packages:

- `packages/cli`: command-line interface for uploads, runs, status, artifact fetches, reviews, and comparisons.
- `packages/cloud-runner`: minimal HTTP server that exposes the runner API.
- `packages/core`: shared contracts, configuration, media inspection, storage drivers, provider adapters, persistence, evaluation, and orchestration service.

The runner is intentionally small. It can run locally or in simple Azure-hosted compute such as Azure Container Apps or a VM. Metadata is stored on attached disk via JSON files. Uploaded inputs and generated outputs are stored either on local disk or Azure Blob Storage.

## Runtime Requirements

- Node.js with native ESM support and built-in `fetch`.
- `ffmpeg` and `ffprobe` available on `PATH`.
- Replicate API token for real provider runs.
- Optional Azure Blob container SAS URL when using Azure Blob Storage mode.

## Configuration

Configuration is loaded from environment variables first, then `avatar.config.json`, then defaults.

| Setting | Source | Default | Purpose |
| --- | --- | --- | --- |
| `runnerUrl` / `AVATAR_RUNNER_URL` | CLI | `http://127.0.0.1:4010` | Runner base URL used by the CLI. |
| `runnerPort` / `AVATAR_RUNNER_PORT` | Runner | `4010` | Local HTTP server port. |
| `dataDir` / `AVATAR_DATA_DIR` | Runner/core | `.avatar` resolved from repo root | Metadata and local blob root. |
| `storageMode` / `AVATAR_STORAGE_MODE` | Runner/core | `local` | Either `local` or `azure-blob`. |
| `azureBlobBaseUrl` / `AVATAR_AZURE_BLOB_BASE_URL` | Runner/core | empty | Azure container URL, including SAS token if required. |
| `replicateApiToken` / `AVATAR_REPLICATE_API_TOKEN` | Provider | empty | Bearer token for Replicate API calls. |
| `replicateModel` / `AVATAR_REPLICATE_MODEL` | Provider | `bytedance/dreamactor-m2.0` | Replicate model ref in `owner/model` format. |
| `providerTimeoutSec` / `AVATAR_PROVIDER_TIMEOUT_SEC` | Provider/service | `600` | Max provider wait before cancellation. |
| `providerPollIntervalMs` / `AVATAR_PROVIDER_POLL_INTERVAL_MS` | Provider/service | `2000` | Delay between provider polls. |

## CLI Specification

The CLI is exposed through `npm run avatar -- <command>`.

### `upload`

Uploads and registers an input asset.

```bash
npm run avatar -- upload <file> --kind reference|driving [--label name]
```

Behavior:

- Reads the file from disk.
- Sends bytes to `POST /assets`.
- Requires `--kind`.
- Uses the local basename as the stored filename.
- Prints the uploaded asset ID and full asset JSON.

### `run`

Creates an asynchronous retargeting run.

```bash
npm run avatar -- run --reference <asset-id> --video <asset-id> [--preset preview-720p] [--provider replicate-dreamactor] [--output-profile preview] [--notes text]
```

Behavior:

- Sends run spec to `POST /runs`.
- Defaults provider to `replicate-dreamactor`.
- Defaults preset to `preview-720p`.
- Defaults output profile to `preview`.
- Prints the submitted run ID and full run JSON.

### `status`

Reads run status.

```bash
npm run avatar -- status <run-id> [--json]
```

Behavior:

- Calls `GET /runs/:runId`.
- Human output includes run state, review status, provider, preset, estimated cost, provider status, provider run ID, failure reason, evaluation score, and evaluation flags.
- `--json` prints the full run JSON.

### `fetch`

Downloads all artifacts for a run.

```bash
npm run avatar -- fetch <run-id> [--output-dir ./outputs]
```

Behavior:

- Calls `GET /runs/:runId`.
- Creates the output directory if needed.
- Downloads every listed artifact through `GET /runs/:runId/artifacts/:artifactId/content`.
- Writes each artifact using its stored filename.
- Prints downloaded file paths.

### `review`

Submits a manual review decision.

```bash
npm run avatar -- review <run-id> --decision approve|reject [--notes text] [--tag name]
```

Behavior:

- Calls `POST /runs/:runId/review`.
- Requires `--decision`.
- Supports repeated `--tag` flags.
- Approval moves the run to `succeeded`.
- Rejection moves the run to `failed`.
- Prints reviewed run JSON.

### `compare`

Compares two runs by evaluation scores and estimated cost.

```bash
npm run avatar -- compare <run-id-a> <run-id-b> [--json]
```

Behavior:

- Fetches both runs.
- Summarizes state, provider, preset, review status, evaluation, and estimated cost.
- Computes deltas for overall score, identity score, motion score, and estimated cost.
- Human mode prints the comparison JSON with a header.
- `--json` prints only the comparison JSON.

## HTTP Runner API

The runner binds to `127.0.0.1` on the configured port.

### `GET /health`

Returns basic service health and available providers.

Response:

```json
{
  "ok": true,
  "defaultProvider": "replicate-dreamactor",
  "providers": ["replicate-dreamactor"]
}
```

### `POST /assets`

Registers an uploaded asset.

Headers:

- `x-avatar-kind`: `reference` or `driving`.
- `x-avatar-filename`: original filename.
- `x-avatar-label`: optional label.
- `content-type`: expected to be `application/octet-stream` from the CLI.

Body:

- Raw file bytes.

Success:

- `201 { "asset": Asset }`

Validation:

- Missing kind or filename returns `400`.
- Unsupported kinds, unsupported extensions, invalid media, and media inspection failures return error JSON.

### `POST /runs`

Creates an asynchronous run.

Request:

```json
{
  "providerId": "replicate-dreamactor",
  "spec": {
    "referenceAssetId": "asset_...",
    "sourceVideoAssetId": "asset_...",
    "presetId": "preview-720p",
    "outputProfile": "preview",
    "notes": ""
  }
}
```

Success:

- `201 { "run": Run }`
- The returned run starts in `queued`.
- Execution is scheduled immediately in-process.

### `GET /runs/:runId`

Returns a run plus any saved review.

Success:

- `200 { "run": RunWithReview }`

### `POST /runs/:runId/review`

Stores a manual review and updates terminal state.

Request:

```json
{
  "decision": "approve",
  "notes": "usable",
  "tags": ["quality"]
}
```

Rules:

- Decision must be `approve` or `reject`.
- Run must be in `needs_review`, `succeeded`, or `failed`.
- `approve` sets state to `succeeded` and review status to `approved`.
- `reject` sets state to `failed`, review status to `rejected`, and records a manual rejection failure.

### `GET /runs/:runId/artifacts/:artifactId/content`

Downloads artifact bytes.

Success headers:

- `content-type`: artifact content type or `application/octet-stream`.
- `content-length`: byte length.
- `content-disposition`: attachment with artifact filename.

## Data Contracts

### Asset

An asset represents an uploaded input.

Fields:

- `id`: generated `asset_<uuid-without-dashes>`.
- `kind`: `reference` or `driving`.
- `label`: optional user label.
- `filename`: original basename.
- `extension`: lower-case extension.
- `contentType`: inferred from extension.
- `checksum`: SHA-256 of uploaded bytes.
- `createdAt`: ISO timestamp.
- `locator`: storage locator.
- `media`: ffprobe-derived metadata.

Supported reference extensions:

- `.png`
- `.jpg`
- `.jpeg`

Supported driving extensions:

- `.mp4`
- `.mov`
- `.webm`

Reference media must have non-zero size, width, and height. Driving media must contain a video stream and have non-zero size, dimensions, and duration.

### Media Metadata

Fields:

- `durationSec`
- `sizeBytes`
- `width`
- `height`
- `codecName`
- `frameRate`
- `formatName`
- `formatNames`
- `hasVideoStream`

### Run

A run captures the full lifecycle of one provider execution.

States:

- `queued`
- `running`
- `needs_review`
- `succeeded`
- `failed`

Key fields:

- `id`: generated `run_<uuid-without-dashes>`.
- `state`: current lifecycle state.
- `reviewStatus`: starts as `pending`, later `approved` or `rejected`.
- `providerId`: provider key.
- `provider`: provider execution snapshot.
- `presetId`: selected preset.
- `outputProfile`: defaults to `preview`.
- `notes`: user notes.
- `referenceAssetId`
- `sourceVideoAssetId`
- `artifacts`: generated artifacts.
- `attempts`: incremented when execution starts.
- `cost.estimatedUsd`
- `evaluation`: null until output evaluation succeeds.
- `failure`: normalized provider/manual failure object.
- `failureReason`: display-friendly failure message.
- `lineage`: immutable-ish links to inputs, provider payload artifacts, and final output metadata.
- `createdAt`
- `updatedAt`
- `startedAt`
- `completedAt`

### Provider Snapshot

Fields:

- `id`
- `displayName`
- `modelId`
- `runId`
- `status`
- `submittedAt`
- `startedAt`
- `completedAt`
- `lastPolledAt`
- `pollCount`

### Artifact

Artifacts are persisted under a run and downloadable through the runner.

Fields:

- `id`: generated `artifact_<uuid-without-dashes>`.
- `kind`
- `filename`
- `locator`
- `contentType`
- `createdAt`
- `metadata`

Implemented artifact kinds:

- `provider_submit_request`
- `provider_submit_response`
- `provider_poll_response`
- `provider_terminal_response`
- `provider_cancel_response`
- `retargeted_video`

### Review

Fields:

- `runId`
- `decision`: `approve` or `reject`.
- `notes`
- `tags`
- `reviewedAt`

### Failure

Failure codes:

- `provider_auth`
- `provider_rate_limited`
- `provider_timeout`
- `provider_unavailable`
- `provider_validation`
- `provider_rejected_input`
- `provider_run_failed`
- `provider_canceled`
- `provider_output_missing`
- `provider_download_failed`
- `provider_unknown`

Failure object fields:

- `code`
- `message`
- `retryable`
- `providerStatus`
- `details`

## Presets

### `preview-720p`

- Label: `Landscape preview`
- Max duration: 10 seconds
- Size: 1280x720
- Aspect ratio: 16:9
- Identity strength: 0.8
- Motion strength: 0.75
- Replicate option `cut_first_second`: false

### `vertical-720p`

- Label: `Vertical short`
- Max duration: 10 seconds
- Size: 720x1280
- Aspect ratio: 9:16
- Identity strength: 0.8
- Motion strength: 0.75
- Replicate option `cut_first_second`: false

### `square-512`

- Label: `Square experiment`
- Max duration: 8 seconds
- Size: 512x512
- Aspect ratio: 1:1
- Identity strength: 0.7
- Motion strength: 0.7
- Replicate option `cut_first_second`: false

## Storage

### Local Storage

Local mode stores files under `<dataDir>/blobs`.

Input object paths:

- `inputs/reference/<assetId><extension>`
- `inputs/driving/<assetId><extension>`

Output object paths:

- `outputs/<runId>/<artifactId><extension>`

Local locators have shape:

```json
{
  "type": "local",
  "path": "/absolute/path/to/blob"
}
```

### Azure Blob Storage

Azure mode stores files by issuing `PUT` requests to URLs derived from `AVATAR_AZURE_BLOB_BASE_URL`.

Rules:

- The base URL may include SAS query parameters.
- Duplicate slashes around relative blob paths are normalized.
- Uploaded blobs use `x-ms-blob-type: BlockBlob`.
- Reads download the full blob with `fetch`.
- Streaming Azure Blob artifacts is not supported in the current minimal implementation.

Azure locators have shape:

```json
{
  "type": "azure-blob",
  "url": "https://acct.blob.core.windows.net/container/path?sv=..."
}
```

When a provider needs file paths, Azure-backed assets are materialized to temporary local files and cleaned up after the run.

## Metadata Persistence

The file job store persists JSON metadata under `dataDir`.

Paths:

- Assets: `<dataDir>/assets/<assetId>.json`
- Runs: `<dataDir>/runs/<runId>.json`
- Reviews: `<dataDir>/reviews/<runId>.json`

Writes are performed by writing a `.tmp` file and renaming it into place.

## Provider Specification

### Default Provider

Provider ID:

- `replicate-dreamactor`

Display name:

- `Replicate DreamActor M2.0`

Default model:

- `bytedance/dreamactor-m2.0`

### Replicate Run Validation

The provider validates inputs before creating the run.

Reference constraints:

- Must be configured with `AVATAR_REPLICATE_API_TOKEN`.
- Width must be between 480 and 1920.
- Height must be between 480 and 1080.
- Size, width, and height must be non-zero.

Driving video constraints:

- Must contain a video stream.
- Size and duration must be non-zero.
- Width must be between 200 and 2048.
- Height must be between 200 and 1440.
- Duration must not exceed the preset max duration, capped at 30 seconds.

### Replicate Request

The provider posts to:

```text
https://api.replicate.com/v1/models/<owner>/<model>/predictions
```

Headers:

- `authorization: Bearer <token>`
- `content-type: application/json`
- `prefer: wait=1`
- `Cancel-After: <timeoutSec>s` on submission

Input body:

```json
{
  "input": {
    "image": "<reference URL or data URL>",
    "video": "<driving URL or data URL>",
    "cut_first_second": false
  }
}
```

For Azure Blob locators, the provider uses the blob URL directly. For local locators, it converts file bytes into a data URL.

### Provider Polling

Execution flow:

1. Run moves from `queued` to `running`.
2. Provider submission is persisted as request and response JSON artifacts.
3. Provider state is polled until success, failure, cancellation, or timeout.
4. Every poll response is persisted as a JSON artifact.
5. Terminal response is persisted when a terminal status is observed.
6. Timeout attempts cancellation and persists a cancel response artifact when available.
7. On success, output URL is downloaded and persisted as a `retargeted_video` artifact.
8. Output metadata and evaluation are computed.
9. Successful provider output moves the run to `needs_review`.

Terminal success statuses:

- `succeeded`
- `successful`

Terminal failure statuses:

- `failed`
- `canceled`
- `cancelled`

### Provider Failure Mapping

Replicate HTTP errors map to normalized failures:

- `401` or `403`: `provider_auth`
- `429`: `provider_rate_limited`, retryable
- `400` or `422`: `provider_validation`
- `5xx`: `provider_unavailable`, retryable
- Other non-OK responses: `provider_unknown`

Terminal provider failures map to:

- Canceled/cancelled status: `provider_canceled`
- Error text mentioning input, dimension, duration, or unsupported: `provider_rejected_input`
- Other terminal failure: `provider_run_failed`

Output collection failures map to:

- Missing output URL: `provider_output_missing`
- Output download non-OK response: `provider_download_failed`

## Evaluation

After output collection, the service computes lightweight metrics using `ffmpeg`/`ffprobe`.

Metrics:

- `outputValid`: output has non-zero size and duration.
- `durationDeltaSec`: absolute difference between source and output duration.
- `sceneChangeRate`: count of scene changes above threshold divided by output duration.
- `identityScore`: SSIM between reference image and first output frame, clamped to `[0, 1]`.
- `motionScore`: SSIM between source video and output video, clamped to `[0, 1]`.
- `flickerScore`: `1 - sceneChangeRate / 5`, clamped to `[0, 1]`.
- `overallScore`: average of identity, motion, and flicker scores, clamped to `[0, 1]`.

Flags:

- `broken_output`: output is missing size or duration.
- `duration_mismatch`: duration delta is greater than 0.35 seconds.
- `possible_flicker`: scene change rate is greater than 3.
- `low_identity_similarity`: identity score is below 0.35.
- `low_motion_similarity`: motion score is below 0.75.

## Run Lifecycle

```text
queued
  -> running
  -> needs_review
      -> succeeded when manually approved
      -> failed when manually rejected
  -> failed on provider validation, request, timeout, terminal failure, download, or unexpected errors
```

Runs are executed in-process with an active run set to avoid duplicate concurrent execution of the same run ID in one service instance.

## Tested Behavior

The current test suite covers:

- Async service runs persist provider lineage and final output metadata.
- Timeout failures record `provider_timeout` and cancellation lineage.
- Remote/Azure-like locators are materialized and cleaned up.
- Replicate provider validates media constraints at run creation.
- Unsupported upload media is rejected.
- Replicate input construction from presets.
- Replicate HTTP, terminal, missing-output, and timeout failure normalization.
- Azure Blob URL construction with and without SAS query parameters.
- Runner handler support for health, upload, run, artifact fetch, and review.
- Evaluation returns stable metrics for a valid output video.

The root test command is:

```bash
npm test
```

## Known Limitations And Non-Goals

- Metadata persistence is local JSON on disk, not a remote database.
- There is no multi-worker queue or distributed locking.
- Runs execute inside the runner process.
- There is no authentication or authorization on the runner API.
- Azure Blob support is minimal and assumes the provided base URL/SAS is valid for read and write operations.
- Artifact streaming from Azure Blob is not implemented.
- Cost tracking is provider-reported or placeholder; Replicate output currently records estimated cost as `0`.
- Evaluation is heuristic and not a substitute for human review.
- Manual review has only approve/reject decisions.
- There is no retry command or cancellation endpoint exposed through the HTTP API or CLI.
- There is no UI beyond the CLI.
- Mock providers are not registered by default in production configuration.
