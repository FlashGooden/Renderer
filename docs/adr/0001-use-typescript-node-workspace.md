# ADR 0001: Use a TypeScript Node.js Workspace

**Status**: Accepted
**Date**: 2026-05-17

## Context

The project is a CLI-first personal avatar motion-retargeting tool. Existing repository materials describe a Node.js workspace with `packages/cli`, `packages/cloud-runner`, and `packages/core`. The root `package.json` uses npm workspaces, native ESM, TypeScript, strict compilation, and shared build, typecheck, and test scripts.

The system needs a command-line interface, a small HTTP runner, shared contracts, storage drivers, provider adapters, persistence, and orchestration behavior. Those responsibilities must stay separated enough that CLI and runner code can share core logic without duplicating contracts or runtime behavior.

## Decision

Use a TypeScript Node.js workspace organized around separate packages for the CLI, HTTP runner, and shared core behavior.

The workspace keeps contributor entry points in `packages/cli`, runner service code in `packages/cloud-runner`, and reusable contracts, storage, provider, persistence, evaluation, and orchestration code in `packages/core`.

## Consequences

This structure gives the project one build and test surface while keeping runtime responsibilities clear. TypeScript strict mode helps preserve shared contracts across package boundaries, and npm workspaces keep local package development simple.

The project remains tied to a Node.js toolchain and native ESM assumptions. Contributors need to understand the package boundaries before moving behavior between CLI, runner, and core modules.

## Related Records

- [ADR 0002: Keep a CLI-First Runner Architecture](0002-cli-first-runner-architecture.md)
