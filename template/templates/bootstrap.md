---
id: <YYYY-MM-bootstrap>                # canonical bootstrap change-id; one per project
type: change-spec                      # bootstrap is a change-spec variant, not a new type
status: draft
owner: <git-handle>
area: bootstrap                        # the no-story carve-out for the bootstrap variant; SP-09 satisfied via this
surfaces: [infra]                      # bootstrap is infra-only; UI / agent / api work begins post-bootstrap
user-stories: []                       # bootstrap has no user-story; the area: bootstrap field satisfies SP-09 as a third carve-out alongside internal-tooling and enables
related-spec: bootstrap                # equals area
related-adrs: []                       # populated with every stack ADR from Phase 4
creates-tech-debt: []
resolves-tech-debt: []
parent-change: null
children: []
revisits-change: []
internal-tooling: false                # bootstrap is NOT internal-tooling — the code ships on the user path
enables: []                            # bootstrap implicitly enables every downstream change-spec; the explicit list would be degenerate, so we leave it empty and rely on area: bootstrap as the SP-09 carve-out
enabled-by: []
trivial: false
in-scope: []                           # explicit file enumeration — NOT ["."]
out-of-scope: []                       # required, may be empty
threat-model-delta: true               # bootstrap always touches threat-model (auth posture, RLS defaults, secret handling)
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

## Problem

_What this change is doing: standing up the repo from empty. One paragraph._

This change scaffolds the project from an empty repository to a bootable, tested, and ready-to-ship state. It is the only change in the project's history with `area: bootstrap`; subsequent changes target real modules.

## Current Behavior

_N/A for bootstrap — there is no current state. Repository is empty (or contains only `hstack/` after greenfield-init Phases 1–5)._

- N/A.

## Target Behavior

_What shipping looks like, observably. Bootstrap's targets are bootability and gate-passing, not feature behavior._

- The repository builds: `<configured-build-command>` exits 0.
- The repository's test suite runs and passes: `<configured-test-command>` exits 0.
- Every module declared in `app-architecture.md` Section 1 has a corresponding source directory with the minimal shell required for the module-spec to be reverse-engineered post-merge.
- The initial migration sequence sketched in `data-architecture.md` Section 5 lands as actual `.sql` files under `supabase/migrations/` (or the chosen DB's migration directory) in the order: schema → RLS → pgvector → seeds.
- CI runs the canonical commands from `ci-cd.md` and the gates pass.

## Acceptance Criteria

_GIVEN / WHEN / THEN. Bootstrap's acceptance is gate-based, not user-flow-based._

GIVEN the repository at HEAD
WHEN the engineer runs `<configured-build-command>` and `<configured-test-command>`
THEN both exit 0 and no test is skipped.

GIVEN the database after `m_0002_rls_policies.sql` has run
WHEN any tenant-scoped table is queried without setting `app.<tenant-column>`
THEN the query returns zero rows (RLS enforced from line zero).

GIVEN the repository at HEAD
WHEN a downstream engineer runs `/hstack:module-spec <module>` for any module from `app-architecture.md` Section 1
THEN the Skill finds a target directory to reverse-engineer against and does not halt on missing source.

## Invariants

_Three or more bullets per SP-04. Bootstrap's invariants name the foundational guarantees that must survive every future change._

- **RLS-enforced from line zero.** Every tenant-scoped table created by `m_0001_initial_schema.sql` has its RLS policy applied in `m_0002_rls_policies.sql` BEFORE any data lands. The migration ordering is a contract, not a convenience.
- **Module boundaries match the declaration.** Every module in `app-architecture.md` Section 1 has a corresponding source directory; no module is silently dropped or renamed during scaffold. Future changes cannot add modules without updating the declaration first.
- **Stack ADRs are authoritative.** Every choice in this scaffold (framework, DB client, auth integration, hosting deploy file, observability wiring) traces to an ADR from Phase 4. No silent stack divergence.

## Scope Boundaries

_Pointer to `in-scope` and `out-of-scope` frontmatter arrays. Bootstrap's `in-scope` is an explicit enumeration of every file being created. Wildcards are permitted but the engineer must list every top-level destination explicitly so the implementer's scope-lock does meaningful work._

The `in-scope` enumeration is the contract: the implementer creates exactly the listed files and no others. Files appearing in the final scaffold but not in `in-scope` indicate a scaffold-spec gap and require a scope amendment.

## Surfaces

_Pointer to `surfaces` frontmatter. Bootstrap is `[infra]` only — UI / agent / api / db / auth surface work begins with the first feature change-spec after bootstrap merges._

- **infra**: build configuration, dependency manifest, CI workflow, DB migration tooling setup, deployment configuration, observability wiring.

UI work begins post-bootstrap; the scaffold ships only the minimum shell (layout, theme tokens) needed for the build to pass.

## Linked Stories and Personas

_N/A — bootstrap has `user-stories: []` and satisfies SP-09 via `area: bootstrap`. The bootstrap variant is a third carve-out alongside `internal-tooling: true` (Category A) and `enables: [...]` (Category B); `area: bootstrap` is mutually exclusive with both. See kernel addendum for the rule._

## Related ADRs and Tech-Debt

_Every stack ADR from Phase 4 (greenfield-init) goes here as a pointer with one-sentence justification. Examples:_

- ADR-NNNN — Stack defaults adopted: <list>. Adopted as the project foundation.
- ADR-NNNN+1 — Observability stack: PostHog + Sentry. Configured in this scaffold.

## Resolves Tech-Debt

_N/A — bootstrap creates the project; it does not resolve prior tech-debt._

## Open Questions

_Populated when status moves from draft to ready-to-plan. Bootstrap-specific examples: "Do we lint the migration SQL via sqlfluff or via Supabase's built-in lint?" "Do we vendor a UI component library in the initial commit or wait for the first UI feature?"_
