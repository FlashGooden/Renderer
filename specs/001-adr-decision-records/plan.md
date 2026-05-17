# Implementation Plan: ADR Decision Records

**Branch**: `001-adr-decision-records` | **Date**: 2026-05-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-adr-decision-records/spec.md`

## Summary

Create a discoverable ADR collection for the Personal Azure Avatar Project under `docs/adr/`.
The collection will include a top-level guide, a reusable ADR template, a coverage tracker, and
initial ADRs for identifiable existing project decisions from `README.md` and `SPEC.md`. This is
a documentation-only feature: no runtime code, package API, or external service changes are
required.

## Technical Context

**Language/Version**: TypeScript 6.0.3, strict mode, ES2022 target; Node.js workspace context
for the existing project. ADR content is Markdown.

**Primary Dependencies**: No new dependencies. Existing project uses Node built-ins and npm
workspaces.

**Storage**: Repository files in `docs/adr/`.

**Testing**: Documentation review plus repository checks. Because this feature adds no code,
`npm run typecheck` is not required by the project instruction, but it remains available if tasks
later add code.

**Target Platform**: Repository contributors using local development environments and GitHub
Markdown rendering.

**Project Type**: Documentation feature in an existing CLI + HTTP service monorepo
(`packages/cli`, `packages/cloud-runner`, `packages/core`).

**Performance Goals**: A new contributor can locate the ADR collection from the repository root
in under 2 minutes; a maintainer can determine an ADR status in under 1 minute per record.

**Constraints**: Do not change runtime behavior. Keep ADRs plain Markdown so they are readable
without special tooling. Preserve historical decision records rather than rewriting or deleting
them when decisions change.

**Scale/Scope**: Personal project with a small set of initial ADRs. Initial coverage targets
identifiable existing decisions, with unresolved coverage captured explicitly.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution still contains template placeholders and does not define enforceable
feature gates. Applicable project-level instructions from `AGENTS.md`:

- Type checking is required when adding code. This feature is documentation-only, so no typecheck
  gate applies unless implementation tasks later introduce code.
- Appropriate tests are required for project changes. This plan uses documentation validation
  checks instead of runtime tests because the deliverable is Markdown ADR documentation.

Gate status: PASS. No constitution violations.

## Project Structure

### Documentation (this feature)

```text
specs/001-adr-decision-records/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── adr-document-contract.md
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
docs/
└── adr/
    ├── README.md
    ├── TEMPLATE.md
    ├── COVERAGE.md
    ├── 0001-use-typescript-node-workspace.md
    ├── 0002-cli-first-runner-architecture.md
    ├── 0003-use-replicate-dreamactor-provider.md
    ├── 0004-support-local-and-azure-blob-storage.md
    └── 0005-use-file-json-metadata-store.md

README.md               # Add/update ADR collection pointer
```

**Structure Decision**: Use `docs/adr/` at repository root. This is the most common discoverable
location for project documentation while keeping ADRs separate from Spec Kit feature specs.

## Complexity Tracking

No constitution violations or extra complexity are introduced.
