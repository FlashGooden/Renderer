# Implementation Plan: Phase 3 — Reliability and Cost Control

**Branch**: `001-reliability-cost-control` | **Date**: 2026-05-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-reliability-cost-control/spec.md`

## Summary

Phase 3 adds six reliability and cost-control capabilities to the Personal Azure Avatar Project:
automatic retry with per-failure-class backoff, dead-letter handling with operator recovery,
a file-based durable queue that survives process crashes, startup/on-demand cleanup of temp
files and expired artifacts, real cost accounting from Replicate GPU metrics and storage I/O,
and a structured NDJSON logger with an in-memory metrics endpoint. All changes are additive to
the Phase 1 monorepo; the technical approach is pure Node.js (no new dependencies).

## Technical Context

**Language/Version**: TypeScript 6.0.3, strict mode, ES2022 target; Node.js v20.18.1
**Primary Dependencies**: Node built-ins only (`node:fs/promises`, `node:os`, `node:timers/promises`); no new npm packages
**Storage**: File-based `FileJobStore` (JSON files in `<dataDir>/runs/`, `assets/`, etc.); `LocalStorageDriver` or `AzureBlobStorageDriver`; new `queue/pending/` and `queue/processing/` directories under `dataDir`; new `archive/runs/` directory under `dataDir`
**Testing**: Node.js built-in test runner (`node --test`); existing tests in `packages/core/test/` and `packages/cloud-runner/test/`
**Target Platform**: Linux/macOS server (POSIX filesystem semantics required for atomic rename)
**Project Type**: CLI + HTTP service (monorepo: `packages/cli`, `packages/cloud-runner`, `packages/core`)
**Performance Goals**: CLI `status`/`fetch` under 2s for local reads; `GET /metrics` under 200ms; queue worker poll cadence 500ms default; no tight-loop polling
**Constraints**: Single-process only; no external queue dependency; Azure Blob `putFile` reads full file into memory (pre-existing, out of Phase 3 scope — see Complexity Tracking)
**Scale/Scope**: Personal use; single operator; queue concurrency capped at 2 by default

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### I. Code Quality ✅

- All new types (`RetryPolicy`, `QueueEntry`, `RetryState`, `RunCost`, `RunnerMetrics`) defined in `packages/core/src/types.ts` — no duplication across packages.
- No `any` at public interfaces. `CostAccumulator` is internal (not exported).
- `RetryPolicy`, `QueueEntry`, `RunCost` are explicit, composable interfaces with no escape hatches.
- No speculative abstractions: `QueueWorker` is embedded in `AvatarService` (same class), not extracted until the need arises.

### II. Testing Standards ✅

- New contract paths require tests: `POST /runs/:runId/retry`, `GET /runs?state=`, `GET /metrics`, `POST /maintenance/cleanup`.
- Mock provider MUST simulate retryable failures for retry/dead-letter tests.
- Integration tests required: retry scheduling, orphan recovery, stuck-run sweep, cleanup scopes, cost accumulation, log NDJSON format.
- Red-Green-Refactor: tests written before implementation for each user story.

### III. User Experience Consistency ✅

- `avatar retry`, `avatar dead-letters`, `avatar cleanup`, `avatar metrics` all follow uniform I/O protocol.
- All new commands support `--json` for machine-readable output.
- Error messages name the component and provide recovery hint (e.g., "Run '<id>' is not in dead_lettered or failed state").
- `avatar cleanup --dry-run` is deterministic — no side effects.

### IV. Performance Requirements ✅ (with one pre-existing exception, see Complexity Tracking)

- Provider timeout honored via existing `providerTimeoutSec` gate; Phase 3 adds retry scheduling on timeout rather than immediate failure.
- Poll loop respects `queuePollIntervalMs` default 500ms — no tight polling.
- `GET /metrics` reads in-memory struct — no I/O, well under 200ms.
- `queue/pending/` scan is bounded by queue depth (personal use, not an unbounded list).

## Project Structure

### Documentation (this feature)

```text
specs/001-reliability-cost-control/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── http-api.md
│   └── cli-commands.md
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/
├── core/
│   └── src/
│       ├── types.ts          # Add: RunState.dead_lettered, RetryState, RetryPolicy,
│       │                     #      QueueEntry, RunCost, RunnerMetrics, ProjectConfig additions
│       ├── config.ts         # Add: 8 new config fields with env var + default resolution
│       ├── service.ts        # Replace setImmediate; add queue worker, retry logic,
│       │                     #      dead-letter handling, stuck-run sweep, cleanup,
│       │                     #      cost accumulation, listRuns, retryRun, getMetrics
│       ├── logger.ts         # NEW: structured NDJSON/pretty logger (no deps)
│       ├── storage.ts        # Modify putBuffer/putFile/readBuffer to return byte counts
│       └── job-store.ts      # Add: listRuns (scan runs dir), archive support
├── cloud-runner/
│   └── src/
│       └── server.ts         # Add: GET /runs, POST /runs/:id/retry,
│                             #      POST /maintenance/cleanup, GET /metrics
└── cli/
    └── src/
        └── index.ts          # Add: retry, dead-letters, cleanup, metrics commands
                              # Modify: status (cost line + --verbose breakdown)

packages/core/test/
├── service.test.ts           # Add: retry, dead-letter, queue, cleanup, cost, metrics tests
├── logger.test.ts            # NEW: NDJSON format validation, level filtering
└── storage.test.ts           # Add: byte-tracking tests
packages/cloud-runner/test/
└── server.test.ts            # Add: new endpoint tests
```

**Structure Decision**: Single monorepo with three packages. All new code goes into existing
packages following established patterns. No new packages required.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| `AzureBlobStorageDriver.putFile` reads full file into memory (`fs.readFile`) | Pre-existing Phase 1 implementation; Phase 3 does not change Azure Blob behavior | Streaming Azure Blob requires Azure SDK or chunked PUT which adds a new dependency; out of Phase 3 scope |
