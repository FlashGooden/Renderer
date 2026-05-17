# ADR 0005: Use File JSON Metadata Storage

**Status**: Accepted
**Date**: 2026-05-17

## Context

The current runner persists assets, runs, and reviews under the configured data directory. Existing documentation describes JSON metadata files for assets, runs, and reviews, with writes performed through a temporary file followed by rename.

The runner is intentionally small and can run locally or on simple Azure-hosted compute. The documented MVP does not include a managed database, distributed locking, a multi-worker queue, or remote concurrency support.

## Decision

Persist metadata as local JSON files under the configured data directory.

Assets are stored under `<dataDir>/assets`, runs under `<dataDir>/runs`, and reviews under `<dataDir>/reviews`. File writes use a `.tmp` file and rename into place to reduce the chance of partial JSON records.

## Consequences

JSON files are easy to inspect, back up, and debug during local and personal hosted experiments. This choice keeps the runner simple and avoids adding database infrastructure before the project needs it.

The metadata store is not a remote database and does not provide distributed concurrency control. It is best suited to a single runner process with attached disk. A future move to managed storage, a queue, or distributed workers should supersede or amend this ADR.

## Related Records

- [ADR 0002: Keep a CLI-First Runner Architecture](0002-cli-first-runner-architecture.md)
- [ADR 0004: Support Local and Azure Blob Storage](0004-support-local-and-azure-blob-storage.md)
