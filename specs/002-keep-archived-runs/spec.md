# Feature Specification: Keep Archived Runs

**Feature Branch**: `002-keep-archived-runs`

**Created**: 2026-05-17

**Status**: Draft

**Input**: User description: "Assess and fix GitHub Issue #9: Keep archived runs in the archive on later updates. Archived run records can currently be loaded and then updated back into the live run collection, causing archived terminal runs to reappear in default run lists while an old archived copy remains."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preserve Archived Run Status During Updates (Priority: P1)

As a maintainer reviewing or annotating a completed run after it has been archived, I need the run to remain archived after the update so active run lists stay accurate and no duplicate records appear.

**Why this priority**: This directly addresses the reported defect. Resurrecting archived runs corrupts run lifecycle expectations and makes default run lists misleading.

**Independent Test**: Can be tested by archiving a terminal run, applying an allowed update to that run, and confirming the run remains absent from default live-run listings while the archived record contains the update.

**Acceptance Scenarios**:

1. **Given** a terminal run that has been archived, **When** a permitted update is applied to that run, **Then** the updated record remains archived and does not appear in default live-run listings.
2. **Given** an archived run and no live copy for the same identifier, **When** the run is updated, **Then** the system keeps a single authoritative archived record for that identifier.

---

### User Story 2 - Keep Live Run Updates Unchanged (Priority: P2)

As an operator managing active or unarchived runs, I need normal run updates to continue working as before so the archive fix does not disrupt active workflows.

**Why this priority**: The fix must be tightly scoped and must not change behavior for live runs.

**Independent Test**: Can be tested by updating a live run and confirming it remains in live-run listings with the expected changes.

**Acceptance Scenarios**:

1. **Given** a live run, **When** an update is applied, **Then** the run remains live and appears in default live-run listings.

### Edge Cases

- A run identifier exists only in the archive and a caller attempts a permitted mutation.
- A run identifier exists in both live and archived collections because of prior duplication; the live record remains the authoritative target for live updates.
- A caller attempts to update a run identifier that exists in neither live nor archived collections.
- A caller archives an already archived run.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST keep archived runs archived when a permitted update is applied after the run has been archived.
- **FR-002**: The system MUST avoid creating a new live run record when updating a run that exists only in the archive.
- **FR-003**: The system MUST expose updated archived run data when archived runs are explicitly requested or retrieved directly.
- **FR-004**: The system MUST keep default run listings limited to live runs after archived-run updates.
- **FR-005**: The system MUST preserve existing live-run update behavior for runs that have not been archived.
- **FR-006**: The system MUST continue to report a clear not-found failure when an update targets a run identifier that exists in neither live nor archived records.
- **FR-007**: The system MUST treat an already archived run as archived if an archive action is requested again.

### Key Entities

- **Run**: A generated avatar processing record with lifecycle state, review metadata, artifacts, provider lineage, timestamps, and an archived status.
- **Archived Run**: A run removed from normal live-run listings but still available for explicit lookup, audit, review history, and historical reporting.
- **Run Listing**: A user-facing collection of runs that defaults to live records and includes archived records only when explicitly requested.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of archived-run update attempts covered by regression tests keep the run out of default live-run listings.
- **SC-002**: Updating an archived run leaves exactly one authoritative run record visible when archived records are included.
- **SC-003**: Existing live-run update tests continue to pass with no behavior change for unarchived runs.
- **SC-004**: A maintainer can verify the archived-run lifecycle outcome from automated test results in under 2 minutes.

## Assumptions

- Permitted updates to archived runs are allowed; the fix should preserve the archived location/status rather than reject those updates.
- Default run listings are intended to show live runs only unless archived records are explicitly requested.
- If both live and archived records exist for the same identifier because of historical duplication, the live record remains authoritative for normal updates.
- This issue is scoped to run lifecycle persistence and listing behavior, not to broader retention policy or archive deletion behavior.
