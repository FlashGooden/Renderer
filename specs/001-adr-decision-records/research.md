# Research: ADR Decision Records

**Date**: 2026-05-17
**Feature**: ADR collection for the Personal Azure Avatar Project

---

## Decision 1: ADR Collection Location

**Decision**: Store ADRs in `docs/adr/` at the repository root.

**Rationale**: The feature requires a single discoverable place for decision records. Root-level
`docs/` is a conventional location for project documentation, and `docs/adr/` makes the purpose
obvious from the repository root without mixing architectural decisions into Spec Kit planning
artifacts under `specs/`.

**Alternatives considered**:
- `adr/` at repository root: discoverable, but less consistent if the project later adds more
  documentation categories.
- `docs/architecture/decisions/`: descriptive, but deeper than needed for a small personal
  project and slower to locate.
- `specs/adr/`: confuses durable project decisions with feature planning artifacts.

---

## Decision 2: ADR File Format

**Decision**: Use plain Markdown files with a numeric identifier prefix:
`NNNN-short-kebab-title.md`.

**Rationale**: Markdown is already used by the repository (`README.md`, `SPEC.md`, Spec Kit
documents), renders well on GitHub, and requires no tooling. A stable numeric prefix supports
chronological browsing and unique identification while allowing descriptive titles.

**Alternatives considered**:
- YAML/JSON decision files: easier to parse mechanically, but less readable for contributors and
  unnecessary for the current feature.
- Date-only filenames: useful for chronology, but less stable as identifiers and harder to cite.
- Wiki or external docs: less likely to stay versioned with code changes.

---

## Decision 3: ADR Required Sections

**Decision**: Each ADR must include title, status, date, context, decision, consequences, and
related records.

**Rationale**: These fields directly satisfy the spec requirements and give future readers enough
information to understand why the decision was made, whether it is current, and what tradeoffs it
created. The related-records field supports superseding and superseded decisions without deleting
history.

**Alternatives considered**:
- Minimal title/status/decision only: too little context for future contributors.
- Full MADR-style template with many optional sections: useful for larger organizations, but too
  heavy for this small project.

---

## Decision 4: Status Vocabulary

**Decision**: Use `Proposed`, `Accepted`, `Superseded`, and `Deprecated` as the ADR status
vocabulary.

**Rationale**: This matches the feature spec and covers the lifecycle required for future changes:
drafting, current guidance, replaced decisions, and intentionally retired decisions.

**Alternatives considered**:
- `Draft`, `Accepted`, `Rejected`: does not represent a current decision that later becomes
  replaced.
- More granular statuses such as `Amended` or `Obsolete`: unnecessary until the project has a
  larger decision history.

---

## Decision 5: Initial Decision Coverage

**Decision**: Seed ADRs for identifiable existing decisions documented in `README.md` and
`SPEC.md`, and capture any remaining unknowns in `docs/adr/COVERAGE.md`.

**Rationale**: The clarified spec requires initial records for identifiable existing decisions,
with pending coverage noted. Local project documents identify clear existing decisions: TypeScript
workspace structure, CLI-first runner architecture, Replicate DreamActor provider, local/Azure
Blob storage modes, and file JSON metadata storage.

**Alternatives considered**:
- Start with only a template and no ADRs: misses clarified coverage requirements.
- Block implementation until the user provides an exhaustive decision list: unnecessary because
  several decisions are already documented locally.
- Create speculative ADRs for decisions not visible in the repo: risks inventing history.

---

## Decision 6: Validation Strategy

**Decision**: Validate ADR work through documentation checks: required files exist, README links
to the collection, each ADR has required sections, statuses use the allowed vocabulary, and
coverage entries map to an ADR or pending item.

**Rationale**: This feature is documentation-only. Runtime unit tests and type checking do not
validate Markdown content unless custom tooling is introduced, which would add unnecessary
implementation scope.

**Alternatives considered**:
- Add a Markdown lint dependency: unnecessary for the current scope and would introduce tooling
  unrelated to the product behavior.
- Run only manual review: acceptable but less precise than an explicit checklist in quickstart
  and tasks.
