---
id: REC-0005-cost-score-in-dollars
title: Report token economics in approximate dollars, not raw cost-score
status: proposed
confidence: medium
category: telemetry
impact: medium
effort: small
sources: [moso-app, rhizome, ai-session-memory, accounting_system]
created: 2026-07-11
updated: 2026-07-11
---

## Observation

- TE-1 (moso-app, 2026-07-11, 90-day window): top skill `change-new` shows
  cost-score total 688,346,000 (~688M). The unit is an internal weighting
  (input + 1.25×cache_creation + 0.10×cache_read + 5×output) defined in
  `parsers/transcripts.py::cost_score`.
- No report section, note or UI element translates the unit into anything an
  engineer can budget against. The weighting also hard-codes a single price
  ratio for all models, while sessions mix Opus/Sonnet/Haiku tiers.

## Why it matters

Token economics is the bucket meant to drive "is this Skill worth its cost"
decisions, and its numbers are unreadable at a glance. An approximate dollar
figure (even ±30%) turns "688M cost-score" into "≈ $X this quarter on
change-new", which is decision-grade.

Counter-explanation: cost-score is deliberately model-agnostic and stable
across price changes, which keeps trend lines comparable — dollars drift
when prices change. Valid; hence medium confidence and the recommendation to
show BOTH, not replace.

## How to do it

- Transcripts already carry per-message `model` and usage. Extend
  `tally_usage` to bucket tokens per model tier, and add a small static
  price table (per-MTok input/output/cache rates per tier) with a
  last-updated date.
- Render an "approx. $" column next to cost-score in TE-1/OE-3 (md + JSON),
  and keep cost-score for trends.
- State the approximation and price-table date in the section note.

## Success measure

TE-1 rows in a future report carry an approximate dollar column, and the
weekly brain summary can state "hstack overhead this week ≈ $N" per repo.
