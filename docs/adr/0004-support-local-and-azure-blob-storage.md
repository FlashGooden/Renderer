# ADR 0004: Support Local and Azure Blob Storage

**Status**: Accepted
**Date**: 2026-05-17

## Context

The project stores uploaded reference images, driving videos, and generated output artifacts. Existing documentation describes two storage modes: local disk storage for local experimentation and Azure Blob Storage for hosted runner deployments. Configuration is controlled by `AVATAR_STORAGE_MODE`, `AVATAR_DATA_DIR`, and `AVATAR_AZURE_BLOB_BASE_URL`.

The runner is intended to run locally or on simple Azure-hosted compute. Provider integrations may need either URLs or local file bytes depending on the storage mode and provider request shape.

## Decision

Support both local disk storage and Azure Blob Storage for uploaded media and generated artifacts.

Local mode stores blobs under the configured data directory. Azure Blob mode writes blobs to paths derived from the configured container URL and SAS query parameters. When provider execution requires local files, Azure-backed assets may be materialized temporarily and cleaned up after the run.

## Consequences

Local mode keeps development and personal experiments simple. Azure Blob mode gives hosted runner deployments a way to store media outside ephemeral compute storage and provide provider-accessible URLs when suitable.

Azure Blob support remains minimal. It assumes the configured URL and SAS token are valid, and current documentation identifies artifact streaming from Azure Blob as unsupported. Future durability, access-control, and streaming changes should be recorded in later ADRs.

## Related Records

- [ADR 0003: Use Replicate DreamActor M2.0 as the Default Provider](0003-use-replicate-dreamactor-provider.md)
- [ADR 0005: Use File JSON Metadata Storage](0005-use-file-json-metadata-store.md)
