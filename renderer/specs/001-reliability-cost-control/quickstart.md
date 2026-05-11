# Quickstart: Phase 3 — Reliability and Cost Control

**Date**: 2026-05-11
**Prerequisites**: Phase 1 MVP running (runner started, reference + driving assets uploaded)

---

## Verify Phase 3 is Active

```bash
# Start the runner (Phase 3 features activate automatically on startup)
npm run runner

# Check health (should list providers as before)
curl http://127.0.0.1:4010/health

# Check metrics endpoint (new in Phase 3)
npm run avatar -- metrics
```

Expected metrics output on a fresh start:
```
Runs
  Queued (total):     0
  Active now:         0
...
Queue
  Pending:   0
  Processing: 0
```

---

## Durable Queue: Verify Crash Recovery

```bash
# Create a run (it is now written to queue/pending/ instead of dispatched via setImmediate)
npm run avatar -- run --reference <reference-asset-id> --video <driving-asset-id>
# Note the run ID in the output

# Immediately kill the runner (Ctrl+C or kill <pid>)
# Check that the run file exists in the queue
ls .avatar/queue/pending/
ls .avatar/queue/processing/

# Restart the runner — orphaned processing/ entries are moved back to pending/
npm run runner

# Check that the run eventually completes
npm run avatar -- status <run-id>
```

Logs on restart will include `queue.orphan_recovered` entries for any in-flight jobs.

---

## Retry: Observe Automatic Retry

The mock provider can simulate retryable failures for testing. In production with Replicate,
rate limit failures are retried automatically — no operator action required.

```bash
# After a run fails with a retryable failure, check retryState
npm run avatar -- status <run-id> --json | jq '.retryState'

# Expected during retry backoff:
# { "nextRetryAt": "2026-05-11T14:35:00.000Z", "exhausted": false }

# After all retries exhausted, the run is dead-lettered
npm run avatar -- dead-letters
```

---

## Dead-Letter: Inspect and Re-Queue

```bash
# List all dead-lettered runs
npm run avatar -- dead-letters

# Example output:
# RUN ID       REASON                FAILURE CODE          ATTEMPTS  DEAD-LETTERED AT
# run_abc123   retries_exhausted     provider_rate_limited 5         2026-05-11T14:32:00Z

# Re-queue a dead-lettered run after investigating the cause
npm run avatar -- retry run_abc123

# Verify it is back in queued state
npm run avatar -- status run_abc123
```

---

## Cost Accounting: Check Run Cost

```bash
# After a run completes, check cost in default output
npm run avatar -- status <run-id>
# Look for the "Cost:" line:
# Cost:  $0.0031  (provider $0.0028 · storage $0.0003)

# Verbose breakdown
npm run avatar -- status <run-id> --verbose
# Cost breakdown:
#   Provider:      $0.0028  (5.09 GPU-seconds @ $0.00055/s)
#   Storage write: $0.0002  (24.1 MB written)
#   Storage read:  $0.0001  (12.3 MB read)
#   Compute:       $0.0000  (local runner)
#   Total:         $0.0031

# Check cumulative cost in metrics
npm run avatar -- metrics
# Look for the "Costs" section
```

---

## Cleanup: Prune Stale Files

```bash
# Dry run first — see what would be cleaned without deleting
npm run avatar -- cleanup --dry-run

# Run full cleanup
npm run avatar -- cleanup --all

# Or run specific scopes
npm run avatar -- cleanup --temp        # orphaned temp files only
npm run avatar -- cleanup --artifacts   # expired artifact blobs only
npm run avatar -- cleanup --metadata    # archive old terminal run JSON only

# JSON output for scripting
npm run avatar -- cleanup --all --json
```

---

## Structured Logs

```bash
# JSON mode (default when not a TTY, e.g., in CI or piped)
npm run runner 2>&1 | head -5
# {"ts":"2026-05-11T14:00:00.000Z","level":"info","msg":"run.queued","runId":"run_abc","providerId":"replicate-dreamactor","presetId":"preview-720p"}

# Pretty mode (default in terminal)
npm run runner
# [2026-05-11T14:00:00Z] INFO  run.queued  runId=run_abc providerId=replicate-dreamactor

# Control log level
LOG_LEVEL=debug npm run runner   # include poll debug logs
LOG_LEVEL=warn npm run runner    # only warnings and errors

# Force JSON mode in terminal for testing
LOG_FORMAT=json npm run runner
```

---

## New Configuration Reference

All new settings have sensible defaults and can be overridden via environment variable or
`avatar.config.json`.

```json
{
  "queuePollIntervalMs": 500,
  "queueMaxConcurrent": 2,
  "staleRunSweepIntervalMs": 60000,
  "tempFileMaxAgeSec": 3600,
  "artifactRetentionDays": 30,
  "videoRetentionDays": 90,
  "metadataRetentionDays": 180,
  "replicateCostPerSecondUsd": 0.00055,
  "azureBlobWriteUsdPerGb": 0.0,
  "azureBlobReadUsdPerGb": 0.0,
  "computeUsdPerMs": 0.0
}
```

`staleRunThresholdMs` defaults to `providerTimeoutSec * 2 * 1000` and cannot be set in
`avatar.config.json` (it derives from the existing `providerTimeoutSec`). Override via
`AVATAR_STALE_RUN_THRESHOLD_MS`.
