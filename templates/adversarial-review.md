---
id: <parent-change-id>-adversarial-review
type: adversarial-review
status: draft                          # draft | in-progress | findings-open | findings-resolved | superseded
owner: <git-handle>
parent-change: <change-spec-id>
findings-floor: 3                      # 3 default; 5 when change-spec.area in {agent, auth, billing}
findings: []                           # array of finding records; see below
findings-fewer-than-floor: false
justification-when-fewer: null         # required when findings-fewer-than-floor: true
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

_One subsection per finding (F-01..F-N). Mandate: at least `findings-floor` findings across categories, or `findings-fewer-than-floor: true` with justification._

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

_Populated only when `findings-fewer-than-floor: true`. Explain why fewer than the floor is the honest answer._
