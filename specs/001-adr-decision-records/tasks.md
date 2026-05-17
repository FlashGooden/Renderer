# Tasks: ADR Decision Records

**Input**: Design documents from `/specs/001-adr-decision-records/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/adr-document-contract.md, quickstart.md

**Tests**: No runtime tests are generated because the feature is documentation-only. Validation tasks use the quickstart checks and ADR document contract.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare the ADR documentation location and source evidence for the collection.

- [X] T001 Create the ADR documentation directory at docs/adr/
- [X] T002 Review README.md for identifiable existing decisions to support docs/adr/COVERAGE.md
- [X] T003 Review SPEC.md for identifiable existing decisions to support docs/adr/COVERAGE.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the shared ADR contract files that all user stories depend on.

**CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Create the reusable ADR template with required headings in docs/adr/TEMPLATE.md
- [X] T005 Create the coverage tracker table and status rules in docs/adr/COVERAGE.md
- [X] T006 Add the allowed ADR status vocabulary and lifecycle guidance to docs/adr/TEMPLATE.md
- [X] T007 Verify docs/adr/TEMPLATE.md matches specs/001-adr-decision-records/contracts/adr-document-contract.md

**Checkpoint**: ADR structure is ready for discoverability, record creation, and coverage tracking.

---

## Phase 3: User Story 1 - Find Project Decisions (Priority: P1) MVP

**Goal**: A contributor can find the ADR collection from the repository root and understand how to browse decisions.

**Independent Test**: From the repository root, locate docs/adr/ through README.md and identify the collection purpose plus available decision topics in under 2 minutes.

### Implementation for User Story 1

- [X] T008 [US1] Create the ADR collection guide in docs/adr/README.md with purpose, scope, status vocabulary, and links to TEMPLATE.md and COVERAGE.md
- [X] T009 [US1] Add the ADR collection link and short description to README.md
- [X] T010 [US1] Add an initial decision index section to docs/adr/README.md listing planned ADR files and coverage tracker
- [X] T011 [US1] Validate discoverability by running the quickstart README check against README.md and docs/adr/README.md

**Checkpoint**: User Story 1 is complete and independently testable.

---

## Phase 4: User Story 2 - Record Decisions Consistently (Priority: P2)

**Goal**: Maintainers can create and review ADRs using a consistent, complete record structure.

**Independent Test**: Review any ADR file in docs/adr/ and confirm it contains title, status, date, context, decision, consequences, and related records in the expected order.

### Implementation for User Story 2

- [X] T012 [P] [US2] Create ADR 0001 for the TypeScript Node workspace decision in docs/adr/0001-use-typescript-node-workspace.md
- [X] T013 [P] [US2] Create ADR 0002 for the CLI-first runner architecture decision in docs/adr/0002-cli-first-runner-architecture.md
- [X] T014 [P] [US2] Create ADR 0003 for the Replicate DreamActor provider decision in docs/adr/0003-use-replicate-dreamactor-provider.md
- [X] T015 [P] [US2] Create ADR 0004 for local and Azure Blob storage support in docs/adr/0004-support-local-and-azure-blob-storage.md
- [X] T016 [P] [US2] Create ADR 0005 for file JSON metadata storage in docs/adr/0005-use-file-json-metadata-store.md
- [X] T017 [US2] Update docs/adr/README.md decision index to link to ADRs 0001 through 0005
- [X] T018 [US2] Validate ADR 0001 through ADR 0005 against specs/001-adr-decision-records/contracts/adr-document-contract.md

**Checkpoint**: User Story 2 is complete and independently testable.

---

## Phase 5: User Story 3 - Audit Decision Coverage (Priority: P3)

**Goal**: Project owners can audit whether identifiable existing decisions are documented or visibly pending.

**Independent Test**: Compare docs/adr/COVERAGE.md against README.md and SPEC.md and confirm each identifiable existing decision is marked Documented with an ADR link or Pending with a note.

### Implementation for User Story 3

- [X] T019 [US3] Populate docs/adr/COVERAGE.md with identifiable existing decision topics from README.md and SPEC.md
- [X] T020 [US3] Mark documented decisions in docs/adr/COVERAGE.md with links to ADRs 0001 through 0005
- [X] T021 [US3] Add any remaining pending decision coverage notes to docs/adr/COVERAGE.md with missing-information details
- [X] T022 [US3] Validate docs/adr/COVERAGE.md against the coverage contract in specs/001-adr-decision-records/contracts/adr-document-contract.md

**Checkpoint**: User Story 3 is complete and independently testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final consistency checks across the ADR collection.

- [X] T023 [P] Run quickstart locate-collection verification from specs/001-adr-decision-records/quickstart.md against docs/adr/
- [X] T024 [P] Check every docs/adr/NNNN-*.md file uses only Proposed, Accepted, Superseded, or Deprecated status values
- [X] T025 [P] Check every docs/adr/NNNN-*.md file includes Status, Date, Context, Decision, Consequences, and Related Records sections
- [X] T026 Verify README.md and docs/adr/README.md links resolve to existing docs/adr/ files
- [X] T027 Confirm no runtime code was changed; if code or tooling was added, run npm run typecheck and npm test

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion; blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational completion.
- **User Story 2 (Phase 4)**: Depends on Foundational completion; can run after US1 or in parallel with US1 after T004-T007.
- **User Story 3 (Phase 5)**: Depends on ADR files from US2 for documented links.
- **Polish (Phase 6)**: Depends on all selected user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: No dependency on other user stories after Foundational. This is the MVP.
- **User Story 2 (P2)**: No dependency on US1 for ADR file creation, but T017 depends on docs/adr/README.md from US1.
- **User Story 3 (P3)**: Depends on US2 ADR files so coverage can link documented decisions.

### Parallel Opportunities

- T012 through T016 can run in parallel because each creates a separate ADR file.
- T023 through T025 can run in parallel because each validates a different aspect of the completed docs.

---

## Parallel Example: User Story 2

```text
Task: "Create ADR 0001 for the TypeScript Node workspace decision in docs/adr/0001-use-typescript-node-workspace.md"
Task: "Create ADR 0002 for the CLI-first runner architecture decision in docs/adr/0002-cli-first-runner-architecture.md"
Task: "Create ADR 0003 for the Replicate DreamActor provider decision in docs/adr/0003-use-replicate-dreamactor-provider.md"
Task: "Create ADR 0004 for local and Azure Blob storage support in docs/adr/0004-support-local-and-azure-blob-storage.md"
Task: "Create ADR 0005 for file JSON metadata storage in docs/adr/0005-use-file-json-metadata-store.md"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational ADR template and coverage tracker.
3. Complete Phase 3: User Story 1 discoverability.
4. Stop and validate that README.md leads a contributor to docs/adr/ in under 2 minutes.

### Incremental Delivery

1. Deliver US1 so contributors can find the collection.
2. Deliver US2 so maintainers have complete, consistent seed ADRs.
3. Deliver US3 so project owners can audit documented and pending decision coverage.
4. Run polish checks from quickstart.md and the ADR document contract.

### Documentation Validation

- Use specs/001-adr-decision-records/quickstart.md as the primary validation checklist.
- Use specs/001-adr-decision-records/contracts/adr-document-contract.md as the ADR structure contract.
- Do not run type checking or runtime tests unless implementation introduces code or tooling.

## Notes

- [P] tasks touch different files or read different inputs and can run in parallel.
- [US1], [US2], and [US3] labels map directly to prioritized user stories in spec.md.
- Keep ADR content factual: cite decisions visible in README.md, SPEC.md, or repository structure; mark uncertain gaps as Pending in COVERAGE.md.
