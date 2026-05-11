# CLI Command Contracts: Phase 3

**Date**: 2026-05-11
**Package**: `packages/cli/src/index.ts`

Phase 3 adds four new CLI commands and modifies one existing command. All existing commands
are unchanged unless noted.

---

## New Commands

### `avatar retry <run-id>`

Re-queues a failed or dead-lettered run.

**Usage**:
```
npm run avatar -- retry <run-id>
```

**Arguments**:
- `<run-id>` (required): ID of the run to re-queue.

**Behavior**:
1. Calls `POST /runs/:runId/retry`.
2. On success (`200`): prints the updated run JSON (same format as `avatar status`).
3. On `404`: exits with code 1, prints `Error: Run '<id>' was not found.` to stderr.
4. On `409`: exits with code 1, prints `Error: Run '<id>' is not in dead_lettered or failed state.` to stderr.

**Output** (human mode — same as `avatar status <run-id>`):
```
Run: run_abc123
State: queued
...
```

There is no `--json` flag; the output is always the run JSON object.

---

### `avatar dead-letters`

Lists all runs currently in `dead_lettered` state.

**Usage**:
```
npm run avatar -- dead-letters [--json]
```

**Flags**:
- `--json`: emit raw JSON array instead of table.

**Behavior**:
1. Calls `GET /runs?state=dead_lettered`.
2. Human mode: tabular output with columns.
3. JSON mode: `{ "runs": [...] }`.

**Human output format**:
```
RUN ID           REASON                FAILURE CODE          ATTEMPTS  DEAD-LETTERED AT
run_abc123       retries_exhausted     provider_rate_limited 5         2026-05-11T14:32:00Z
run_def456       non_retryable_failure provider_auth         1         2026-05-11T15:00:00Z
run_ghi789       stuck_run             —                     2         2026-05-11T15:15:00Z
```

When no dead-lettered runs exist:
```
No dead-lettered runs.
```

---

### `avatar cleanup`

Prunes stale temp files, expired artifact blobs, and old run metadata.

**Usage**:
```
npm run avatar -- cleanup [--dry-run] [--temp] [--artifacts] [--metadata] [--all]
```

**Flags**:
- `--dry-run`: describe what would be deleted without deleting. Safe to run at any time.
- `--temp`: prune orphaned temp/materialized files older than `tempFileMaxAgeSec`.
- `--artifacts`: prune expired artifact blobs (per retention policy).
- `--metadata`: archive terminal run JSON files older than `metadataRetentionDays`.
- `--all` (default when no scope flag given): all three scopes.

**Behavior**:
1. Calls `POST /maintenance/cleanup` with the selected scope and `dryRun` flag.
2. Prints a summary in human mode.

**Human output format**:
```
Temp files:    12 deleted, 48.3 MB freed
Artifacts:     34 pruned across 8 runs, 2.1 GB freed
Runs archived: 5 runs moved to archive
```

With `--dry-run`:
```
[DRY RUN — no changes made]
Temp files:    12 would be deleted, 48.3 MB would be freed
Artifacts:     34 would be pruned across 8 runs, 2.1 GB would be freed
Runs archived: 5 runs would be moved to archive
```

When nothing to clean:
```
Nothing to clean up.
```

Exits with code 0 in all cases (including dry run). Exits with code 1 on connection error.

**JSON output** (`--json`):
```json
{
  "dryRun": false,
  "tempFiles": { "deleted": 12, "bytes": 50647040 },
  "artifacts": { "pruned": 34, "bytes": 2254857830, "runIds": ["..."] },
  "metadata": { "archived": 5, "runIds": ["..."] }
}
```

---

### `avatar metrics`

Displays runner metrics from the running service.

**Usage**:
```
npm run avatar -- metrics [--json]
```

**Flags**:
- `--json`: emit raw `RunnerMetrics` JSON.

**Behavior**:
1. Calls `GET /metrics`.
2. Prints formatted summary (human mode) or raw JSON (`--json`).

**Human output format**:
```
Runs
  Queued (total):      42
  Started (total):     41
  Succeeded (total):   38
  Failed (total):       2
  Dead-lettered:        1
  Retried (total):      3
  Active now:           1

Queue
  Pending:    2
  Processing: 1

Durations (last 38 runs)
  p50:    18.4 s
  p95:    32.1 s
  p99:    —

Costs (cumulative)
  Total:    $0.1170
  Provider: $0.1050
  Storage:  $0.0120

Cleanup
  Last run: 2026-05-09 14:32 UTC
  Temp files deleted:  24
  Artifacts pruned:    34
  Runs archived:        5
```

Exits with code 1 on connection error (runner not reachable).

---

## Modified Commands

### `avatar status <run-id>` (existing — extended output)

**No change** to invocation or existing fields. Phase 3 adds a cost line and `--verbose`
breakdown when cost data is available.

**Human output additions**:

Default mode (new `Cost` line after existing fields):
```
Cost:   $0.0031  (provider $0.0028 · storage $0.0003)
```

When `estimatedUsd == 0` and no breakdown data:
```
Cost:   $0.0000
```

With `--verbose` flag (new flag, shows breakdown):
```
Cost breakdown:
  Provider:      $0.0028  (5.09 GPU-seconds @ $0.00055/s)
  Storage write: $0.0002  (24.1 MB written)
  Storage read:  $0.0001  (12.3 MB read)
  Compute:       $0.0000  (local runner)
  Total:         $0.0031
```

`--verbose` is additive — all existing status fields are still shown plus the cost breakdown.

---

## Full CLI Command Index

| Command | Phase | Description |
|---|---|---|
| `upload <file> --kind reference\|driving` | 1 | Upload and register an input asset |
| `run --reference <id> --video <id> [--preset ...] [--provider ...]` | 1 | Create an async retargeting run |
| `status <run-id> [--json] [--verbose]` | 1 (extended) | Read run status with optional cost breakdown |
| `fetch <run-id> [--output-dir ./outputs]` | 1 | Download all artifacts for a run |
| `review <run-id> --decision approve\|reject [--notes "..."]` | 1 | Submit a manual review decision |
| `compare <run-id-a> <run-id-b> [--json]` | 1 | Compare two runs |
| `retry <run-id>` | **3** | Re-queue a failed or dead-lettered run |
| `dead-letters [--json]` | **3** | List runs in dead-lettered state |
| `cleanup [--dry-run] [--temp] [--artifacts] [--metadata] [--all]` | **3** | Prune temp files, artifacts, and old metadata |
| `metrics [--json]` | **3** | Display runner metrics |
