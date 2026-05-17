# ADR Coverage

This tracker lists identifiable existing project decisions from `README.md`, `SPEC.md`, and repository structure. Each row is either `Documented` with a linked ADR or `Pending` with a note explaining what is missing.

Coverage status values:

- `Documented`: The decision has a linked ADR with the required structure.
- `Pending`: The decision is visible in project materials, but the available evidence is not enough to write a complete ADR without adding speculation.

| Decision Topic | Evidence | Coverage Status | Linked ADR or Pending Note |
| --- | --- | --- | --- |
| Use a TypeScript Node.js workspace with packages for CLI, runner, and core behavior | `README.md` package summary; `SPEC.md` Architecture; root `package.json` workspaces | Documented | [ADR 0001](0001-use-typescript-node-workspace.md) |
| Keep the system CLI-first with a small HTTP runner | `README.md` project summary and commands; `SPEC.md` Status, Architecture, CLI Specification, and HTTP Runner API | Documented | [ADR 0002](0002-cli-first-runner-architecture.md) |
| Use Replicate DreamActor M2.0 as the default production provider | `README.md` provider summary and configuration; `SPEC.md` Product Scope and Provider Specification | Documented | [ADR 0003](0003-use-replicate-dreamactor-provider.md) |
| Support both local disk and Azure Blob Storage for assets and outputs | `README.md` Configuration and Azure Shape; `SPEC.md` Architecture and Storage | Documented | [ADR 0004](0004-support-local-and-azure-blob-storage.md) |
| Persist metadata as local JSON files under the data directory | `README.md` Azure Shape; `SPEC.md` Architecture, Metadata Persistence, and Known Limitations | Documented | [ADR 0005](0005-use-file-json-metadata-store.md) |
| Use `ffmpeg` and `ffprobe` for media inspection and heuristic evaluation | `SPEC.md` Runtime Requirements and Evaluation | Pending | Needs a dedicated ADR if media tooling becomes a durable architectural policy instead of an implementation detail. |
| Keep the runner unauthenticated in the current MVP | `SPEC.md` Known Limitations And Non-Goals | Pending | Needs security context and intended deployment boundary before recording as an accepted architectural decision. |
| Defer distributed queueing, distributed locking, and managed metadata storage | `README.md` Azure Shape; `SPEC.md` Known Limitations And Non-Goals | Pending | Needs future scale requirements before documenting the replacement decision. |
