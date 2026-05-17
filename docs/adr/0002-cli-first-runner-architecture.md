# ADR 0002: Keep a CLI-First Runner Architecture

**Status**: Accepted
**Date**: 2026-05-17

## Context

The current project is described as a CLI-first Phase 1 MVP for short avatar motion-retargeting experiments. The CLI supports uploading media, submitting runs, checking status, fetching artifacts, reviewing completed runs, and comparing run results. The runner is intentionally small and exposes a minimal HTTP API for health checks, assets, runs, reviews, and artifact downloads.

The project is personal tooling rather than a multi-user application. There is no UI beyond the CLI, and the runner can execute locally or in simple Azure-hosted compute such as Azure Container Apps or a VM.

## Decision

Keep the architecture CLI-first, with a small HTTP runner that performs local or hosted run orchestration behind CLI commands.

The CLI remains the primary user interface. The runner exposes only the HTTP API needed by the CLI and stores enough state to execute asynchronous provider jobs, capture artifacts, support manual review, and serve fetched outputs.

## Consequences

The project can stay lightweight and scriptable while still separating user commands from long-running provider orchestration. The same workflow can run locally or against a hosted runner by changing configuration.

This architecture does not provide a browser UI, authentication, authorization, distributed queueing, or a multi-worker execution model. Those concerns need separate decisions if the project moves beyond personal or trusted-environment usage.

## Related Records

- [ADR 0001: Use a TypeScript Node.js Workspace](0001-use-typescript-node-workspace.md)
- [ADR 0005: Use File JSON Metadata Storage](0005-use-file-json-metadata-store.md)
