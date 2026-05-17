# Data Model: ADR Decision Records

**Date**: 2026-05-17
**Feature**: ADR collection documentation model

This feature models repository documentation rather than runtime data. Entities are Markdown
documents and their relationships.

---

## 1. ADR Collection

**Location**: `docs/adr/`

**Fields / Contents**:
- `README.md`: Explains the collection purpose, how to read records, status vocabulary, and how
  to add a record.
- `TEMPLATE.md`: Reusable structure for new ADRs.
- `COVERAGE.md`: Tracks identifiable existing decisions and whether each has a complete ADR or is
  pending documentation.
- `NNNN-short-kebab-title.md`: Individual decision records.

**Validation Rules**:
- Collection exists at a single root-level path.
- Collection guide links to the template, coverage tracker, and initial ADRs.
- Collection guide states that ADRs are for architectural and project-significant decisions, not
  routine implementation notes.

---

## 2. Decision Record

**Identity**: Four-digit numeric prefix plus descriptive kebab-case title.

**Required Fields**:
- `Title`: Human-readable decision name.
- `Status`: One of `Proposed`, `Accepted`, `Superseded`, or `Deprecated`.
- `Date`: ISO date when the decision record was created or accepted.
- `Context`: Problem, constraints, and relevant project facts.
- `Decision`: The choice made.
- `Consequences`: Benefits, tradeoffs, follow-up obligations, and known limitations.
- `Related Records`: Links to superseded, superseding, or related ADRs, or `None`.

**Relationships**:
- Belongs to one ADR Collection.
- May supersede one or more Decision Records.
- May be superseded by one later Decision Record.
- May satisfy one or more Coverage Notes.

**Validation Rules**:
- Identifier is unique within `docs/adr/`.
- Status uses the allowed vocabulary exactly.
- Current decisions use `Accepted`.
- Superseded records remain in place and link to the superseding record.
- Deprecated records state why the decision is no longer recommended.

---

## 3. Decision Status

**Allowed Values**:
- `Proposed`: Decision is under consideration and not current guidance.
- `Accepted`: Decision is current guidance.
- `Superseded`: Decision has been replaced by another ADR.
- `Deprecated`: Decision is no longer recommended but may not have a direct replacement.

**State Transitions**:

```text
Proposed -> Accepted
Accepted -> Superseded
Accepted -> Deprecated
Superseded -> Deprecated
```

Historical records are preserved during transitions.

---

## 4. Coverage Note

**Location**: `docs/adr/COVERAGE.md`

**Required Fields**:
- Decision topic.
- Source evidence, such as `README.md`, `SPEC.md`, or repository structure.
- Coverage status: `Documented` or `Pending`.
- Linked ADR when documented.
- Notes for pending decisions.

**Relationships**:
- Belongs to one ADR Collection.
- Maps to zero or one Decision Record.

**Validation Rules**:
- Every identifiable existing decision discovered during initial setup is listed.
- Every `Documented` note links to an ADR.
- Every `Pending` note explains what information is missing.
