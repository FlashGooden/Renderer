# Data Model: Phase 3 — Reliability and Cost Control

**Date**: 2026-05-11
**Feature**: Phase 3 additions to `packages/core/src/types.ts` and `config.ts`

All changes are additive. Existing types are listed for context where modified.

---

## 1. RunState (extended)

```ts
// Before (types.ts:9)
type RunState = "queued" | "running" | "needs_review" | "succeeded" | "failed";

// After
type RunState = "queued" | "running" | "needs_review" | "succeeded" | "failed" | "dead_lettered";
```

`dead_lettered` is a terminal state that blocks automatic re-queue. Only `POST /runs/:id/retry`
can move a run out of this state.

---

## 2. RetryPolicy

```ts
interface RetryPolicy {
  maxAttempts: number;           // inclusive total; 1 = no retries
  backoffStrategy: "fixed" | "exponential";
  backoffBaseMs: number;
  backoffMaxMs: number;
  jitterFactor: number;          // 0–1; fraction of computed delay as uniform random jitter
}
```

**Per-failure-class default policy table** (keyed by `FailureCode`):

| Failure code | maxAttempts | backoffStrategy | backoffBaseMs | backoffMaxMs | jitterFactor |
|---|---|---|---|---|---|
| `provider_rate_limited` | 5 | exponential | 5000 | 120000 | 0.2 |
| `provider_unavailable` | 3 | exponential | 10000 | 60000 | 0.2 |
| `provider_timeout` | 2 | fixed | 0 | 0 | 0 |
| `provider_output_missing` | 2 | fixed | 2000 | 2000 | 0 |
| `provider_download_failed` | 3 | fixed | 3000 | 3000 | 0 |
| all other codes | 1 | — | — | — | — |

`maxAttempts = 1` means no retries (first attempt is the only attempt).

Custom `retryPolicy` may be passed in `POST /runs`. It cannot make a non-retryable code retryable
(codes not in the retryable set above are always dead-lettered on first failure).

---

## 3. RetryState

```ts
interface RetryState {
  nextRetryAt: string | null;    // ISO timestamp; null when no retry is scheduled
  exhausted: boolean;            // true when maxAttempts reached for current failure class
}
```

Default value on `Run` creation: `{ nextRetryAt: null, exhausted: false }`.
Updated on every failure. Cleared when `POST /runs/:id/retry` resets the run.

**Backward compatibility**: `getRun` in `FileJobStore` should return the default `RetryState`
when the field is absent in persisted JSON (handle via `?? { nextRetryAt: null, exhausted: false }`).

---

## 4. Run (additions)

```ts
interface Run {
  // ... existing fields unchanged ...

  // Phase 3 additions
  retryState: RetryState;
  deadLetteredAt: string | null;
  deadLetterReason: "non_retryable_failure" | "retries_exhausted" | "stuck_run" | null;
  cost: RunCost;               // replaces { estimatedUsd: number }
  archived?: true;             // set only when returned from archive path
}
```

**Lifecycle state diagram**:

```
queued → running → needs_review → succeeded
                               → failed (manual reject)
       → (retryable failure) → queued (new QueueEntry, scheduledAt = nextRetryAt)
       → (non-retryable or exhausted) → dead_lettered
       → (stuck) → dead_lettered
dead_lettered → (POST /retry) → queued
```

---

## 5. RunCost

```ts
interface RunCost {
  estimatedUsd: number;          // sum of all USD components
  breakdown: {
    providerUsd: number;         // predict_time * replicateCostPerSecondUsd
    storageReadUsd: number;      // readBytes / 1e9 * readUsdPerGb
    storageWriteUsd: number;     // writeBytes / 1e9 * writeUsdPerGb
    storageReadBytes: number;
    storageWriteBytes: number;
    computeMs: number;           // completedAt - startedAt (wall clock)
    computeUsd: number;          // computeMs * computeUsdPerMs
  };
}
```

Replaces `Run.cost: { estimatedUsd: number }`. All fields default to `0`.
Cost is persisted even on failed runs (partial cost is meaningful).

---

## 6. QueueEntry

```ts
interface QueueEntry {
  id: string;             // "queue_" + uuid without dashes
  runId: string;
  enqueuedAt: string;     // ISO timestamp, time of write
  scheduledAt: string;    // ISO timestamp; worker skips when scheduledAt > now
  attempt: number;        // 1-indexed attempt number this entry represents
}
```

**File layout**:
```
<dataDir>/
  queue/
    pending/<queueEntryId>.json    ← waiting to be claimed
    processing/<queueEntryId>.json ← currently executing
```

The `queue/` directory is created by `AvatarService.initialize()`.

Claim primitive: `fs.rename(pending/<id>.json, processing/<id>.json)`. Atomic on POSIX.
If rename fails (ENOENT), another worker claimed it — skip silently.

---

## 7. RunnerMetrics

```ts
interface RunnerMetrics {
  runs: {
    queuedTotal: number;
    startedTotal: number;
    succeededTotal: number;
    failedTotal: number;
    deadLetteredTotal: number;
    retriedTotal: number;
    activeNow: number;
  };
  queue: {
    pendingNow: number;
    processingNow: number;
  };
  durations: {
    samples: number;
    sumMs: number;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
  };
  costs: {
    totalEstimatedUsd: number;
    totalProviderUsd: number;
    totalStorageUsd: number;
  };
  cleanup: {
    lastRunAt: string | null;
    tempFilesDeletedTotal: number;
    artifactsPrunedTotal: number;
    runsArchivedTotal: number;
  };
}
```

