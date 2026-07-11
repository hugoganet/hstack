---
id: REC-0003-denoise-qo3-test-immutability
title: Denoise QO-3 — only flag modifications/deletions of existing tests
status: proposed
confidence: high
category: telemetry
impact: high
effort: small
sources: [moso-app]
created: 2026-07-11
updated: 2026-07-11
---

## Observation

- QO-3 candidate violations: 158 (30-day report, 2026-07-11) and 265 (90-day
  run, same date) in moso-app. The 2026-05-22 report already flagged 11 and
  its watch-list said "review manually" — seven weeks later the list only
  grew and nothing was reviewed.
- Sampling the flagged commits: most add NEW test files (e.g.
  `test(knowledge): phase-2 kbx tenant-isolation harness + integration
  tests`), which the kernel's test-immutability rule explicitly permits
  without authorization. They are flagged only because the commit isn't
  classified as an implement-phase commit.

## Why it matters

Test immutability is the kernel's single most load-bearing rule, and its
audit metric is unusable: a signal with hundreds of mostly-false positives
gets ignored, so a REAL unauthorized assertion edit would sail through
unnoticed. This is worse than having no metric.

Counter-explanation: the metric calls itself "candidates for manual review,
not verdicts", so by its own framing it's working as designed. But a
designed-in 95%+ false-positive rate on a security-grade rule is a design
defect; the repeated, unactioned watch-list entries across two months prove
the framing doesn't survive contact with practice.

## How to do it

- In `parsers/commits.py` / `insights/quality_outcomes.py`, use per-file diff
  status: flag only commits where an EXISTING test file was modified or
  deleted (`git log --diff-filter=MD -- <test patterns>`), never additions.
- Keep the authorization-phrase whitelist as is; a modification WITH the
  canonical phrase in the commit body stays authorized.
- Report the count of new-test-only commits as a separate, informational
  line (it is a healthy signal, not a violation).

## Success measure

QO-3 candidate list in a future 30-day report drops below ~10 rows, each one
a genuine modification/deletion worth human eyes; watch-list entry stops
repeating verbatim week over week (either empty or acted on).
