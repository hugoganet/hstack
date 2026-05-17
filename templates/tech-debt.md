---
id: TD-<NNNN>-<slug>
type: tech-debt
status: open                           # open | in-progress | resolved | wontfix | archived
owner: <git-handle>
severity: low                          # critical | high | medium | low
origin: <change-spec-id-or-found-later>
introduced-by: <change-spec-id>        # required when origin is a change-spec; reciprocal with change-spec.creates-tech-debt
cost: small                            # small | medium | large
fix-sketch-effort: small
related-modules: []
target-resolve-by: null                # required when severity: critical
resolution-attempted-at: null          # ISO date set when status flips open -> in-progress (resolution begun)
resolved-by: null                      # change-spec id that resolved this debt; reciprocal with change-spec.resolves-tech-debt; required when status: resolved
wontfix-reason: null                   # one-sentence reason; required when status: wontfix
wontfix-accepted-alternative: null     # one-sentence note on what we are accepting instead; required when status: wontfix
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

## Title

_Short noun phrase._

## Why we took the shortcut

_One or two sentences._

## What it costs us

_Observable cost today, projected cost at scale._

## Fix sketch

_What fixing would look like — code shape, scope, side effects._

## Pre-conditions for fixing

_What must be true first (other dependencies resolved, design tokens normalized, etc.)._

## Acceptance

_What "resolved" looks like — observable, verifiable bullets the adversarial-reviewer can check against the resolving change's diff. The resolving change-spec's Target Behavior must satisfy these bullets verbatim or as a superset. Once `status: resolved`, no field rewrites are permitted (TD-03)._

## Resolution Log

_Populated by `spec-author` as the resolution progresses. Section is empty until the first transition out of `open`._

- `status: open → in-progress` on `<resolution-attempted-at>` by `<owner>`. Triggered by `/hstack:tech-debt-resolve <id>`. Resolving change-spec scaffolded at `<change-spec-id>`.
- `status: in-progress → resolved` on `<date>` by `<owner>`. Resolving change-spec: `<change-spec-id>`. Adversarial-review Acceptance-satisfied confirmation: `<adversarial-review-id>`.

_Alternatively, for the wontfix path:_

- `status: open → wontfix` on `<date>` by `<owner>`. Reason: `<wontfix-reason>`. Accepted alternative: `<wontfix-accepted-alternative>`.
