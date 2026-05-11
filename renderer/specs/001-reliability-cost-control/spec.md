# Feature Specification: Phase 3 — Reliability and Cost Control

**Feature Branch**: `001-reliability-cost-control`
**Created**: 2026-05-11
**Status**: Draft
**Phase**: 3 (builds on Phase 1 MVP; all existing behavior remains unless explicitly overridden)

## User Scenarios & Testing

### User Story 1 — Automatic Retry on Transient Failures (Priority: P1)

An operator submits a retargeting run and it fails because Replicate is rate-limiting or temporarily
unavailable. Rather than the run going straight to `failed` and requiring manual resubmission, the
system automatically retries the run according to a per-failure-class backoff schedule.

**Why this priority**: Rate limits and temporary provider unavailability are the most frequent
causes of run failures in production. Without automatic retry, every such failure requires manual
operator intervention to re-queue the run.

**Independent Test**: Submit a run using the mock provider configured to return
`provider_rate_limited` on the first two attempts and succeed on the third. Verify the run
ultimately reaches `succeeded` state with `attempts = 3` and that `retryState.nextRetryAt` was
non-null between attempts.

**Acceptance Scenarios**:

1. **Given** a run that fails with `provider_rate_limited`, **When** the failure is processed,
   **Then** the run transitions back to `queued` with a scheduled retry at `now + backoff`, and
   `run.attempts` is incremented.
2. **Given** a run that fails with `provider_auth`, **When** the failure is processed, **Then**
   the run immediately transitions to `dead_lettered` with `deadLetterReason = "non_retryable_failure"`.
3. **Given** a run that has exhausted all allowed retry attempts for `provider_rate_limited`,
   **When** the next failure occurs, **Then** `retryState.exhausted = true` and the run transitions
   to `dead_lettered` with `deadLetterReason = "retries_exhausted"`.
4. **Given** a caller who passes a custom `retryPolicy` in `POST /runs`, **When** the policy
   narrows the default max attempts, **Then** the run exhausts retries at the custom limit. The
   caller cannot make a non-retryable failure code retryable via a custom policy.

---

### User Story 2 — Dead-Letter Queue and Manual Recovery (Priority: P1)

An operator needs to know when a run has permanently failed — whether due to a non-retryable
error, exhausted retries, or a stuck process — and must be able to inspect those runs and
re-queue them after investigation.

**Why this priority**: Without a dead-letter mechanism, permanently failed runs are
indistinguishable from transient failures and operators have no structured recovery path.

**Independent Test**: Force a run to `dead_lettered` state via a non-retryable failure. Run
`avatar dead-letters` and confirm the run appears with its reason and failure code. Then run
`avatar retry <run-id>` and confirm the run transitions back to `queued` and eventually completes.

**Acceptance Scenarios**:

1. **Given** a run in `dead_lettered` state, **When** the operator runs `avatar dead-letters`,
   **Then** the run appears in the output with columns: run ID, dead-letter reason, failure code,
   attempts, dead-lettered at.
2. **Given** a run in `dead_lettered` state, **When** `POST /runs/:runId/retry` is called,
   **Then** `state` resets to `queued`, `deadLetteredAt` and `deadLetterReason` are cleared,
   `retryState` resets, and a new queue entry is written with `scheduledAt = now`.
3. **Given** a run that has been in `running` or `queued` state for longer than
   `staleRunThresholdMs`, **When** the stuck-run sweep executes, **Then** the run is
   dead-lettered with `deadLetterReason = "stuck_run"`.
4. **Given** a run in `succeeded` or `needs_review` state, **When** `POST /runs/:runId/retry`
   is called, **Then** the request is rejected (non-2xx response).

---

### User Story 3 — Durable Queue with Crash Recovery (Priority: P1)

An operator restarts the runner process (e.g., after a crash or deployment). Runs that were
`queued` or mid-execution at the time of the crash are automatically recovered and re-submitted
without any manual intervention.

