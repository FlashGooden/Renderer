# Quickstart: ADR Decision Records

Use this checklist to verify the planned ADR collection after implementation.

## 1. Locate the ADR Collection

From the repository root, confirm a contributor can find the ADR collection:

```bash
ls docs/adr
```

Expected files:

```text
README.md
TEMPLATE.md
COVERAGE.md
0001-use-typescript-node-workspace.md
0002-cli-first-runner-architecture.md
0003-use-replicate-dreamactor-provider.md
0004-support-local-and-azure-blob-storage.md
0005-use-file-json-metadata-store.md
```

## 2. Confirm README Discoverability

Check that the root README points to the ADR collection:

```bash
grep -n "docs/adr" README.md
```

Expected result: at least one link or reference to `docs/adr/`.

## 3. Validate Required ADR Sections

For each `docs/adr/NNNN-*.md` file, confirm it includes:

- `Status`
- `Date`
- `## Context`
- `## Decision`
- `## Consequences`
- `## Related Records`

## 4. Validate Status Vocabulary

Confirm every ADR status is one of:

- `Proposed`
- `Accepted`
- `Superseded`
- `Deprecated`

## 5. Validate Initial Coverage

Open `docs/adr/COVERAGE.md` and confirm the identifiable existing decisions from `README.md`
and `SPEC.md` are either `Documented` with an ADR link or `Pending` with a note.

## 6. Type Checking and Tests

This feature is documentation-only. Do not run type checking or runtime tests unless the
implementation tasks introduce code or tooling. If code is added, run:

```bash
npm run typecheck
npm test
```
