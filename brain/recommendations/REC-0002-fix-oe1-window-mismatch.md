---
id: REC-0002-fix-oe1-window-mismatch
title: Fix the window mismatch that zeroes OE-1 and OE-5 for older changes
status: proposed
confidence: high
category: telemetry
impact: medium
effort: small
sources: [moso-app]
created: 2026-07-11
updated: 2026-07-11
---

## Observation

- OE-1 (report 2026-07-11, moso-app, 30-day window): 70 of 76 changes show
  "diff lines = 0" and no ratio, including changes that demonstrably shipped
  thousands of diff lines (2026-05-knowledge-kg-schema-evolution showed 3481
  diff lines in the 2026-05-22 report, 0 in the 2026-07-11 one).
- Cause: artifact tokens are computed from files on disk (all history) while
  diff lines come from commits inside the `--window`. Changes older than the
  window keep their artifact tokens but lose their commits.
- OE-5 has the same defect: "files touched in implement" reads 0 for every
  shipped change older than the window.

## Why it matters

A metric where 92% of rows are structurally empty buries the 4 real signals
and trains the reader to skip the section. OE-1 is the overengineering
headline metric; it should be trustworthy at any window.

Counter-explanation: one could argue the window is honest ("only recent
changes are in scope"). But then the artifact-token side should be windowed
too — mixing windowed and unwindowed inputs in one ratio is the defect, not
the window itself.

## How to do it

- In `insights/overengineering.py`, restrict the OE-1/OE-5 change set to
  changes whose implement commits fall inside the window (drop the rest),
  OR compute diff lines per change from that change's own commits regardless
  of window. Prefer the first: it keeps the report window-consistent.
- Add a one-line note under the table stating how many changes were excluded
  as out-of-window, so the cap is visible (no silent truncation).

## Success measure

OE-1 in a future 30-day report contains only rows with non-zero diff lines
plus an explicit "N changes out of window" note; zero rows with artifact
tokens > 10k and diff lines = 0.
