# Architecture Decision Records

This directory contains Architecture Decision Records for the Personal Azure Avatar Project. ADRs capture architectural and project-significant decisions that contributors need to understand when changing the CLI, runner, provider, storage, persistence, or deployment shape.

ADRs are not routine implementation notes. Use them when a decision affects project structure, operational assumptions, external services, data persistence, contributor workflow, or future migration paths.

## How to Read This Collection

- Start with the decision index below for current records.
- Use [COVERAGE.md](COVERAGE.md) to audit which visible project decisions are documented and which are still pending.
- Use [TEMPLATE.md](TEMPLATE.md) when creating a new ADR.
- Preserve existing ADR files when decisions change. Update their status and related records instead of deleting history.

## Status Vocabulary

| Status | Meaning |
| --- | --- |
| `Proposed` | Under consideration and not current guidance. |
| `Accepted` | Current project guidance. |
| `Superseded` | Replaced by a later ADR. |
| `Deprecated` | No longer recommended, with or without a direct replacement. |

## Decision Index

| ADR | Status | Topic |
| --- | --- | --- |
| [0001](0001-use-typescript-node-workspace.md) | Accepted | Use a TypeScript Node.js workspace |
| [0002](0002-cli-first-runner-architecture.md) | Accepted | Keep a CLI-first runner architecture |
| [0003](0003-use-replicate-dreamactor-provider.md) | Accepted | Use Replicate DreamActor M2.0 as the default provider |
| [0004](0004-support-local-and-azure-blob-storage.md) | Accepted | Support local and Azure Blob Storage |
| [0005](0005-use-file-json-metadata-store.md) | Accepted | Persist metadata in local JSON files |
| [Coverage Tracker](COVERAGE.md) | N/A | Documented and pending decision coverage |
