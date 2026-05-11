# Research: Phase 3 — Reliability and Cost Control

**Date**: 2026-05-11
**Feature**: Phase 3 reliability and cost additions to the Personal Azure Avatar Project

---

## Decision 1: Queue Durability Mechanism

**Decision**: File-based durable queue using atomic `fs.rename` as the claim primitive, with
`queue/pending/<id>.json` and `queue/processing/<id>.json` layout inside `dataDir`.

**Rationale**: The project already uses a file-based `FileJobStore` (JSON files per entity). A
file-based queue is consistent with the existing architecture, requires zero new npm dependencies,
and provides sufficient crash recovery for a single-process personal tool. The POSIX `rename(2)`
syscall is atomic on the same filesystem, making it a safe claim primitive without external locking.

**Alternatives considered**:
- *SQLite*: Would add a dependency (`better-sqlite3` or similar) and require building native
  bindings. Overkill for a personal tool with a single concurrent operator.
- *Azure Storage Queue*: Would add Azure SDK dependency and require network access for every
  dispatch. Designed for multi-process scale, not single-process personal use.
- *In-memory queue with WAL*: More complex than a directory scan; no clear advantage over file
  rename for single-process use.

---

## Decision 2: Retry Backoff Implementation

**Decision**: Inline backoff calculation in `AvatarService` using the spec's formula:
`delay = min(base * 2^(attempt-1), max) + floor(random() * jitter * delay)`. No external
retry library.

**Rationale**: The backoff formula is simple arithmetic. Adding a library (`p-retry`, `cockatiel`)
would introduce a dependency for ~10 lines of math. The per-failure-class retry table maps directly
to a `Map<FailureCode, RetryPolicy>` constant that is easy to test and audit.

**Alternatives considered**:
- *`p-retry` npm package*: Mature library, but adds a dependency and an abstraction layer that
  obscures the per-failure-class policy table which is a first-class concept in this spec.
- *Per-failure-class subclasses of ProviderError*: More complex class hierarchy; the flat policy
  table is simpler and easier to extend.

---

## Decision 3: Structured Logger Design

**Decision**: Single-file logger (`packages/core/src/logger.ts`) with no external dependencies.
Auto-detects TTY for format selection (`process.stdout.isTTY`). Uses `process.stdout.write` for
JSON and `console.log` internals for pretty mode.

**Rationale**: The project has zero runtime dependencies (only `typescript` and `@types/node` as
dev deps). Adding `pino`, `winston`, or `bunyan` would be the first runtime dependency, which
conflicts with Principle I (no unnecessary abstraction) and Principle IV (no new deps for
capabilities achievable with Node builtins). The NDJSON format is simple to implement: one
`JSON.stringify` per log call plus a newline.

**Alternatives considered**:
- *`pino`*: Industry-standard fast JSON logger. Rejected because it adds a runtime dependency
  and the project's log volume is low (personal use, not high-throughput server).
- *`winston`*: More configuration overhead than needed. Same dependency concern.

---

## Decision 4: In-Memory Metrics Ring Buffer

**Decision**: A fixed-size ring buffer of 1000 duration samples stored as a sorted array in
memory. Percentiles (`p50`, `p95`, `p99`) are computed by index lookup after sorting on each
new sample insertion.

**Rationale**: For a personal tool, 1000 samples is more than enough to compute meaningful
percentiles. The ring buffer avoids unbounded memory growth. Sorting 1000 numbers on each
insert is negligible compared to the I/O-heavy run execution.

**Alternatives considered**:
- *HDR Histogram*: Accurate percentile computation with O(1) insert. Adds a dependency. Overkill
  for 1000 samples at personal scale.
- *T-digest*: Similar overkill; requires implementing a non-trivial data structure.
- *Full array, trim on overflow*: Equivalent to ring buffer but requires splice; ring buffer
  avoids repeated array allocation.

---

## Decision 5: Storage Byte Tracking

**Decision**: Modify `StorageDriver` interface — `putBuffer` and `putFile` return
`{ locator: StorageLocator; bytes: number }` instead of `StorageLocator` directly. `readBuffer`
returns `{ buffer: Buffer; bytes: number }`. `CostAccumulator` in `AvatarService.executeRun`
collects these values.

**Rationale**: The alternative (emitting bytes via a callback/event) adds unnecessary complexity.
A slightly richer return type is a clean, TypeScript-idiomatic change. Existing call sites
(which only use the `locator`) need a one-line update to destructure the new shape.

**Alternatives considered**:
- *EventEmitter on StorageDriver*: More complex; requires callers to register listeners.
- *Separate `measurePut/measureRead` methods*: Duplicates the actual operation; two calls instead
  of one.
- *Side-channel `lastBytesTransferred` property*: Not thread-safe even in single-threaded JS
  (async interleaving); explicit return value is safer.

---

## Decision 6: Cleanup Sweep Trigger Strategy

**Decision**: Cleanup runs at service startup and on-demand via `POST /maintenance/cleanup` or
`avatar cleanup`. No automatic cron schedule.

**Rationale**: For a personal tool with infrequent runs, automatic background cleanup could
delete artifacts mid-review. Operator-triggered cleanup gives full control. The spec explicitly
lists this as a known limitation / non-goal for Phase 3.

**Alternatives considered**:
- *Background interval (`setInterval`)* : Would require additional concurrency guards to avoid
  deleting artifacts for in-flight runs. Adds complexity for marginal benefit.
- *Cron-based scheduled cleanup*: Out of scope per spec.

---

## Decision 7: `JobStore.listRuns` Implementation

**Decision**: Implement `listRuns` in `FileJobStore` by scanning `<dataDir>/runs/*.json` and
optionally `<dataDir>/archive/runs/*.json` (when `include_archived=true`). Filter in-memory
after reading. Cap at `limit` (default 100, max 500).

**Rationale**: The existing `FileJobStore` has no index — each entity is one file. Scanning the
runs directory and reading JSON files is consistent with the existing pattern. For personal use
with hundreds (not millions) of runs, directory scan performance is acceptable. Filtering
in-memory after reading is simpler than maintaining a separate index file.

**Alternatives considered**:
- *Maintain an index file* (`runs-index.json`) with run metadata for fast filtering: Adds write
  complexity (must update index on every `createRun` and `updateRun`). Not necessary at this scale.
- *SQLite index*: See Decision 1 — rejected for same dependency reasons.

---

## Resolved Technical Questions

| Question | Resolution |
|---|---|
| Where does `QueueEntry` ID prefix come from? | `queue_` prefix (consistent with `run_`, `asset_`, etc. from `createId`) |
| What happens if `queue/pending/` scan returns thousands of files? | `queueMaxConcurrent = 2` limits active executions; files are sorted by `scheduledAt` and processed in order; bounded at personal scale |
| How does `GET /runs` find archived runs? | `listRuns` checks archive path only when `?include_archived=true` is passed |
| How does the logger handle `[key: string]: unknown` in `LogEntry`? | Extra fields spread as top-level keys in the JSON object, or as `key=value` pairs in pretty mode |
| Does `AzureBlobStorageDriver.readBuffer` report bytes? | Yes — `buffer.length` from the already-buffered response |
| Is `retryState` initialized on existing runs (schema migration)? | `getRun` should return `retryState: { nextRetryAt: null, exhausted: false }` as a default when the field is absent (JSON merge default) |
| What if `predict_time` is `0` vs absent in Replicate response? | `0` is valid (very fast run) — no warning. Absent (field not in metrics) → `providerUsd = 0` + warn log |
