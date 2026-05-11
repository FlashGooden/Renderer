---

description: "Task list for Phase 3 — Reliability and Cost Control"
---

# Tasks: Phase 3 — Reliability and Cost Control

**Input**: Design documents from `/specs/001-reliability-cost-control/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: Included — constitution Principle II mandates Red-Green-Refactor. Spec section
"Tested Behavior (Phase 3 Additions)" explicitly enumerates required test coverage.

**Organization**: Tasks grouped by user story. US3 (Durable Queue) is implemented first
because US1 (Retry) requires writing `QueueEntry` files to schedule retries, and US2
(Dead-Letter) requires the queue worker for re-queuing.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no shared state dependencies)
- **[Story]**: Which user story this task belongs to (US1–US6)
- Exact file paths included in every task description

## Path Conventions

```
packages/core/src/        ← types, service, config, storage, job-store, logger
packages/core/test/       ← service, storage, logger tests
packages/cloud-runner/src/← server (HTTP handler)
packages/cloud-runner/test/← server tests
packages/cli/src/         ← CLI commands
```

---

## Phase 1: Setup (Type and Config Additions)

**Purpose**: Add all new TypeScript types and configuration fields. No behavior changes yet.
These unblock all later phases.

- [ ] T001 Add Phase 3 types to `packages/core/src/types.ts`: extend `RunState` union with `"dead_lettered"`, add `RetryPolicy`, `RetryState`, `QueueEntry`, `RunCost`, `RunnerMetrics`, `LogEntry` interfaces; replace `Run.cost: { estimatedUsd: number }` with `Run.cost: RunCost`; add `Run.retryState`, `Run.deadLetteredAt`, `Run.deadLetterReason`, `Run.archived?` fields
- [ ] T002 Add Phase 3 config fields to `packages/core/src/config.ts`: `queuePollIntervalMs` (500), `queueMaxConcurrent` (2), `staleRunThresholdMs` (providerTimeoutSec × 2000), `staleRunSweepIntervalMs` (60000), `tempFileMaxAgeSec` (3600), `artifactRetentionDays` (30), `videoRetentionDays` (90), `metadataRetentionDays` (180), `replicateCostPerSecondUsd` (0.00055), `azureBlobWriteUsdPerGb` (0), `azureBlobReadUsdPerGb` (0), `computeUsdPerMs` (0); wire each to its env var
- [ ] T003 [P] Add `listRuns` and `archiveRun` to `JobStore` interface in `packages/core/src/types.ts` per data-model.md §9; also update `StorageDriver` interface to return `{ locator, bytes }` from `putBuffer`/`putFile` and `{ buffer, bytes }` from `readBuffer` per data-model.md §8

---

## Phase 2: Foundational (Blocking Infrastructure)

**Purpose**: Implement the storage byte-tracking, job-store extensions, and logger skeleton that
all user stories depend on. No user story work can begin until this phase is complete.

**⚠️ CRITICAL**: US3–US6 all depend on this phase completing first.

- [x] T004 Update `LocalStorageDriver` in `packages/core/src/storage.ts`: modify `putBuffer` to return `{ locator, bytes: buffer.length }`, `putFile` to return `{ locator, bytes: stat.size }` (use `fs.stat` after copy), `readBuffer` to return `{ buffer, bytes: buffer.length }`; update all internal call sites
- [x] T005 [P] Update `AzureBlobStorageDriver` in `packages/core/src/storage.ts`: same return-type changes as T004; `putBuffer` bytes = `buffer.length`; `putFile` bytes = buffer read from `fs.readFile`; `readBuffer` bytes = `buffer.length`
- [x] T006 Implement `listRuns` in `packages/core/src/job-store.ts`: scan `<rootDir>/runs/*.json`, read each file, apply `state[]` filter and `limit` cap (default 100, max 500); if `includeArchived`, also scan `<rootDir>/archive/runs/*.json` and tag with `archived: true`; update `getRun` to fall back to archive path when live path returns `null`
- [x] T007 Implement `archiveRun` in `packages/core/src/job-store.ts`: move `runs/<runId>.json` → `archive/runs/<runId>.json` (create `archive/runs/` via `ensureDir`); add `archive/runs/` dir creation to `initialize()`
- [x] T008 Update all `AvatarService` call sites in `packages/core/src/service.ts` that call `storageDriver.putBuffer`, `putFile`, or `readBuffer` to destructure `{ locator, bytes }` / `{ buffer, bytes }` from the new return shapes; no behavior change yet

**Checkpoint**: Storage byte-tracking and job-store extensions ready — user story phases can now begin.

---

## Phase 3: User Story 3 — Durable Queue (Priority: P1) 🎯 MVP blocker

**Goal**: Replace `setImmediate` dispatch with a file-based durable queue that survives process
crashes; implement startup orphan recovery; enforce concurrency limit.

**Independent Test**: Start service, create two runs, kill process mid-execution, restart service,
verify orphaned `queue/processing/` entries are logged as `queue.orphan_recovered` and runs
re-execute without operator intervention.

### Tests for US3 ⚠️ Write these first — confirm they FAIL before T014

- [ ] T009 [P] [US3] Write test: `createRun` writes a `QueueEntry` JSON file to `queue/pending/<id>.json` (not dispatched via `setImmediate`) — `packages/core/test/service.test.ts`
- [ ] T010 [P] [US3] Write test: entries in `queue/processing/` at startup are moved back to `queue/pending/` with `attempt` incremented; `queue.orphan_recovered` is logged — `packages/core/test/service.test.ts`
- [ ] T011 [P] [US3] Write test: worker skips entries where `scheduledAt > now`; claims entries where `scheduledAt <= now` — `packages/core/test/service.test.ts`
- [ ] T012 [P] [US3] Write test: `queueMaxConcurrent = 1` limits simultaneous `executeRun` calls to one — `packages/core/test/service.test.ts`

### Implementation for US3

- [ ] T013 [US3] Replace `setImmediate(() => this.executeRun(...))` at `service.ts:332` with: create `QueueEntry` (`id = createId("queue")`, `runId`, `enqueuedAt = nowIso()`, `scheduledAt = nowIso()`, `attempt = 1`), write to `queue/pending/<id>.json`, log `queue.enqueued` — `packages/core/src/service.ts`
- [ ] T014 [US3] Create `queue/pending/` and `queue/processing/` directories in `AvatarService.initialize()` (before worker starts); add to `FileJobStore.initialize()` pattern using `ensureDir` — `packages/core/src/service.ts`
- [ ] T015 [US3] Implement `startQueueWorker()` private method in `AvatarService`: reads `queue/pending/*.json`, filters `scheduledAt <= now`, sorts ascending by `scheduledAt`; for each entry up to `queueMaxConcurrent`: renames `pending/<id>.json` → `processing/<id>.json` (catch ENOENT silently), logs `queue.claimed`, calls `this.executeRun(entry.runId)` as detached async task, on completion deletes `processing/<id>.json` and logs `queue.completed`; sleeps `queuePollIntervalMs`; call from `initialize()` — `packages/core/src/service.ts`
- [ ] T016 [US3] Implement startup orphan recovery in `AvatarService.initialize()`: scan `queue/processing/*.json`; for each file, increment `attempt`, write to `queue/pending/<newId>.json`, delete old file, log `queue.orphan_recovered` — `packages/core/src/service.ts`

**Checkpoint**: US3 complete — crash-safe dispatch with recovery. US1 and US2 can now proceed.

---

## Phase 4: User Story 1 — Automatic Retry on Transient Failures (Priority: P1)

**Goal**: Add per-failure-class retry policy with exponential/fixed backoff and jitter; schedule
retries via the durable queue; do not change behavior for non-retryable failures.

**Independent Test**: Configure mock provider to return `provider_rate_limited` on first two
attempts and succeed on third. Submit run; verify `run.attempts = 3`, `run.state = "needs_review"`,
and `retryState.nextRetryAt` was non-null between attempts.

### Tests for US1 ⚠️ Write these first — confirm they FAIL before T021

- [ ] T017 [P] [US1] Write test: `provider_rate_limited` failure schedules new `QueueEntry` with `scheduledAt = now + backoff`, sets `run.state = "queued"`, increments `run.attempts` — `packages/core/test/service.test.ts`
- [ ] T018 [P] [US1] Write test: `provider_auth` failure does NOT schedule retry (non-retryable); run proceeds to dead-letter (pre-condition for US2) — `packages/core/test/service.test.ts`
- [ ] T019 [P] [US1] Write test: run that hits `provider_rate_limited` 5 times sets `retryState.exhausted = true` and transitions to dead-letter — `packages/core/test/service.test.ts`
- [ ] T020 [P] [US1] Write test: custom `retryPolicy` passed via `POST /runs` narrows `maxAttempts`; non-retryable code cannot be made retryable via custom policy — `packages/cloud-runner/test/server.test.ts`

### Implementation for US1

- [ ] T021 [US1] Add `RETRY_POLICY_TABLE: Map<FailureCode, RetryPolicy>` constant and `computeBackoffMs(policy, attempt)` function (implements spec backoff formula with jitter) in `packages/core/src/service.ts`
- [ ] T022 [US1] Add `retryState: { nextRetryAt: null, exhausted: false }` to `Run` creation in `AvatarService.createRun()` and default-fill logic in `FileJobStore.getRun()` for backward compatibility — `packages/core/src/service.ts` and `packages/core/src/job-store.ts`
- [ ] T023 [US1] Modify `executeRun` catch block in `packages/core/src/service.ts`: after normalizing failure, look up failure code in retry table; if retryable and `run.attempts < policy.maxAttempts`: compute `nextRetryAt`, set `run.state = "queued"`, update `run.retryState`, write new `QueueEntry` with `scheduledAt = nextRetryAt`, log `run.retried`; else: proceed to dead-letter (placeholder for US2 implementation)
- [ ] T024 [US1] Update `POST /runs` handler in `packages/cloud-runner/src/server.ts` to pass optional `body.retryPolicy` to `service.createRun()`; update `AvatarService.createRun()` signature to accept and store custom `retryPolicy` on the run

**Checkpoint**: US1 complete — retryable failures auto-retry with backoff. US2 can now be implemented.

---

## Phase 5: User Story 2 — Dead-Letter Queue and Manual Recovery (Priority: P1)

**Goal**: Transition non-retryable / exhausted runs to `dead_lettered`; detect and dead-letter
stuck runs; expose `POST /runs/:id/retry` and `GET /runs` endpoints; add CLI commands.

**Independent Test**: Force `provider_auth` failure; run `avatar dead-letters`; confirm run appears
with `deadLetterReason = "non_retryable_failure"`; run `avatar retry <id>`; confirm run returns
to `queued` state and eventually completes.

### Tests for US2 ⚠️ Write these first — confirm they FAIL before T030

- [ ] T025 [P] [US2] Write test: non-retryable failure (e.g., `provider_auth`) sets `run.state = "dead_lettered"`, `run.deadLetteredAt`, `run.deadLetterReason = "non_retryable_failure"` — `packages/core/test/service.test.ts`
- [ ] T026 [P] [US2] Write test: run with `retryState.exhausted = true` sets `deadLetterReason = "retries_exhausted"` — `packages/core/test/service.test.ts`
- [ ] T027 [P] [US2] Write test: stuck-run sweep dead-letters a run with `state = "running"` and `updatedAt` older than `staleRunThresholdMs`; `deadLetterReason = "stuck_run"` — `packages/core/test/service.test.ts`
- [ ] T028 [P] [US2] Write contract test: `POST /runs/:id/retry` on dead-lettered run returns `200`, `run.state = "queued"`, cleared dead-letter fields, new `QueueEntry` in `queue/pending/` — `packages/cloud-runner/test/server.test.ts`
- [ ] T029 [P] [US2] Write contract test: `GET /runs?state=dead_lettered` returns only dead-lettered runs; `?limit=2` caps results — `packages/cloud-runner/test/server.test.ts`

### Implementation for US2

- [ ] T030 [US2] Complete dead-letter transition in `executeRun` catch block (placeholder from T023): when not retrying, set `run.state = "dead_lettered"`, `run.deadLetteredAt = nowIso()`, `run.deadLetterReason = exhausted ? "retries_exhausted" : "non_retryable_failure"`, log `run.dead_lettered` — `packages/core/src/service.ts`
- [ ] T031 [US2] Implement stuck-run sweep `detectStuckRuns()` private method in `AvatarService`: scan all runs (via `listRuns`), find `state = "queued" | "running"` with `updatedAt < now - staleRunThresholdMs`, transition each to `dead_lettered` with `deadLetterReason = "stuck_run"`, log `sweep.stuck_run` and `sweep.completed`; call at `initialize()` startup and schedule via `setInterval(staleRunSweepIntervalMs)` — `packages/core/src/service.ts`
- [ ] T032 [US2] Implement `AvatarService.retryRun(runId)`: validate state is `dead_lettered` or `failed`, reset to `queued`, clear dead-letter fields, reset `retryState`, write new `QueueEntry` with `scheduledAt = nowIso()`, return updated run — `packages/core/src/service.ts`
- [ ] T033 [US2] Implement `AvatarService.listRuns(options)`: delegate to `this.jobStore.listRuns(options)`, return results — `packages/core/src/service.ts`
- [ ] T034 [US2] Add `GET /runs` endpoint in `packages/cloud-runner/src/server.ts`: parse `?state=`, `?limit=`, `?include_archived=` query params; call `service.listRuns()`; return `200 { runs: [...] }`; validate `state` values
- [ ] T035 [US2] Add `POST /runs/:runId/retry` endpoint in `packages/cloud-runner/src/server.ts`: call `service.retryRun(runId)`; return `200 { run }` on success; `404` if not found; `409` if wrong state
- [ ] T036 [US2] Add `avatar retry <run-id>` command to `packages/cli/src/index.ts`: call `POST /runs/:id/retry`; print updated run in human format; exit 1 on 404/409 with actionable stderr message
- [ ] T037 [US2] Add `avatar dead-letters [--json]` command to `packages/cli/src/index.ts`: call `GET /runs?state=dead_lettered`; tabular human output (run ID, reason, failure code, attempts, dead-lettered at) or `--json` for raw JSON

**Checkpoint**: P1 stories complete. US1 + US2 + US3 all independently testable. Begin P2.

---

## Phase 6: User Story 4 — Automated Cleanup (Priority: P2)

**Goal**: Prune orphaned temp files, expired artifact blobs, and old run metadata; expose cleanup
via CLI and HTTP; support `--dry-run`; preserve active-run files.

**Independent Test**: Create completed runs older than `artifactRetentionDays`. Run
`avatar cleanup --artifacts --dry-run` and verify no blobs deleted. Run without `--dry-run`
and verify blobs deleted and `Run.artifacts` entries removed.

### Tests for US4 ⚠️ Write these first — confirm they FAIL before T043

- [ ] T038 [P] [US4] Write test: temp file sweep deletes files in `os.tmpdir()/avatar-project/` older than `tempFileMaxAgeSec`; skips files whose `runId` prefix matches an `activeRuns` entry — `packages/core/test/service.test.ts`
- [ ] T039 [P] [US4] Write test: artifact pruning deletes storage blob and removes artifact from `Run.artifacts` for terminal run older than retention threshold — `packages/core/test/service.test.ts`
- [ ] T040 [P] [US4] Write test: metadata archival moves `runs/<id>.json` → `archive/runs/<id>.json`; `GET /runs/:id` returns archived run with `archived: true` — `packages/cloud-runner/test/server.test.ts`
- [ ] T041 [P] [US4] Write test: `dryRun: true` returns counts without deleting any files — `packages/core/test/service.test.ts`

### Implementation for US4

- [ ] T042 [US4] Implement `cleanupTempFiles(dryRun)` in `packages/core/src/service.ts`: scan `os.tmpdir()/avatar-project/` recursively; delete files with `mtime < now - tempFileMaxAgeSec * 1000` unless filename prefix matches an `activeRuns` entry; log `cleanup.temp_files`; return `{ deleted, bytes }`
- [ ] T043 [US4] Implement `pruneArtifacts(dryRun)` in `packages/core/src/service.ts`: iterate all terminal runs (via `listRuns`), check each artifact's retention threshold (use `ArtifactKind → retentionDays` map from data-model.md), delete storage blob (local: `fs.rm`; Azure: HTTP DELETE to locator.url), remove from `Run.artifacts`, null lineage references, persist updated run JSON; log `cleanup.artifacts_pruned`; return `{ pruned, bytes, runIds }`
- [ ] T044 [US4] Implement `archiveOldRuns(dryRun)` in `packages/core/src/service.ts`: find `succeeded`/`failed` runs with `completedAt < now - metadataRetentionDays * 86400000`; call `this.jobStore.archiveRun(runId)` for each; log `cleanup.runs_archived`; return `{ archived, runIds }`
- [ ] T045 [US4] Implement `AvatarService.runCleanup({ scope, dryRun })`: calls the three cleanup methods based on `scope` array; runs temp cleanup at `initialize()` startup unconditionally; return aggregate result — `packages/core/src/service.ts`
- [ ] T046 [US4] Add `POST /maintenance/cleanup` endpoint in `packages/cloud-runner/src/server.ts`: parse `body.scope` and `body.dryRun`; call `service.runCleanup()`; return cleanup result JSON
- [ ] T047 [US4] Add `avatar cleanup [--dry-run] [--temp] [--artifacts] [--metadata] [--all]` command to `packages/cli/src/index.ts`: call `POST /maintenance/cleanup`; print human or JSON summary; support `--dry-run` prefix in human output

**Checkpoint**: US4 complete — storage costs are controllable. Begin US5.

---

## Phase 7: User Story 5 — Real Cost Visibility (Priority: P2)

**Goal**: Track provider GPU time, storage I/O bytes, and compute wall-clock time; populate
`Run.cost` breakdown; display in `avatar status` default and `--verbose` modes.

**Independent Test**: Submit run against Replicate (or mock returning `predict_time = 5.0`).
After completion, run `avatar status <id>` and confirm non-zero `Cost:` line. Run `--verbose`
and confirm breakdown shows `providerUsd = 5.0 * 0.00055 = 0.00275`.

### Tests for US5 ⚠️ Write these first — confirm they FAIL before T053

- [ ] T048 [P] [US5] Write test: `CostAccumulator.toBreakdown()` produces correct `storageReadUsd`, `storageWriteUsd`, and `computeMs` given byte counts and rates — `packages/core/test/service.test.ts`
- [ ] T049 [P] [US5] Write test: `executeRun` extracts `predict_time` from `providerState.metrics` and computes `providerUsd = predict_time * replicateCostPerSecondUsd` — `packages/core/test/service.test.ts`
- [ ] T050 [P] [US5] Write test: absent `predict_time` (field not in metrics object) logs `warn` and sets `providerUsd = 0` — `packages/core/test/service.test.ts`
- [ ] T051 [P] [US5] Write test: `Run.cost` is populated even on failed runs (partial cost persisted) — `packages/core/test/service.test.ts`

### Implementation for US5

- [ ] T052 [US5] Implement `CostAccumulator` class (not exported) in `packages/core/src/service.ts`: `readBytes`, `writeBytes`, `startedAt` fields; `recordRead(bytes)`, `recordWrite(bytes)`, `toBreakdown({ readUsdPerGb, writeUsdPerGb, computeUsdPerMs, providerUsd, completedAt? }): RunCost` methods
- [ ] T053 [US5] Wire `CostAccumulator` into `executeRun` in `packages/core/src/service.ts`: create at start of try block; wrap each `storageDriver.putBuffer`/`putFile`/`readBuffer` call site to record bytes; on success extract `providerState.metrics.predict_time`, compute `providerUsd`, call `accumulator.toBreakdown()`; flush into `run.cost` in both success and catch paths
- [ ] T054 [US5] Update `avatar status <run-id>` in `packages/cli/src/index.ts`: add `Cost:` line showing `estimatedUsd` and inline `(provider $X · storage $Y)` summary when `estimatedUsd > 0`; add `--verbose` flag that prints full `RunCost.breakdown` with GPU-seconds and byte units

**Checkpoint**: US5 complete — cost is visible per run and in aggregate.

---

## Phase 8: User Story 6 — Structured Logs and Runtime Metrics (Priority: P3)

**Goal**: Replace ad-hoc `console.log/error` with NDJSON/pretty structured logger; wire all
lifecycle events; add in-memory `RunnerMetrics` with percentile ring buffer; expose `GET /metrics`
and `avatar metrics`.

**Independent Test**: Start runner with `LOG_FORMAT=json`; submit and complete a run; pipe stdout
through `jq` — every line must parse successfully with `ts`, `level`, `msg` fields. Call
`GET /metrics` and confirm `runs.succeededTotal >= 1`.

### Tests for US6 ⚠️ Write these first — confirm they FAIL before T061

- [ ] T055 [P] [US6] Write test: `LOG_FORMAT=json` — every emitted log line is valid JSON with `ts` (ISO), `level` (valid enum), `msg` (string) — `packages/core/test/logger.test.ts`
- [ ] T056 [P] [US6] Write test: `LOG_LEVEL=warn` suppresses `debug` and `info` level calls — `packages/core/test/logger.test.ts`
- [ ] T057 [P] [US6] Write test: `GET /metrics` returns `runs.succeededTotal` count matching number of succeeded runs — `packages/cloud-runner/test/server.test.ts`

### Implementation for US6

- [ ] T058 [US6] Implement `packages/core/src/logger.ts`: `LogEntry` shape, NDJSON writer (`process.stdout.write(JSON.stringify(entry) + "\n")`), pretty writer with ANSI color and `key=value` pairs; auto-detect format from `LOG_FORMAT` env var or `process.stdout.isTTY`; respect `LOG_LEVEL` filter; export `logger.debug/info/warn/error(msg, fields)` — no external dependencies
- [ ] T059 [US6] Replace all `console.log` / `console.error` calls in `packages/core/src/service.ts` with structured logger calls using the event names from data-model.md §11 (run lifecycle, queue, stuck-run sweep, cleanup, error events)
- [ ] T060 [P] [US6] Replace all `console.log` / `console.error` calls in `packages/cloud-runner/src/server.ts` with logger calls; add `error.unexpected` log for 500 responses
- [ ] T061 [US6] Implement `RunnerMetrics` in-memory object and ring buffer (max 1000 duration samples) in `packages/core/src/service.ts`; wire metric increments into all lifecycle transitions (createRun, executeRun success/failure/retry/dead-letter, queue events, cleanup events); implement percentile computation on each new sample insertion; expose via `AvatarService.getMetrics(): RunnerMetrics`
- [ ] T062 [US6] Add `GET /metrics` endpoint in `packages/cloud-runner/src/server.ts`: call `service.getMetrics()`; return `200 { ...metrics }`
- [ ] T063 [US6] Add `avatar metrics [--json]` command to `packages/cli/src/index.ts`: call `GET /metrics`; print formatted human summary or raw JSON

**Checkpoint**: All six user stories complete and independently testable.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Finalize exports, update documentation, run end-to-end validation.

- [ ] T064 [P] Add `"./logger.js"` export entry to `packages/core/package.json` exports map (matching the `./service.js` pattern for types + import)
- [ ] T065 [P] Update storage tests in `packages/core/test/storage.test.ts` to verify new byte-tracking return shapes (`putBuffer`, `putFile`, `readBuffer` all return structured objects)
- [ ] T066 Update README.md command table to include all Phase 3 commands (`retry`, `dead-letters`, `cleanup`, `metrics`) with Phase 3 label
- [ ] T067 Run quickstart.md validation: build project (`npm run build`), start runner, execute the durable queue crash-recovery scenario from quickstart.md §2, verify logs and run state match expected output

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — begin immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (type interfaces must exist before implementations)
- **US3 Durable Queue (Phase 3)**: Depends on Foundational completion (queue dirs, byte tracking)
- **US1 Retry (Phase 4)**: Depends on US3 (retry scheduling writes QueueEntry files)
- **US2 Dead-Letter (Phase 5)**: Depends on US1 (dead-letter is the else-branch of retry logic)
- **US4 Cleanup (Phase 6)**: Depends on Foundational; independent of US1/US2/US3
- **US5 Cost (Phase 7)**: Depends on Foundational (byte tracking); independent of US1–US4
- **US6 Logs/Metrics (Phase 8)**: Depends on all prior phases (replaces console calls throughout)
- **Polish (Phase 9)**: Depends on all user stories

### User Story Dependencies

- **US3 (P1)**: Foundation-level — must complete before US1 and US2
- **US1 (P1)**: Depends on US3; independent of US2, US4, US5, US6
- **US2 (P1)**: Depends on US1 and US3; can be developed after US1 completes
- **US4 (P2)**: Independent of US1/US2/US3 after Foundational phase
- **US5 (P2)**: Independent of US1/US2/US3/US4 after Foundational phase
- **US6 (P3)**: Cross-cutting; develop last to replace all console calls in one pass

### Within Each User Story

1. Write tests first → confirm they FAIL
2. Implement until tests pass (Red → Green)
3. Refactor if needed (Refactor)
4. Commit when user story checkpoint is reached

### Parallel Opportunities

- T004 and T005 (LocalStorage + AzureBlob byte tracking) can run in parallel
- T009–T012 (US3 tests) can all be written in parallel
- T017–T020 (US1 tests) can all be written in parallel
- T025–T029 (US2 tests) can all be written in parallel
- T038–T041 (US4 tests) can all be written in parallel
- T048–T051 (US5 tests) can all be written in parallel
- T055–T057 (US6 tests) can all be written in parallel
- T059 and T060 (replace console calls in service.ts and server.ts) can run in parallel
- T064 and T065 (export map + storage tests) can run in parallel

---

## Parallel Example: US3

```bash
# Write all US3 tests in parallel (different test cases, same file — coordinate with sub-sections):
Task T009: "QueueEntry written to queue/pending/ on createRun"
Task T010: "Orphan recovery on startup"
Task T011: "scheduledAt gating"
Task T012: "queueMaxConcurrent enforcement"

# Then implement sequentially (T013 → T014 → T015 → T016):
Task T013: "Replace setImmediate with QueueEntry write"
Task T014: "Create queue/ directories in initialize()"
Task T015: "Implement queue worker loop"
Task T016: "Implement startup orphan recovery"
```

---

## Implementation Strategy

### MVP First (US3 Only)

1. Complete Phase 1: Setup (T001–T003)
2. Complete Phase 2: Foundational (T004–T008)
3. Complete Phase 3: US3 Durable Queue (T009–T016)
4. **STOP and VALIDATE**: Crash-kill runner, restart, verify orphan recovery
5. Runs no longer lost on process crash — this alone is valuable

### Incremental Delivery

1. Setup + Foundational → type-checks clean, byte tracking live
2. + US3 → crash-safe dispatch (MVP!)
3. + US1 → auto-retry for transient failures (reduced operator intervention)
4. + US2 → dead-letter visibility + manual recovery (complete reliability story)
5. + US4 → storage cost control (cleanup)
6. + US5 → cost accounting (visibility)
7. + US6 → structured logs + metrics (observability)

Each increment is independently deployable with a working `npm run build`.

---

## Notes

- `[P]` tasks touch different files or non-overlapping sections — safe to parallelize
- All test tasks MUST fail before the paired implementation tasks begin
- `service.ts` is the largest change surface — coordinate T013–T016, T021–T023, T030–T033, T042–T045, T052–T053, T059, T061 to avoid merge conflicts (implement sequentially or in clearly separated methods)
- `index.ts` (CLI) has four new commands — each is an independent `if/else` branch; T036, T037, T047, T054, T063 can be parallelized with care
- `server.ts` (cloud-runner) has four new route handlers — T034, T035, T046, T062 can be parallelized
- Stop at each user story checkpoint to validate independently before moving to the next story
