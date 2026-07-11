# hstack brain

Cross-repo intelligence layer for the hstack workflow itself. Where per-repo
telemetry (`hstack/telemetry/`) and kernel-fit (`hstack/kernel-fit/`) observe
ONE consuming repo, the brain synthesizes across ALL of them and produces
**recommendations** — durable, evidence-backed proposals to improve the hstack
workflow (kernel, Skills, subagents, telemetry tooling).

The loop, mirroring the kernel's own closed-loop discipline (ADR-0004):

1. **Collect** — weekly, `report.py` runs against every consuming repo and
   emits `hstack/telemetry/reports/<date>.{md,json}` in each.
2. **Analyze** — an AI session reads the fresh JSONs + the kernel + prior
   recommendations, follows `ANALYSIS.md`, and writes/updates recommendation
   files under `recommendations/`.
3. **Review** — the engineer reads them in the telemetry UI (`ui/`, Brain tab)
   and flips `status` to `accepted` / `rejected`.
4. **Act** — accepted recommendations become changes to this repo (kernel
   edits, Skill fixes, script fixes), shipped through the normal workflow.
   Once shipped, `status: implemented`.

**The human gates every change.** The analyst writes recommendations; it never
edits the kernel, Skills, or scripts. Same contract as kernel-fit promotion.

Improvements here play out on the long term: a kernel change needs several
weeks of sessions across repos before its effect shows in the metrics. The
weekly cadence and the per-date report snapshots exist so that trend, not
single-snapshot noise, drives decisions.

## Layout

```
brain/
  README.md                    # this file
  ANALYSIS.md                  # the analyst prompt — what the weekly AI run does
  templates/recommendation.md  # frontmatter + section contract
  recommendations/REC-NNNN-<slug>.md
```

## Recommendation lifecycle

`proposed → accepted → implemented`, or `proposed → rejected`. Status is
edited by the engineer (directly or by telling the analyst); the analyst may
only move `proposed → superseded` when it replaces its own earlier finding,
and may append new evidence to an existing recommendation on later runs.
