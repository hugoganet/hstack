---
id: <parent-change-id>-security-review
type: security-review
status: draft                          # draft | in-progress | passed | concerns-acknowledged | failed | superseded
owner: <git-handle>
parent-change: <change-spec-id>
scoring-mode: llm-scored               # v1; v2 introduces 'executed'
scores:
  data-at-rest: not-applicable         # pass | concerns | fail | not-applicable
  data-in-transit: not-applicable
  authn: not-applicable
  authz-rls: not-applicable
  tenant-isolation: not-applicable
  input-validation: not-applicable
  output-encoding: not-applicable
  secrets-handling: not-applicable
  agent-prompt-injection: not-applicable
  audit-logging: not-applicable
concerns-acknowledged-by: null         # handle required when any score is `concerns`
threat-model-delta-required: false     # true when surfaces touches agent | auth | api | db
challenge-prompts-answered: 0          # must equal 3 to pass
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

## Surfaces Touched

_Pointer to change-spec `surfaces`. One sentence per surface._

## Hardening Items Scored

_For every applicable checklist item, a one-paragraph rationale for the score. Bias toward CONCERNS rather than PASS when evidence is thin._

### data-at-rest

### data-in-transit

### authz-rls

### tenant-isolation

### input-validation

### audit-logging

## Threat-Model Delta

_Required when `threat-model-delta-required: true`. One paragraph delta against the current threat-model.md. Refuse to score until this is non-empty when surfaces require it._

## Challenge Prompts

_All three required. Each answer must be at least one paragraph._

### (a) What attack vector did the In-Scope diff create that is NOT covered by the hardening checklist? If none, justify.

### (b) Which tenant_isolation guarantee does this change depend on? Cite the line of code that enforces it.

### (c) What part of this change would behave incorrectly under a malicious payload that the test suite does not cover?

## Open Concerns

_When any score is `concerns`: what acknowledgement is required and by whom. Ack must be human-confirmed by `owner` before status: concerns-acknowledged._