**Why this priority**: The current in-memory dispatch loses all queued work on process restart.
A single crash can silently drop jobs with no recovery path.

**Independent Test**: Start the runner, create two runs, then kill the process while they are in
`running` state. Restart the runner. Verify that orphaned `queue/processing/` entries are moved
back to `queue/pending/` (logged as `queue.orphan_recovered`) and the runs are re-executed.

**Acceptance Scenarios**:

1. **Given** queue entries in `queue/processing/` from a crashed prior process, **When** the
   service initializes, **Then** each orphaned entry is moved back to `queue/pending/` with
   `attempt` incremented, and `queue.orphan_recovered` is logged per entry.
2. **Given** a run created via `POST /runs`, **When** `createRun` completes, **Then** a
   `QueueEntry` JSON file exists in `queue/pending/` with `scheduledAt = now` (not dispatched
   via `setImmediate`).
3. **Given** two runs queued simultaneously and `queueMaxConcurrent = 1`, **When** the worker
   polls, **Then** only one run executes at a time; the second waits until the first completes.
4. **Given** a retry scheduled for a future `nextRetryAt`, **When** the worker polls before
   that time, **Then** the entry is skipped; after that time it is claimed and executed.

---

### User Story 4 — Automated Cleanup of Stale Files and Expired Artifacts (Priority: P2)

An operator's disk and storage costs grow over time as runs accumulate temp files, artifact blobs,
and run metadata. The operator can trigger a cleanup sweep — via CLI or API — to reclaim space
according to configurable retention policies, and can preview what would be deleted with `--dry-run`.

**Why this priority**: Without automated cleanup, storage costs grow unbounded. This is a
maintenance feature that directly reduces cost but does not block core functionality.

**Independent Test**: Create several completed runs older than `artifactRetentionDays`. Run
`avatar cleanup --artifacts --dry-run` and confirm the output lists the artifacts that would be
pruned without deleting them. Then run without `--dry-run` and verify the blobs are deleted and
removed from `Run.artifacts`.

**Acceptance Scenarios**:

1. **Given** orphaned temp files in `os.tmpdir()/avatar-project/` older than `tempFileMaxAgeSec`,
   **When** `avatar cleanup --temp` runs, **Then** those files are deleted; files belonging to
   active runs are preserved.
2. **Given** artifact blobs for a run in `succeeded` state where `completedAt` is older than
   `artifactRetentionDays`, **When** `avatar cleanup --artifacts` runs, **Then** the blobs are
   deleted and the artifact entries are removed from `Run.artifacts` (run state is unchanged).
3. **Given** `retargeted_video` artifacts for a run older than `videoRetentionDays`, **When**
   cleanup runs, **Then** the video blob is deleted (video retention is separate from
   `artifactRetentionDays`).
4. **Given** `--dry-run` flag, **When** any cleanup scope runs, **Then** output describes what
   would be deleted but no files are modified.
5. **Given** run JSON files for `succeeded` or `failed` runs where `completedAt` is older than
   `metadataRetentionDays`, **When** `avatar cleanup --metadata` runs, **Then** those JSON files
   are moved to `<dataDir>/archive/runs/` and remain accessible via `GET /runs/:runId` with
   `archived: true`.
6. **Given** `POST /maintenance/cleanup` is called with a `scope` array and `dryRun` flag,
   **When** the server processes it, **Then** it returns counts and byte totals for each scope.

---

### User Story 5 — Real Cost Visibility Per Run (Priority: P2)

An operator running avatar generation jobs wants to understand what each run actually cost —
broken down by provider GPU time, storage I/O, and compute — so they can make informed decisions
about presets, retention policies, and deployment configuration.

**Why this priority**: The current `estimatedUsd` field is always `0` because Replicate does not
populate it. Without real cost data the operator cannot assess or control spend.

**Independent Test**: Submit a run against the real Replicate provider. After completion, run
`avatar status <run-id>` and confirm a non-zero cost line appears. Run `avatar status <run-id>
--verbose` and confirm the breakdown shows `providerUsd`, `storageWriteUsd`, `storageReadUsd`,
and `computeMs`.

