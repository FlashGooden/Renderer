# Data Model: Keep Archived Runs

## Run

Represents a generated avatar processing record.

**Key fields**:

- `id`: Stable run identifier.
- `state`: Lifecycle state such as queued, running, needs review, succeeded, failed, or dead
  lettered.
- `archived`: Optional marker indicating the run is archived.
- `reviewStatus`, `reviewHistory`, `latestReview`: Review state and historical review entries.
- `artifacts`: Generated artifacts attached to the run.
- `lineage`: Provider, archive, and lifecycle metadata.
- `createdAt`, `updatedAt`: Run timestamps.

**Validation rules**:

- Updates to a missing run fail with a clear not-found error.
- Updates to a live run persist as a live run.
- Updates to an archived-only run persist as an archived run.

## Archived Run

Represents a run stored outside the default live collection while remaining available for explicit
lookup and audit workflows.

**Key fields**:

- Same fields as `Run`.
- `archived`: Always treated as true when loaded from the archived collection.
- `lineage.archived.reason`: Optional archive reason.
- `lineage.archived.archivedAt`: Archive timestamp.

**Relationships**:

- An archived run has the same identifier and logical shape as its original live run.
- Archived runs may still be associated with review records and artifacts.

**State transitions**:

```text
live run -> archive requested -> archived run
archived run -> permitted metadata/review update -> archived run
missing run -> update requested -> not-found failure
```

## Run Listing

Represents a collection view of runs.

**Key fields**:

- `includeArchived`: Whether archived records should be included.
- `states`: Optional state filter.
- `limit`: Optional result cap.

**Validation rules**:

- Default listings include live runs only.
- Explicit archived listings may include archived records.
- Updating an archived run must not make it appear in default listings.
