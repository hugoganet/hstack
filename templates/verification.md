---
id: <parent-change-id>-verification
type: verification
status: draft                          # draft | ran | passed | failed | superseded
owner: <git-handle>
parent-change: <change-spec-id>
test-results:
  unit: pending                        # pass | fail | pending | not-run
  integration: pending
  e2e: pending
  lint: pending
  typecheck: pending
phase-coverage: {}                     # mirror of plan.steps-completed; { <phase-id>: pass | fail }
artifacts:
  test-output: <path>
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

## Summary

_Single-sentence verdict._

## Per-Phase Outcomes

_Table of phase id, verifier expectations met (yes/no), notes. Three columns max._

| phase-id | met | notes |
| --- | --- | --- |
|  |  |  |

## Test Suite Output

_Pointer to the captured stdout/stderr blob (`artifacts.test-output`)._

## Discrepancies

_Anything the verifier observed that the plan did not predict, with an action (file an issue, escalate to adversarial-review)._
