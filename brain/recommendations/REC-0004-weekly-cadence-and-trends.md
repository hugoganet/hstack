---
id: REC-0004-weekly-cadence-and-trends
title: Run telemetry weekly across all repos and read trends, not snapshots
status: accepted
confidence: high
category: workflow
impact: high
effort: small
sources: [moso-app, rhizome, ai-session-memory, accounting_system]
created: 2026-07-11
updated: 2026-07-11
---

## Observation

- Between 2026-05-22 and 2026-07-11, exactly one telemetry report existed
  across four consuming repos (moso-app, 2026-05-22). rhizome,
  ai-session-memory and accounting_system had never been analyzed despite
  active hstack usage (110, 75 and 190 commits in their 30-day windows).
- The May report's watch-list items (test-immutability candidates,
  scope-amendment rate) reappear unchanged in the July report — the loop
  detected, nobody observed.

## Why it matters

hstack improvements play out over weeks: a kernel change needs several
subsequent sessions before its effect is visible in cache-hit ratios or
findings density. Without a cadence there is no baseline, and without
multiple dated snapshots there is no trend — every reading is an anecdote.

Counter-explanation: May–July was heavy feature-delivery time; skipping
retrospectives during a push is a rational trade. True, but that is exactly
what automation is for — collection costs zero LLM tokens.

## How to do it

- Schedule a weekly job (Claude Code cron) that runs
  `template/scripts/telemetry/report.py --repo <r> --window 30` for every
  consuming repo, then runs the `brain/ANALYSIS.md` analyst pass.
  [shipped 2026-07-11 — cron `hstack-weekly-telemetry`]
- Keep per-date JSON snapshots (never overwrite across dates); the UI picker
  already lists them per repo.
- Follow-up (not yet done): a trends view in `ui/` charting TE-2 global
  cache-hit, WS-4 amendment rate and QO-2 severity mix across report dates,
  once ≥3 weekly snapshots exist.

## Success measure

Four dated report JSONs per repo after one month; brain runs weekly with a
run summary; at least one recommendation moves proposed → accepted →
implemented off the back of a trend rather than a single snapshot.