In-memory only. Resets on process restart.
Percentiles use last 1000 duration samples in a ring buffer; `null` until ≥1 sample.

---

## 8. StorageDriver (interface change)

```ts
interface StorageDriver {
  initialize(): Promise<void>;
  putBuffer(relativePath: string, buffer: Buffer, contentType?: string): Promise<{ locator: StorageLocator; bytes: number }>;
  putFile(relativePath: string, sourcePath: string, contentType?: string): Promise<{ locator: StorageLocator; bytes: number }>;
  readBuffer(locator: StorageLocator): Promise<{ buffer: Buffer; bytes: number }>;
  createReadStream?(locator: StorageLocator): any;
}
```

All existing call sites destructure `locator` from the result. `bytes` is used only in
`CostAccumulator` within `AvatarService.executeRun`.

---

## 9. JobStore (interface additions)

```ts
interface JobStore {
  // ... existing methods unchanged ...

  listRuns(options?: {
    state?: RunState[];           // filter; empty/absent = all states
    limit?: number;               // default 100, max 500
    includeArchived?: boolean;    // default false
  }): Promise<Run[]>;

  archiveRun(runId: string): Promise<void>;
}
```

`FileJobStore` implements these by scanning `<dataDir>/runs/` (and optionally
`<dataDir>/archive/runs/`), reading JSON, applying filters, and returning up to `limit` results.

**Archive path**: `<dataDir>/archive/runs/<runId>.json`
- `archiveRun` moves `runs/<runId>.json` → `archive/runs/<runId>.json`.
- `getRun` checks archive when live path returns `null` and returns run with `archived: true`.

---

## 10. ProjectConfig (additions)

```ts
interface ProjectConfig {
  // ... existing fields unchanged ...

  // Queue
  queuePollIntervalMs: number;       // AVATAR_QUEUE_POLL_INTERVAL_MS, default 500
  queueMaxConcurrent: number;        // AVATAR_QUEUE_MAX_CONCURRENT, default 2
  staleRunThresholdMs: number;       // AVATAR_STALE_RUN_THRESHOLD_MS, default providerTimeoutSec * 2 * 1000
  staleRunSweepIntervalMs: number;   // AVATAR_STALE_RUN_SWEEP_INTERVAL_MS, default 60000

  // Cleanup
  tempFileMaxAgeSec: number;         // AVATAR_TEMP_FILE_MAX_AGE_SEC, default 3600
  artifactRetentionDays: number;     // AVATAR_ARTIFACT_RETENTION_DAYS, default 30
  videoRetentionDays: number;        // AVATAR_VIDEO_RETENTION_DAYS, default 90
  metadataRetentionDays: number;     // AVATAR_METADATA_RETENTION_DAYS, default 180

  // Cost
  replicateCostPerSecondUsd: number; // AVATAR_REPLICATE_COST_PER_SEC_USD, default 0.00055
  azureBlobWriteUsdPerGb: number;    // AVATAR_AZURE_BLOB_WRITE_USD_PER_GB, default 0.0
  azureBlobReadUsdPerGb: number;     // AVATAR_AZURE_BLOB_READ_USD_PER_GB, default 0.0
  computeUsdPerMs: number;           // AVATAR_COMPUTE_USD_PER_MS, default 0.0
}
```

---

## 11. LogEntry

```ts
interface LogEntry {
  ts: string;                  // ISO timestamp
  level: "debug" | "info" | "warn" | "error";
  msg: string;
  runId?: string;
  assetId?: string;
  queueEntryId?: string;
  durationMs?: number;
  failureCode?: string;
  retryAttempt?: number;
  [key: string]: unknown;      // additional fields spread as top-level keys
}
```

The logger is a module in `packages/core/src/logger.ts` with no external dependencies.
Output format is controlled by:
- `LOG_FORMAT=json` or non-TTY stdout → NDJSON (one JSON object per line on `process.stdout`)
- `LOG_FORMAT=pretty` or TTY stdout → `[timestamp] LEVEL  msg  key=value ...` with ANSI color
- `LOG_LEVEL` → minimum level (default `info`); values: `debug`, `info`, `warn`, `error`

---

## 12. CostAccumulator (internal)

Not exported. Used only within `AvatarService.executeRun`.

```ts
class CostAccumulator {
  readBytes: number = 0;
  writeBytes: number = 0;
  startedAt: number;           // Date.now() at executeRun start

  constructor() {
    this.startedAt = Date.now();
  }

  recordRead(bytes: number): void;
  recordWrite(bytes: number): void;

  toBreakdown(rates: {
    readUsdPerGb: number;
    writeUsdPerGb: number;
    computeUsdPerMs: number;
    providerUsd: number;
    completedAt?: number;
  }): RunCost;
}
```

`toBreakdown` computes `computeMs = (completedAt ?? Date.now()) - startedAt` and returns the
full `RunCost` with `estimatedUsd` as the sum of all components.

---

## Artifact Retention Reference

| Artifact kind | Retention config key |
|---|---|
| `provider_submit_request` | `artifactRetentionDays` |
| `provider_submit_response` | `artifactRetentionDays` |
| `provider_poll_response` | `artifactRetentionDays` |
| `provider_terminal_response` | `artifactRetentionDays` |
| `provider_cancel_response` | `artifactRetentionDays` |
| `preview_still` | `artifactRetentionDays` |
| `contact_sheet` | `artifactRetentionDays` |
| `retargeted_video` | `videoRetentionDays` |

Pruning does not change `Run.state`. Artifact entries are removed from `Run.artifacts` and
lineage references are nulled. The updated run JSON is written back to disk.
Active-run artifacts are never pruned (checked against `activeRuns` set).
