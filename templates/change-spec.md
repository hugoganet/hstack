---
id: <YYYY-MM-area-slug>
type: change-spec
status: draft
owner: <git-handle>
area: <module-spec-id>
surfaces: []                           # subset of [ui, api, db, infra, agent]
user-stories: []
related-spec: <module-spec-id>         # must equal `area`
related-adrs: []
creates-tech-debt: []
parent-change: null
children: []
internal-tooling: false
trivial: false
in-scope: []                           # repo-relative globs; must be non-empty
out-of-scope: []                       # required, may be empty
threat-model-delta: false              # set true when surfaces touches agent | auth | api | db
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

## Problem

_What is broken or missing today, in user terms. One paragraph, 4–6 sentences._

## Current Behavior

_Observable behavior as it stands, including known gotchas. You may grep the In-Scope files to verify. 2–4 bullets._

-

## Target Behavior

_What shipping looks like, observably. 2–4 bullets._

-

## Acceptance Criteria

_GIVEN / WHEN / THEN form. At least one block per surface declared. Reviewed by product-manager when `surfaces` includes `ui`._

GIVEN
WHEN
THEN

## Invariants

_Name at least three things that look like they could change but must not. If you cannot name three, why is the change so narrow? (Validator rule SP-04.)_

-
-
-

## Scope Boundaries

_Pointer to `in-scope` and `out-of-scope` frontmatter arrays. One-sentence justification per excluded sibling directory._

## Surfaces

_Pointer to `surfaces` frontmatter. One sentence per surface explaining what is touched._

## Linked Stories and Personas

_Pointers, not duplicated content._

## Related ADRs and Tech-Debt

_Pointers with one-sentence justification each._

## Open Questions

_Populated when status moves from draft to ready-to-plan. Every question must be resolved or explicitly punted before ready-for-implementation._
