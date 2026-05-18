# Contract: JobStore Archived Run Updates

## Scope

This contract describes the expected behavior of run lookup, listing, update, and archive operations
for the file-backed job store.

## Operations

### `getRun(runId)`

**Given** a run identifier with a live record, **then** return the live run.

**Given** a run identifier with no live record and an archived record, **then** return the archived
run with archived status.

**Given** a run identifier with no live or archived record, **then** return no run.

### `listRuns(options)`

**Default behavior**: Return live runs only.

**With archived inclusion requested**: Return live runs and archived runs, subject to state filters
and result limits.

**Invariant**: A run updated while archived must not appear in default listings.

### `updateRun(runId, updater)`

**Given** a live run, **when** an update is applied, **then** write the updated record to the live
collection and return the updated live run.

**Given** an archived-only run, **when** an update is applied, **then** write the updated record to
the archived collection, return it as archived, and create no live record.

**Given** a missing run, **when** an update is applied, **then** fail with a clear not-found error.

### `archiveRun(runId, reason)`

**Given** a live run, **when** archive is requested, **then** move the run to the archived collection,
mark it archived, and remove the live record.

**Given** an already archived run, **when** archive is requested again, **then** return it as archived
without creating a live record.

## Acceptance Checks

- Updating an archived-only run leaves no `runs/<id>.json` record.
- Updating an archived-only run updates `archive/runs/<id>.json`.
- Updating an archived-only run returns `archived: true`.
- Listing without archived inclusion excludes the updated archived run.
- Listing with archived inclusion includes exactly one record for the updated archived run.
