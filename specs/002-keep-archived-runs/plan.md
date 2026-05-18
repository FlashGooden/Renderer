# Implementation Plan: Keep Archived Runs

**Branch**: `002-keep-archived-runs` | **Date**: 2026-05-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-keep-archived-runs/spec.md`

## Summary

Fix the archived-run lifecycle bug reported in GitHub Issue #9. Archived run records remain
available for direct lookup and permitted updates, but an update to an archived-only run must write
back to the archived collection instead of recreating a live run record. The implementation keeps
live-run updates unchanged, preserves archived state for archived-only updates, and adds regression
coverage for the archived update path.

## Technical Context

**Language/Version**: TypeScript 6.0.3, strict mode, ES2022 target; Node.js workspace context.

**Primary Dependencies**: No new dependencies. Existing code uses Node built-ins, npm workspaces,
and the project-local core service/store modules.

**Storage**: File-backed JSON metadata under the configured data directory. Live runs are stored
under `runs/`; archived runs are stored under `archive/runs/`.

**Testing**: `npm run typecheck` and `npm test`. Focused regression coverage belongs in
`packages/core/test/job-store.test.ts`, with existing service and runner tests providing broader
integration coverage.

**Target Platform**: Local Node.js CLI/HTTP runner environments and GitHub CI-style repository
validation.

**Project Type**: Existing CLI + HTTP service monorepo with shared core package
(`packages/cli`, `packages/cloud-runner`, `packages/core`).

**Performance Goals**: No measurable slowdown for normal run updates. Archived-run update
verification should complete as part of the existing unit test suite in under 2 minutes on a
developer machine.

**Constraints**: Preserve current public `JobStore` method shapes. Do not introduce a migration,
database, or new storage abstraction. Keep default run listings limited to live runs unless archived
records are explicitly requested.

**Scale/Scope**: Narrow bug fix for run lifecycle persistence and listing behavior. Out of scope:
retention policy, archive deletion, new CLI commands, and changes to provider execution behavior.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution file still contains template placeholders and does not define enforceable gates.
Applicable project-level instructions from `AGENTS.md`:

- Type checking is required when adding code.
- Appropriate tests are required for project changes.

Gate status before research: PASS. This feature changes core code, so the implementation must run
`npm run typecheck` and include regression tests.

Post-design gate status: PASS. The design keeps the code change scoped to `FileJobStore`, adds
focused regression coverage, and does not introduce new dependencies or untested public behavior.

## Project Structure

### Documentation (this feature)

```text
specs/002-keep-archived-runs/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── job-store-archive-update-contract.md
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/core/
├── src/
│   ├── job-store.ts     # File-backed run storage and archive-aware update behavior
│   └── types.ts         # Existing JobStore and Run contracts
└── test/
    └── job-store.test.ts # Archive lifecycle regression tests
```

**Structure Decision**: Keep the fix in `packages/core` because `FileJobStore` owns live/archive
run persistence. No CLI, HTTP route, or storage-driver structure change is required.

## Complexity Tracking

No constitution violations or extra complexity are introduced.
