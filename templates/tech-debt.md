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

_What "resolved" looks like. Once `status: resolved`, no field rewrites are permitted (validator rule TD-03)._
