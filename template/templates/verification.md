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
test-plan-coverage:                    # observed-vs-promised against test-plan.md
  edge-cases: pending                  # all-observed | partial | missing
  tenant-isolation: pending            # all-observed | partial | missing | not-applicable
  performance-budgets: pending         # all-within-budget | regressed | missing | not-applicable
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

## Test-Plan Coverage

_Observed-vs-promised against `test-plan.md`. Three subsections; populate only those that apply to this change._

### Edge Cases

_Every bullet in the test-plan's Edge Cases section maps to an observed test. Absent or skipped tests are listed with a recommended action._

### Tenant Isolation

_Every entry in the test-plan's `tenant-isolation-tests` array maps to an observed negative test. Absences here are high-severity and escalate to adversarial-review (V-03)._

### Performance Budgets

_Every row in the test-plan's Budgets table maps to an observed assertion within budget. Regressions and absences block `status: passed` (V-04)._

| path | budget | observed | within budget |
| --- | --- | --- | --- |
|  |  |  |  |

## Test Suite Output

_Pointer to the captured stdout/stderr blob (`artifacts.test-output`)._

## Discrepancies

_Anything the verifier observed that the plan did not predict, with an action (file an issue, escalate to adversarial-review)._
