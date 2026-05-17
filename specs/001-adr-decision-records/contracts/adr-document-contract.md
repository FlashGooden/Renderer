# Contract: ADR Document Structure

**Date**: 2026-05-17
**Feature**: ADR Decision Records

This contract defines the contributor-facing structure for ADR files created under `docs/adr/`.

## File Naming

```text
docs/adr/NNNN-short-kebab-title.md
```

Rules:
- `NNNN` is a unique four-digit sequence number.
- `short-kebab-title` is descriptive and lowercase.
- Existing ADR numbers are never reused.

## Required ADR Sections

Each ADR file MUST include these headings in this order:

```markdown
# ADR NNNN: Title

**Status**: Accepted
**Date**: YYYY-MM-DD

## Context

## Decision

## Consequences

## Related Records
```

## Status Vocabulary

| Status | Meaning |
|---|---|
| `Proposed` | Under consideration; not current guidance |
| `Accepted` | Current project guidance |
| `Superseded` | Replaced by a later ADR |
| `Deprecated` | No longer recommended, with or without a direct replacement |

## Coverage Contract

`docs/adr/COVERAGE.md` MUST list identifiable existing decisions discovered during setup.

Each coverage row MUST include:
- Decision topic
- Evidence
- Coverage status
- Linked ADR or pending note

Coverage status MUST be either `Documented` or `Pending`.

## README Contract

The repository root `README.md` MUST link to `docs/adr/` so a new contributor can find the ADR
collection from the repository root.
