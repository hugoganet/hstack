---
id: KF-<NNNN>-<slug>
type: kernel-fit-finding
status: open                           # open | acknowledged | dismissed | promoted | superseded | archived
owner: null                            # git-handle of the triager; null until first triage
pattern: <KF-P1 | KF-P2 | KF-P3 | …>   # detector pattern that fired; enumerated in scripts/telemetry/insights/kernel_fit.py
confidence: medium                     # high | medium | low
detected-by: kernel-fit-analyst
detected-at: <ISO-8601 timestamp>
evidence-row-count: 0                  # integer; must equal len(evidence-rows) per KF-01
evidence-rows: []                      # YAML array of {change|adr|td, signal} dicts; one entry per row counted above
related-findings: []                   # KF ids — prior or adjacent findings on the same kernel surface
promoted-to: null                      # `adr:<ADR-NNNN-slug>` | `tech-debt:<TD-NNNN-slug>` | null; reciprocal with the target artifact's `promoted-from-kernel-fit`; required when status: promoted
dismissed-reason: null                 # ≥50 chars of prose; required when status: dismissed (per KF-05)
superseded-by: null                    # KF id when status: superseded
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

## Title

_Short noun phrase naming the kernel-fit gap. Example: "internal-tooling flag conflates two categories."_

## Pattern fired

_Name the detector pattern (KF-P1 / KF-P2 / KF-P3 / …) and one paragraph describing what the detector found. Quote the pattern's defining condition from `kernel_fit.py` if helpful._

## Evidence

_Per evidence row, a 2–3 sentence prose summary with at least one inline citation (change-id, ADR-id, TD-id, commit-sha, kernel section). KF-01 requires `len(evidence-rows)` in frontmatter to equal `evidence-row-count`; the prose here must cite each row at least once. No prose without a citation._

1. ...
2. ...

## Kernel surface implicated

_Single-sentence pointer to the kernel section, template, validator rule, or Skill flow that the finding suggests revising. Examples: "`template/CLAUDE.md § Frontmatter contract` — the `internal-tooling` field"; "`template/templates/change-spec.md` frontmatter — `surfaces` enum"; "`/hstack:adversarial-review` precondition check at SKILL.md line 61"._

## Proposed direction

_One paragraph. Name a direction the kernel revision could take — split a flag, add an enum case, add a Skill precondition, amend a section. This is NOT a full ADR — that work is done by `spec-author` if and when the engineer invokes `/hstack:kernel-fit-promote`. Keep this as a sketch, not a specification._

## Counter-explanations (challenge prompt — mandatory)

_Two reasons this finding might NOT warrant a kernel change. If you cannot produce two, the analyst auto-downgrades `confidence` to `low` per KF-03. The challenge defends against false-positives the same way `## Consequences` § "name two consequences that look bad" defends ADRs._

1. ...
2. ...

## Confidence rationale

_One paragraph defending the `confidence` enum value against the validator rules. `high` requires `evidence-row-count >= 3` AND ≥2 distinct change-specs cited (KF-02). `medium` is the conservative default. `low` carries no notification and is appropriate when evidence is thin or the challenge prompts substantially weaken the finding._

## Triage Log

_Populated by `/hstack:kernel-fit-triage` and `/hstack:kernel-fit-promote` as the finding's status transitions. Section is empty until the first transition out of `open`._

- `status: open → acknowledged` on `<YYYY-MM-DD>` by `<owner>`. Triggered by `/hstack:kernel-fit-triage <id> --action acknowledge`.
- `status: open → dismissed` on `<YYYY-MM-DD>` by `<owner>`. Reason: `<dismissed-reason>`.
- `status: acknowledged → promoted` on `<YYYY-MM-DD>` by `<owner>`. Promoted to: `<promoted-to>`. Triggered by `/hstack:kernel-fit-promote <id> --slug <adr-slug>`.
- `status: open → superseded` on `<YYYY-MM-DD>` by the next `kernel-fit-analyst` run. Superseded by: `<superseded-by>`.