**Acceptance Scenarios**:

1. **Given** a completed run where Replicate returned `metrics.predict_time`, **When** the
   operator runs `avatar status <run-id>`, **Then** the output includes a `Cost` line with a
   non-zero `providerUsd` value derived from `predict_time * replicateCostPerSecondUsd`.
2. **Given** a completed run, **When** `avatar status <run-id> --verbose` is run, **Then** the
   output shows the full breakdown: provider GPU cost, storage write, storage read, compute ms,
   and total.
3. **Given** a run that fails mid-execution (partial cost incurred), **When** the run reaches
   `failed` or `dead_lettered`, **Then** `Run.cost` is persisted with whatever cost was
   accumulated up to the failure point.
4. **Given** `AVATAR_REPLICATE_COST_PER_SEC_USD` is set to a custom value, **When** a run
   completes, **Then** `providerUsd` uses the configured rate.
5. **Given** a run where Replicate does not return `predict_time`, **When** the run completes,
   **Then** `providerUsd = 0` and a `warn`-level log entry notes that cost data is unavailable.

---

### User Story 6 — Structured Logs and Runtime Metrics (Priority: P3)

An operator monitoring the runner service needs machine-parseable structured logs for integration
with log aggregation tools, and a real-time metrics endpoint to understand queue depth, run
success/failure rates, duration percentiles, and cumulative cost — without restarting the process
or grepping through unstructured output.

**Why this priority**: Structured logging and metrics are observability foundations that enable
all monitoring and alerting. Lower priority than core reliability features (P1/P2) because the
system functions without them, but they are essential for production confidence.

**Independent Test**: Start the runner with `LOG_FORMAT=json`. Submit and complete a run. Verify
that every log line is valid JSON with `ts`, `level`, `msg`, and `runId` fields. Then call
`GET /metrics` (or `avatar metrics`) and confirm the response contains `runs.succeededTotal ≥ 1`
and non-null `durations.p50Ms` after enough samples.

**Acceptance Scenarios**:

1. **Given** `LOG_FORMAT=json`, **When** any run lifecycle event occurs (queued, started,
   succeeded, failed, retried, dead-lettered), **Then** the log line is valid NDJSON with
   required fields (`ts`, `level`, `msg`).
2. **Given** `LOG_FORMAT=pretty` or a TTY environment, **When** events occur, **Then** log output
   uses `[timestamp] LEVEL  msg  key=value` format with ANSI color.
3. **Given** the runner has processed at least one run, **When** `GET /metrics` is called,
   **Then** the response includes accurate `runs.succeededTotal`, `runs.failedTotal`,
   `queue.pendingNow`, and `costs.totalEstimatedUsd`.
4. **Given** the runner has completed more than one run, **When** `GET /metrics` is called,
   **Then** `durations.p50Ms` is non-null and reflects the median run duration.
5. **Given** `avatar metrics --json`, **When** executed, **Then** raw `RunnerMetrics` JSON is
   printed; without `--json`, a human-readable summary is printed.
6. **Given** the process restarts, **When** `GET /metrics` is called immediately after startup,
   **Then** all counters start at `0` (metrics are in-memory, not persisted).

---

### Edge Cases

- What happens when `queue/pending/` and `queue/processing/` are missing at startup? (`initialize()` creates them.)
- What happens when the rename from `pending/` to `processing/` fails (race)? (Entry is skipped; another worker claimed it — safe to ignore.)
- What happens when a SAS token lacks delete permission during artifact pruning? (Pruning fails for that blob; error is logged; other blobs continue.)
- What happens when `predict_time` is `0` in the Replicate response? (`providerUsd = 0`; no warning — `0` is a valid value distinct from absent.)
- What happens when `metadataRetentionDays` is set to `0`? (Runs are archived immediately on terminal state — document as a supported configuration.)
- What happens when an archived run's JSON is corrupted? (`GET /runs/:runId` returns a 500 with the error; the archive file is not auto-deleted.)

