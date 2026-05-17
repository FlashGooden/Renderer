# ADR 0003: Use Replicate DreamActor M2.0 as the Default Provider

**Status**: Accepted
**Date**: 2026-05-17

## Context

The project performs avatar motion-retargeting experiments from a reference image and driving video. Existing documentation identifies Replicate DreamActor M2.0 as the default production provider, accessed through Replicate's asynchronous Predictions API. Mock providers remain available only for tests and offline fixtures.

The provider flow needs to validate media constraints, submit provider requests, poll until a terminal status, capture provider request and response artifacts, download generated output, and normalize provider failures.

## Decision

Use Replicate DreamActor M2.0 as the default production provider under the provider ID `replicate-dreamactor`.

Provider configuration is supplied through environment variables or `avatar.config.json`, including `AVATAR_REPLICATE_API_TOKEN`, `AVATAR_REPLICATE_MODEL`, timeout, and poll interval settings. The default model is `bytedance/dreamactor-m2.0`.

## Consequences

The project has a real provider path for useful motion-retargeting experiments while retaining mock providers for tests and offline fixtures. Capturing provider artifacts improves traceability when runs fail or need review.

The production path depends on Replicate availability, account credentials, model behavior, and provider-specific media constraints. Provider failures must be normalized for users, and local assets may need to be converted into data URLs when direct blob URLs are unavailable.

## Related Records

- [ADR 0002: Keep a CLI-First Runner Architecture](0002-cli-first-runner-architecture.md)
- [ADR 0004: Support Local and Azure Blob Storage](0004-support-local-and-azure-blob-storage.md)
