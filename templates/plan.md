---
id: <parent-change-id>-plan
type: plan
status: draft                          # draft | ready | in-progress | completed | archived
owner: <git-handle>
parent-change: <change-spec-id>
steps-completed: []                    # populated by `implementer` as phases finish
blocked-on: null                       # phase id when an interactive blocker stops progress
oversized-plan-justification: null     # required when phase count > 12
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

## Phase Overview

_Table of phases. Three columns max._

| step-id | summary | depends-on |
| --- | --- | --- |
| phase-1- |  | none |

## Per-Phase Detail

_One subsection per phase. 4–8 phases typical. >12 requires `oversized-plan-justification` in frontmatter._

### phase-1-

**Purpose.** _One sentence._

**Files Touched.** _Subset of `change-spec.in-scope`. Bullets._

-

**Test Strategy.** _Which test files, what they assert._

**Risk.** _One sentence on what could go wrong locally._

**Verifier Expectations.** _What `verifier` must observe to mark this phase passed._

## Cross-Phase Risks

_Challenge prompt: what could go wrong across phase boundaries that no single phase catches? 1–3 bullets._

-

## Rollback

_What to do if a partial rollout in production breaks something. 2–4 sentences._