## Requirements

### Functional Requirements

**Retry Policy**

- **FR-001**: The system MUST automatically retry runs that fail with retryable failure codes
  (`provider_rate_limited`, `provider_unavailable`, `provider_timeout`, `provider_output_missing`,
  `provider_download_failed`) using the per-failure-class retry table.
- **FR-002**: The system MUST apply configurable exponential or fixed backoff with jitter between
  retry attempts.
- **FR-003**: Callers MUST be able to supply a custom `retryPolicy` in `POST /runs` to widen or
  narrow defaults; custom policies MUST NOT make non-retryable failure codes retryable.
- **FR-004**: `Run.retryState` MUST be initialized to `{ nextRetryAt: null, exhausted: false }`
  and updated on every failure.

**Dead-Letter Handling**

- **FR-005**: The system MUST transition runs to `dead_lettered` state when: (a) a non-retryable
  failure code occurs, (b) retry attempts are exhausted, or (c) a stuck-run sweep detects the run
  is stale.
- **FR-006**: `dead_lettered` runs MUST NOT be automatically re-queued by the worker; they MUST
  require explicit operator action via `POST /runs/:runId/retry` or `avatar retry <run-id>`.
- **FR-007**: The stuck-run sweep MUST execute at service startup and every `staleRunSweepIntervalMs`
  thereafter.
- **FR-008**: `GET /runs` MUST support `?state=<RunState>` filtering (comma-separated) and
  `?limit=<n>` (default 100, max 500).

**Durable Queue**

- **FR-009**: The system MUST replace `setImmediate` dispatch in `createRun` with a file-based
  queue writing `QueueEntry` JSON to `queue/pending/<id>.json`.
- **FR-010**: The worker MUST use an atomic rename (`pending/ → processing/`) as the claim
  primitive; failed renames MUST be silently skipped.
- **FR-011**: On startup, orphaned files in `queue/processing/` MUST be recovered to
  `queue/pending/` with `attempt` incremented before the worker loop starts.
- **FR-012**: The worker MUST respect `scheduledAt` — entries with `scheduledAt > now` MUST NOT
  be claimed.
- **FR-013**: The worker MUST enforce `queueMaxConcurrent` simultaneous `executeRun` calls.

**Cleanup**

- **FR-014**: On startup, the system MUST scan `os.tmpdir()/avatar-project/` and delete files
  with `mtime` older than `tempFileMaxAgeSec`; files belonging to active runs MUST be preserved.
- **FR-015**: The system MUST prune artifact blobs for terminal runs after the applicable
  retention period (`artifactRetentionDays` or `videoRetentionDays`); pruning MUST remove the
  artifact entry from `Run.artifacts` and null lineage references.
- **FR-016**: Terminal run JSON files older than `metadataRetentionDays` MUST be moved to
  `<dataDir>/archive/runs/<runId>.json`; `GET /runs/:runId` MUST check the archive path and
  return the run with `archived: true`.
- **FR-017**: The cleanup CLI MUST support `--dry-run`, `--temp`, `--artifacts`, `--metadata`,
  and `--all` flags; `--all` MUST be the default when no scope flag is given.
- **FR-018**: `POST /maintenance/cleanup` MUST accept `scope` and `dryRun` fields and return
  counts and byte totals for each scope.

**Cost Accounting**

- **FR-019**: The system MUST extract `metrics.predict_time` from the Replicate terminal response
  and compute `providerUsd = predict_time * replicateCostPerSecondUsd`.
- **FR-020**: `Run.cost` MUST be replaced with `RunCost` containing `estimatedUsd` (sum) and a
  `breakdown` object with per-component fields.
- **FR-021**: Storage I/O bytes MUST be tracked via a `CostAccumulator` throughout `executeRun`
  and flushed into `Run.cost` on completion or failure.
- **FR-022**: `avatar status <run-id>` MUST display a cost line in human mode; `--verbose` MUST
  display the full per-component breakdown.

