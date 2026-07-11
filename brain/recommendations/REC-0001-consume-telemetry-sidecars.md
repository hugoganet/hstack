---
id: REC-0001-consume-telemetry-sidecars
title: Make report.py consume the .telemetry sidecars it already pays for
status: proposed
confidence: high
category: telemetry
impact: high
effort: medium
sources: [moso-app]
created: 2026-07-11
updated: 2026-07-11
---

## Observation

- 28 changes in moso-app carry `.telemetry/` sidecar directories with
  per-change JSON (change_id, per-phase implement timings, verify coverage,
  adversarial category/severity/resolution mixes) — e.g.
  `2026-06-knowledge-entity-detail/.telemetry/` holds 9 files.
- `report.py` and every module under `scripts/telemetry/` contain zero reads
  of sidecar files. TE-1's own note (report 2026-07-11, moso-app) says:
  "Per-change cost will sharpen once verify.json / finalize.json sidecars
  carry change_id" — but the sidecars already carry it.
- Consequence: TE-1 attributes cost per-Skill only; WS-1 phase durations are
  reconstructed from commit timestamps instead of the sidecars'
  started_at/completed_at.

## Why it matters

Five Skills pay the emission cost on every change (schema discipline, commit
coupling) and the reader half of the pipeline was never built — collected
data with no consumer is pure overhead. Joining sidecar change_ids would turn
TE-1 into a true per-change cost ranking, which is the single most actionable
economics view ("which change cost 40M cost-score and why").

Counter-explanation: the sidecar layer was explicitly staged as "emit in v1,
consume in v2" (telemetry-sidecar.md), so this is planned work, not a defect.
That explains the gap but doesn't justify keeping it: v1 emission has run for
2 months across 28 changes; the consumer is overdue. Confidence stays high.

## How to do it

- Add `parsers/sidecars.py`: walk `hstack/specs/changes/*/.telemetry/*.json`,
  return rows keyed by change_id (tolerate schema_version 1 only).
- TE-1: join sessions to changes via sidecar timestamps (session window
  overlaps implement/verify sidecar windows) and report per-change totals;
  keep the per-Skill table as fallback when no sidecar matches.
- WS-1: prefer sidecar started_at/completed_at over commit-timestamp deltas
  when present.
- Do NOT add new sidecar emitters — the five-Skill list is fixed by the
  kernel; this is a reader-side change only.

## Success measure

TE-1 in a future report shows a per-change table (change id, cost-score,
sessions) for every change with sidecars, and its v1 attribution note is
gone. WS-1 reports phase durations sourced from sidecars for ≥80% of phases.
