# Tasks: Keep Archived Runs

**Input**: Design documents from `/specs/002-keep-archived-runs/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/job-store-archive-update-contract.md, quickstart.md

**Tests**: Required by project instructions and this feature's success criteria. Add regression coverage before implementation changes.

**Organization**: Tasks are grouped by user story so the archived-run fix can be delivered as the MVP and live-run preservation can be verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other tasks that touch different files and have no dependency on incomplete tasks
- **[Story]**: Maps task to the user story from spec.md
- All tasks include exact file paths

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the current feature context and target files before implementation.

- [X] T001 Review archived-run update requirements in specs/002-keep-archived-runs/contracts/job-store-archive-update-contract.md
- [X] T002 [P] Review existing FileJobStore archive read/write behavior in packages/core/src/job-store.ts
- [X] T003 [P] Review existing archive lifecycle coverage and makeRun fixture shape in packages/core/test/job-store.test.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish the shared test fixture assumptions required by both user stories.

**CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Ensure the makeRun helper supports archived and live update regression scenarios in packages/core/test/job-store.test.ts

**Checkpoint**: Test fixture is ready for story-specific regression tests.

---

## Phase 3: User Story 1 - Preserve Archived Run Status During Updates (Priority: P1)

**Goal**: Updating an archived-only run writes back to the archived collection, keeps archived status true, and does not recreate a live record.

**Independent Test**: Archive a terminal run, apply an allowed update, then verify `runs/<id>.json` is absent, `archive/runs/<id>.json` contains the update, default `listRuns()` excludes the run, and `listRuns({ includeArchived: true })` includes exactly that archived run.

### Tests for User Story 1

- [X] T005 [US1] Add failing archived-only update regression test in packages/core/test/job-store.test.ts

### Implementation for User Story 1

- [X] T006 [US1] Update FileJobStore.updateRun to resolve live versus archived target paths in packages/core/src/job-store.ts
- [X] T007 [US1] Force archived-only update results to persist and return archived status in packages/core/src/job-store.ts
- [X] T008 [US1] Verify direct lookup and archived listing expose the updated archived record in packages/core/test/job-store.test.ts

**Checkpoint**: User Story 1 is independently testable and prevents the Issue #9 resurrection bug.

---

## Phase 4: User Story 2 - Keep Live Run Updates Unchanged (Priority: P2)

**Goal**: Normal updates for live runs continue to write to the live collection and remain visible in default run listings.

**Independent Test**: Update a live run and confirm `runs/<id>.json` is updated, no archived copy is created, and default `listRuns()` includes the run.

### Tests for User Story 2

- [X] T009 [US2] Add live-run update preservation regression test in packages/core/test/job-store.test.ts

### Implementation for User Story 2

- [X] T010 [US2] Confirm FileJobStore.updateRun keeps live records as the authoritative target when both paths are possible in packages/core/src/job-store.ts

**Checkpoint**: User Stories 1 and 2 both work independently.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Validate the completed feature and keep project documentation aligned.

- [X] T011 [P] Confirm quickstart validation steps describe the final checks in specs/002-keep-archived-runs/quickstart.md
- [X] T012 Run type checking for the workspace using package.json
- [X] T013 Run the full automated test suite for the workspace using package.json
- [X] T014 Review final diff for unrelated changes in packages/core/src/job-store.ts and packages/core/test/job-store.test.ts

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion; blocks user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational completion; MVP scope.
- **User Story 2 (Phase 4)**: Depends on Foundational completion and should run after US1 if one developer is editing the same files.
- **Polish (Phase 5)**: Depends on selected user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational; no dependency on User Story 2.
- **User Story 2 (P2)**: Can start after Foundational, but should be sequenced after US1 in a single worktree because both stories edit the same files.

### Within Each User Story

- Write regression tests before implementation changes.
- Implement store behavior after the failing test captures the required invariant.
- Validate each story independently before continuing.

## Parallel Opportunities

- T002 and T003 can run in parallel because they inspect different files.
- T011 can run in parallel with code review after story implementation is complete because it only touches quickstart documentation.
- US1 and US2 are conceptually independent, but practical parallel coding is limited because both stories touch packages/core/src/job-store.ts and packages/core/test/job-store.test.ts.

## Parallel Example: Setup

```text
Task: "Review existing FileJobStore archive read/write behavior in packages/core/src/job-store.ts"
Task: "Review existing archive lifecycle coverage and makeRun fixture shape in packages/core/test/job-store.test.ts"
```

## Parallel Example: Polish

```text
Task: "Confirm quickstart validation steps describe the final checks in specs/002-keep-archived-runs/quickstart.md"
Task: "Review final diff for unrelated changes in packages/core/src/job-store.ts and packages/core/test/job-store.test.ts"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2.
2. Add the archived-only update regression test in T005.
3. Implement T006 and T007.
4. Complete T008 and validate that archived updates stay archived.
5. Run type checking and tests before considering the MVP complete.

### Incremental Delivery

1. Deliver US1 to fix Issue #9 directly.
2. Add US2 coverage to prove live update behavior is unchanged.
3. Run the full validation commands from quickstart.md.

### Validation Commands

```bash
npm run typecheck
npm test
```

## Notes

- Task IDs are sequential and execution-ordered.
- `[US1]` and `[US2]` labels map to the user stories in spec.md.
- `[P]` marks only tasks that can safely run in parallel without same-file edits.
- Do not introduce new dependencies, migrations, CLI commands, or retention-policy changes for this feature.