**Structured Logging and Metrics**

- **FR-023**: All `console.log` / `console.error` calls MUST be replaced with the structured
  logger from `packages/core/src/logger.ts` (no external dependencies).
- **FR-024**: Log output MUST be NDJSON when `LOG_FORMAT=json` or when stdout is not a TTY;
  MUST be pretty-printed with ANSI color when `LOG_FORMAT=pretty` or when stdout is a TTY.
- **FR-025**: `AvatarService` MUST maintain an in-memory `RunnerMetrics` object and expose it
  via `GET /metrics`; metrics MUST reset on process restart.
- **FR-026**: `avatar metrics [--json]` MUST call `GET /metrics` and print a summary or raw JSON.

### Key Entities

- **RetryPolicy**: `{ maxAttempts, backoffStrategy, backoffBaseMs, backoffMaxMs, jitterFactor }` —
  per-failure-class retry parameters.
- **RetryState**: `{ nextRetryAt, exhausted }` — live retry tracking on each `Run`.
- **QueueEntry**: `{ id, runId, enqueuedAt, scheduledAt, attempt }` — durable dispatch record.
- **RunCost**: `{ estimatedUsd, breakdown: { providerUsd, storageReadUsd, storageWriteUsd,
  storageReadBytes, storageWriteBytes, computeMs, computeUsd } }` — per-run cost record.
- **RunnerMetrics**: In-memory aggregate of queue depth, run counts, duration percentiles,
  cost totals, and cleanup statistics.
- **CostAccumulator**: Internal (non-exported) class used within `executeRun` to collect
  read/write byte counts and produce the `RunCost` breakdown.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A run that fails with `provider_rate_limited` is automatically re-executed without
  operator intervention within the configured backoff window; operator only intervenes when retries
  are exhausted.
- **SC-002**: After a process crash, all previously queued runs are recovered and re-executed on
  the next startup with zero data loss (verified by run state = `succeeded` or `failed`, not
  missing).
- **SC-003**: Dead-lettered runs are visible via `avatar dead-letters` within 1 minute of being
  dead-lettered; operators can re-queue them with a single command in under 30 seconds.
- **SC-004**: Operators can reclaim storage to zero (100% of expired artifacts deleted) for any
  retention period they configure, using a single `avatar cleanup --all` invocation.
- **SC-005**: The `avatar status` command displays a non-zero estimated cost for any run that
  consumed Replicate GPU time, within the latency of the existing `status` command.
- **SC-006**: Every log event emitted in `json` mode passes JSON.parse without error and contains
  `ts`, `level`, and `msg` fields; log-level filtering via `LOG_LEVEL` reduces output to only
  matching severity entries.
- **SC-007**: `GET /metrics` responds within 200ms at any queue depth and reflects current queue
  state (pending/processing counts) accurately within one `queuePollIntervalMs` cycle.

## Assumptions

- Phase 1 is fully implemented and stable; Phase 3 does not alter any Phase 1 behavior except
  where explicitly stated (cost shape change, `setImmediate` replacement, `RunState` extension).
- The runner is single-process; the durable queue's atomic rename primitive is sufficient for
  crash safety without external locking.
- Azure SAS tokens used in production include delete permissions for artifact pruning; operators
  are responsible for token scope configuration.
- `LOG_FORMAT` and `LOG_LEVEL` are set in the deployment environment; the defaults (auto-detect
  TTY, `info` level) are appropriate for both local and cloud deployments.
- `computeUsdPerMs` defaults to `0` for local runner deployments; operators running on metered
  Azure compute will configure it explicitly.
- The cleanup sweep is triggered manually (CLI or maintenance API) or at startup; a cron-style
  automatic schedule is out of scope for Phase 3.
- Percentile metrics (`p50Ms`, `p95Ms`, `p99Ms`) are in-memory and reset on restart; persistent
  metrics integration (e.g., Azure Monitor) is out of scope.
- Cost figures are estimates; `predict_time` from Replicate may not exactly match billing.
