# Research: Keep Archived Runs

## Decision: Update Archived-Only Runs In Place

Archived-only runs will be updated at their archived record location and returned as archived.

**Rationale**: The reported defect is caused by reading an archived run and then writing the update
to the live run location. Updating in place preserves the user's mental model: archived runs remain
outside default live listings while still supporting permitted review and metadata updates.

**Alternatives considered**:

- Reject all archived-run mutations: safer for immutability, but conflicts with existing permitted
  review/update flows and would be a larger behavior change.
- Always restore archived runs before mutation: matches the current defect and makes default live
  listings inaccurate.

## Decision: Live Record Wins If Both Live And Archived Copies Exist

If a run identifier exists in both live and archived collections, the live record remains the update
target.

**Rationale**: This avoids surprising behavior for active workflows and matches existing lookup
precedence, where live records are found before archive fallback records. It also provides a stable
rule for historical duplicate states created by the defect.

**Alternatives considered**:

- Treat duplicates as an error: exposes historical corruption but risks breaking existing callers
  during normal updates.
- Merge live and archived records automatically: would require policy decisions outside this issue's
  scope.

## Decision: Preserve Archived Flag For Archived-Only Updates

Archived-only updates will force the persisted and returned run to remain archived, even if the
updater payload attempts to clear the archived marker.

**Rationale**: Archive membership is determined by storage location and user-visible lifecycle. A
permitted metadata update should not be able to silently move a run back into live listings.

**Alternatives considered**:

- Trust updater payload completely: allows the defect to return through a different code path.
- Add a separate restore operation: useful later, but outside the current bug fix and not requested
  by the issue.

## Decision: Cover At The Store Boundary

Regression coverage will live in `packages/core/test/job-store.test.ts`.

**Rationale**: The defect is in file-backed run persistence. Store-level tests can assert the exact
live/archive file locations and listing behavior without relying on provider execution or media
fixtures.

**Alternatives considered**:

- Service-only tests through review submission: closer to the issue example, but slower and less
  direct for proving file placement.
- CLI or HTTP tests: unnecessary because the public service layer delegates to the same store
  contract.
