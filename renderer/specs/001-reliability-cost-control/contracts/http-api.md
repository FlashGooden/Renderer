# HTTP API Contracts: Phase 3

**Date**: 2026-05-11
**Package**: `packages/cloud-runner/src/server.ts`

Phase 3 adds four new endpoints and modifies one existing endpoint. All existing endpoints
are unchanged.

---

## New Endpoints

### `GET /runs`

List runs, optionally filtered by state.

**Query parameters**:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `state` | comma-separated `RunState` | (all) | Filter to runs in these states |
| `limit` | integer | `100` | Max runs to return (max `500`) |
| `include_archived` | `"true"` | `false` | Include archived runs in results |

**Response**: `200 OK`

```json
{
  "runs": [<Run>, ...]
}
```

**Error responses**:

| Status | Body | When |
|---|---|---|
| `400` | `{ "error": "..." }` | Invalid `state` value or `limit` out of range |

**Notes**:
- Archived runs are excluded by default. Pass `?include_archived=true` to include them.
- Archived runs have `archived: true` in the response.
- Results are not sorted; clients should sort by `createdAt` or `updatedAt` if needed.

---

### `POST /runs/:runId/retry`

Re-queues a run that is in `dead_lettered` or `failed` state.

**Path parameters**: `runId` — the run ID.

**Request body**: empty or `{}`.

**Response**: `200 OK`

```json
{
  "run": <Run>
}
```

**State transitions**:
- `state` → `"queued"`
- `deadLetteredAt` → `null`
- `deadLetterReason` → `null`
- `failure` → `null`
- `failureReason` → `null`
- `retryState` → `{ "nextRetryAt": null, "exhausted": false }`
- New `QueueEntry` written to `queue/pending/` with `scheduledAt = now`

**Error responses**:

| Status | Body | When |
|---|---|---|
| `404` | `{ "error": "Run '<id>' was not found." }` | Run does not exist |
| `409` | `{ "error": "Run '<id>' is not in dead_lettered or failed state." }` | Run in any other state |

---

### `POST /maintenance/cleanup`

Triggers a server-side cleanup sweep.

**Request body** (optional):

```json
{
  "scope": ["temp", "artifacts", "metadata"],
  "dryRun": false
}
```

- `scope`: array of cleanup types to run. Omit or pass all three for full sweep.
- `dryRun`: if `true`, compute what would be deleted without deleting. Default `false`.

**Response**: `200 OK`

```json
{
  "dryRun": false,
  "tempFiles": {
    "deleted": 12,
    "bytes": 50647040
  },
  "artifacts": {
    "pruned": 34,
    "bytes": 2254857830,
    "runIds": ["run_abc123", "run_def456"]
  },
  "metadata": {
    "archived": 5,
    "runIds": ["run_aaa111", "run_bbb222"]
  }
}
```

Fields for scopes not included in the request are omitted from the response.

**Error responses**:

| Status | Body | When |
|---|---|---|
| `400` | `{ "error": "..." }` | Invalid `scope` value |

---

### `GET /metrics`

Returns current in-memory `RunnerMetrics`. Resets on process restart.

**Response**: `200 OK`

```json
{
  "runs": {
    "queuedTotal": 42,
    "startedTotal": 41,
    "succeededTotal": 38,
    "failedTotal": 2,
    "deadLetteredTotal": 1,
    "retriedTotal": 3,
    "activeNow": 1
  },
  "queue": {
    "pendingNow": 2,
    "processingNow": 1
  },
  "durations": {
    "samples": 38,
    "sumMs": 720400,
    "p50Ms": 18420,
    "p95Ms": 32100,
    "p99Ms": null
  },
  "costs": {
    "totalEstimatedUsd": 0.117,
    "totalProviderUsd": 0.105,
    "totalStorageUsd": 0.012
  },
  "cleanup": {
    "lastRunAt": "2026-05-09T14:32:00.000Z",
    "tempFilesDeletedTotal": 24,
    "artifactsPrunedTotal": 34,
    "runsArchivedTotal": 5
  }
}
```

`p99Ms` is `null` until at least 1 sample exists (same for `p50Ms`, `p95Ms`).

---

## Modified Endpoints

### `GET /runs/:runId` (existing)

No change to the request contract. The response `Run` object gains Phase 3 fields when present:

```json
{
  "run": {
    "...": "existing fields unchanged",
    "retryState": { "nextRetryAt": null, "exhausted": false },
    "deadLetteredAt": null,
    "deadLetterReason": null,
    "cost": {
      "estimatedUsd": 0.0031,
      "breakdown": {
        "providerUsd": 0.0028,
        "storageReadUsd": 0.0001,
        "storageWriteUsd": 0.0002,
        "storageReadBytes": 12300000,
        "storageWriteBytes": 24100000,
        "computeMs": 20500,
        "computeUsd": 0.0
      }
    }
  }
}
```

Archived runs additionally include `"archived": true` at the top level of the `run` object.

---

## Full API Endpoint Index

| Method | Path | Phase | Description |
|---|---|---|---|
| `GET` | `/health` | 1 | Service health check |
| `POST` | `/assets` | 1 | Register an uploaded asset |
| `POST` | `/runs` | 1 | Create an async retargeting run |
| `GET` | `/runs` | **3** | List runs with optional state filter |
| `GET` | `/runs/:runId` | 1 | Get run by ID (now returns Phase 3 fields) |
| `POST` | `/runs/:runId/review` | 1 | Submit manual review |
| `POST` | `/runs/:runId/retry` | **3** | Re-queue a failed/dead-lettered run |
| `GET` | `/runs/:runId/artifacts/:artifactId/content` | 1 | Download artifact content |
| `POST` | `/maintenance/cleanup` | **3** | Trigger cleanup sweep |
| `GET` | `/metrics` | **3** | Runner metrics |
