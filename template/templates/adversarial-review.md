---
id: <parent-change-id>-adversarial-review
type: adversarial-review
status: draft                          # draft | in-progress | findings-open | findings-resolved | superseded
owner: <git-handle>
parent-change: <change-spec-id>
findings-floor: 3                      # AR-06: 3 default; 5 when change-spec.area in {agent, auth, billing}. The area's expected finding count — measured by telemetry, gated by nothing (ADR-0014)
findings: []                           # array of finding records; see below
findings-fewer-than-floor: false       # true when the review came in under the expectation; must be true when `findings` is empty
justification-when-fewer: null         # required when findings-fewer-than-floor: true, and non-negotiable when `findings` is empty (AR-01)
fresh-session-attestation: <session-id; opened <ISO-8601>; no implementer transcript loaded>
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

<!--
Finding record shape:
  - id: F-NN
    category: security | scope-drift | invariant-breach | spec-compliance | data-integrity | code-quality
    severity: critical | high | medium | low
    status: open | resolved
    resolution: commit:<hash> | tech-debt:<id> | justified-in-prose
-->

## Methodology

_Fresh-session attestation; what artifacts were loaded; how findings were generated. v1 honor system; v2 verifies via session-id._

## Findings

_One subsection per finding (F-01..F-N). The six categories are lenses to sweep, not buckets to fill — file what the sweep found, at the severity it has. Calibration rubric: `hstack/.claude/skills/hstack-adversarial-review/references/finding-categories.md`._

### F-01

**Category.**

**What.** _The observation. 1–3 sentences._

**Why it matters.** _The consequence if left unaddressed._

**Severity rationale.**

**Recommendation.**

**Resolution.** _Commit hash, tech-debt id, or in-prose justification — must mirror the `resolution` value in frontmatter._

## Resolution Log

_Append-only record of how each finding was resolved. Written by `owner` in response to findings._

## Findings Floor Justification

_Populated when `findings-fewer-than-floor: true`, and mandatory when `findings` is empty (AR-01). Reading a change cold and reporting nothing is a claim: enumerate what was looked for in each of the six categories and why each sweep came back clean. "The change is small" is not a defence._
