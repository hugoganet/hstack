# Recommendation template

One file per recommendation at `brain/recommendations/REC-NNNN-<slug>.md`.
The UI parses the frontmatter and the `##` sections below — keep both exact.

```markdown
---
id: REC-NNNN-<kebab-slug>
title: <one-line imperative summary>
status: proposed            # proposed | accepted | rejected | implemented | superseded
confidence: medium          # high | medium | low — strength of the evidence
category: telemetry         # telemetry | kernel | skills | subagents | workflow | ui
impact: medium              # high | medium | low — expected effect on the workflow
effort: small               # small | medium | large — cost to implement
sources: [moso-app]         # repos whose data supports this
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

## Observation

What the data shows. Cite concrete numbers from the telemetry JSONs
(metric key, repo, value, date). No speculation in this section.

## Why it matters

The causal story: what this costs (tokens, trust, missed signal) and what
improves if fixed. Include the counter-explanation: the most plausible
innocent explanation of the same data, and why the recommendation stands
(or is only medium/low confidence) despite it.

## How to do it

Concrete steps against this repo — files to touch, the shape of the fix,
what NOT to change. Small enough to scope a change from.

## Success measure

The metric (and threshold) in a future telemetry report that will show the
change worked. Name the report section (e.g. TE-1, QO-3, watch-list).
```

Body sections are plain markdown paragraphs and `-` bullet lists only —
the UI renderer supports exactly that.
