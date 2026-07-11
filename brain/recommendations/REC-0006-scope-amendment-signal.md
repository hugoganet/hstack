---
id: REC-0006-scope-amendment-signal
title: Disambiguate the scope-amendment signal before acting on it
status: proposed
confidence: medium
category: kernel
impact: medium
effort: medium
sources: [moso-app]
created: 2026-07-11
updated: 2026-07-11
---

## Observation

- WS-4 (moso-app): scope-amendment upper-bound rate 14.5% on the 30-day
  window but 49% on the 90-day window (2026-07-11 runs); the 2026-05-22
  report read 71%. The metric counts ANY spec.md write after
  ready-for-implementation, including status flips.
- WS-6 (30-day): `scope-amendment` is the top halt reason (16 of 36 halts),
  ahead of `test-immutability-protocol` (10).

## Why it matters

If even half of the post-RFI spec writes are real scope amendments, the
planner/test-strategist stage is systematically under-scoping changes — the
most expensive kind of workflow failure (each amendment burns an implementer
halt + engineer round-trip + re-load). But the metric cannot currently
distinguish a genuine scope change from a routine status transition, so
acting on it now risks fixing a non-problem.

Counter-explanation: the 90→30-day drop (49% → 14.5%) may mean the problem
is already fading as specs got better through June; or early-lifecycle specs
(May) were naturally more volatile. That is exactly why disambiguation must
come before any kernel change.

## How to do it

- Cheap first step in `insights/workflow_shape.py`: classify each post-RFI
  spec.md commit by diff shape — frontmatter-only status flip vs body-section
  change (In-Scope/Out-of-Scope/Invariants edits = real amendment). Git diffs
  make this mechanical; no new artifacts needed.
- Report both rates (flips vs real amendments) and the per-change list of
  real amendments.
- Only if the real-amendment rate stays >20% across several weekly reports:
  open a kernel-level recommendation on the planner/test-strategist
  challenge prompts (e.g. a mandatory "what files will this touch that the
  spec doesn't list?" probe).

## Success measure

WS-4 in a future report splits status-flips from real amendments; a
month of weekly data establishes whether the real rate is above or below
20%, closing this recommendation either into a kernel change or a rejection.
