---
name: hstack-verify
description: |
  Use this skill after the implementer has completed every phase of the plan and the engineer wants `verification.md` produced from test, lint, and typecheck outcomes. The Skill orchestrates the `verifier` subagent — a mechanical role that runs the canonical commands from `ci-cd.md`, captures the output, and compares observed outcomes against each phase's Verifier Expectations. Examples:

  <example>
  Context: The implementer just finished phase-5 of the billing-overage plan and the engineer wants verification before adversarial review.
  user: "/hstack:verify 2026-05-billing-overage-warning"
  assistant: "I'll invoke verifier. It will run the canonical test/lint/typecheck commands from ci-cd.md, capture stdout/stderr to a pointer file, and write phase-coverage mirroring plan.steps-completed."
  <commentary>
  The verifier is mechanical and conservative. Any `failed` test result blocks status `passed` (V-02); discrepancies between predicted and observed test behavior land in section 4 with recommended actions.
  </commentary>
  </example>

  <example>
  Context: The test suite passed locally but the verifier observes that a Playwright test the plan promised actually skipped.
  user: "/hstack:verify 2026-06-knowledge-citations"
  assistant: "I'll invoke verifier. If a phase's Verifier Expectations name a test that skipped or is absent, the Discrepancies section captures it and the Skill refuses to mark status passed."
  <commentary>
  Discrepancies between predicted and observed behavior are exactly what section 4 exists to capture. Marking `passed` over a discrepancy would defeat the purpose of the gate.
  </commentary>
  </example>

  <example>
  Context: The integration suite is gated by `RUN_INTEGRATION=1` and the engineer ran `npm test` without setting it; the runner reported `Tests: 0 passed, 0 failed`.
  user: "/hstack:verify 2026-06-knowledge-citations"
  assistant: "I'll invoke verifier. Per V-05, an integration suite that executed zero tests is recorded as `not-run`, not `pass` — zero failures is not evidence of correctness when there were zero assertions to fail. The Skill halts at `status: ran` with a high-severity Discrepancy naming the suspected reason (env-gated, all-skipped, empty-collection, or filter-collapse)."
  <commentary>
  V-05 closes the verifier false-positive where a suite gated by an unset env var would silently pass on the absence of failures. The remediation is either supplying the missing env / fixture and re-running, or amending the plan's Verifier Expectations via scope amendment so the zero-test state is intentional and recorded.
  </commentary>
  </example>
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
  - "{{TODO-SCRIPT: hstack/scripts/run-gates.sh — runs the consuming repo's test/lint/typecheck suite and captures output, including an observed-test-count per suite for V-05}}"
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates verification.md frontmatter and V-01/V-02/V-05}}"
---

## Purpose

`hstack-verify` produces `verification.md` for a change by orchestrating the `verifier` subagent. The verifier is the mechanical reader of test, lint, and typecheck output. It does not score security or data; it does not produce findings; it does not interpret failing tests as flaky. It compares observed outcomes against each phase's Verifier Expectations as set by the planner.

## When to invoke

Invoke after `plan.steps-completed` covers every phase id in the plan body (the implementer is done with every phase). The Skill halts when `steps-completed` is incomplete — a partial verification run is meaningless.

## Inputs

- `<change-id>` (required, positional): the change-spec id.

## Preconditions

Before any work:

- Verify `hstack/specs/changes/<change-id>/spec.md`, `plan.md`, and `test-plan.md` all exist.
- Verify `plan.steps-completed` covers every phase id in the plan body. If not, halt — implementation is not complete.
- Verify `test-plan.md` is at `passed` or `concerns-acknowledged`. The verifier needs the test-plan to check observed tests against promised coverage.
- Verify `hstack/context/ci-cd.md` exists at `status: current` and names the canonical test, lint, and typecheck commands the consuming repo expects.
- Verify the consuming repo's local environment can run the canonical commands (dependencies installed, env vars present). If a command fails to execute due to environment misconfiguration, halt before invoking the subagent.

## Orchestration steps

1. **Invoke `verifier`.** Use the Task tool with `subagent_type: verifier` and context = [kernel, `hstack/templates/verification.md`, change-spec, plan, test-plan, ci-cd]. The subagent runs the canonical commands declared in `ci-cd.md` (or orchestrates `{{TODO-SCRIPT: hstack/scripts/run-gates.sh}}`).

2. **Capture output.** The subagent writes captured stdout/stderr to a pointer file at `hstack/specs/changes/<change-id>/test-output.txt` and references it from `verification.artifacts.test-output`.

3. **Phase coverage mapping.** For each phase in `plan.steps-completed`, the subagent emits an entry in `phase-coverage` with a PASS / FAIL value computed from whether the phase's Verifier Expectations are met. Per V-01, `phase-coverage` keys must equal `plan.steps-completed`.

4. **Test-results map.** The subagent writes the top-level `test-results` map covering `unit`, `integration`, `e2e`, `lint`, `typecheck`. Per V-02, any `failed` value blocks `status: passed`. Per V-05, before mapping `unit`, `integration`, or `e2e` to `pass`, the subagent confirms the runner's observed-test-count for that suite is greater than zero — a suite gated by an unset env var, all-skipped, empty-collection, or filter-collapsed to zero tests is recorded as `not-run` with a high-severity Discrepancy, not as `pass` on the absence of failures.

5. **Test-plan coverage check.** The subagent walks the test-plan's Edge Cases bullets, Tenant Isolation Tests array, and Performance Budgets table, and confirms each observed in the test run. `test-plan-coverage` frontmatter map captures the three subsections. Per V-03, any tenant-isolation test absent or skipped blocks `status: passed` and is escalated to adversarial-review via Discrepancies. Per V-04, any performance-budget assertion that did not execute or that observed values outside the declared budget blocks `status: passed`.

6. **Discrepancies.** Anything the subagent observed that the plan or test-plan did not predict — a test that ran but no artifact promised, a test the plan or test-plan promised that did not exist, flakiness, environment-dependent behavior — lands in the Discrepancies section with a recommended action (file an issue, escalate to adversarial-review, or note as benign with reason).

7. **Status transition.** When every `phase-coverage` entry is PASS, every `test-results` entry is `pass`, every `test-plan-coverage` value is `all-observed` / `all-within-budget` / `not-applicable`, the subagent advances status to `passed`. When any test result is `failed`, when a tenant-isolation test is missing, or when a performance-budget regressed or did not execute, status moves to `ran` (not `passed`) and the Skill halts.

8. **Change-spec advance (mechanical, only on `passed`, Skill-orchestrator write per ADR-0002).** When and only when the subagent returned with `verification.md` at `status: passed`, read `hstack/specs/changes/<change-id>/spec.md` and inspect its `status` frontmatter. If `status: ready-for-implementation`, print a proposed-diff preview of the change-spec edit (`status: ready-for-implementation → ready-for-review`; `updated: <today>`) and prompt "Proceed with this change-spec advance? (Y/n)". Default Yes. On confirmation, perform the edit via the `Edit` tool, run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` against the change-spec, then `git add` and commit with message `change-spec(<change-id>): ready-for-review`. This is a separate commit from the `verification(<change-id>): passed` commit — one commit per status transition, matching the finalize precedent. If the change-spec is already at `ready-for-review` or any downstream status, this step is a no-op (idempotent on re-runs). When verification status is `ran` or `failed`, this step does not run — the change-spec remains at `ready-for-implementation` until a subsequent re-run lands `passed`. Do NOT invoke `spec-author` for this write; per the kernel's Mechanical operations section, the value to write is fully determined by the verification postcondition and the change-spec's current status, so the Skill writes directly.

9. **Validate.** Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` — V-01, V-02, V-03, V-04, V-05.

## Outputs

- `hstack/specs/changes/<change-id>/verification.md` at `status: passed`, `ran`, or `failed`.
- `hstack/specs/changes/<change-id>/test-output.txt` capturing the canonical commands' output.
- When `verification.md` lands at `passed` and the change-spec was at `ready-for-implementation`: an edit to `hstack/specs/changes/<change-id>/spec.md` advancing `status: ready-for-implementation → ready-for-review` and bumping `updated:` (per ADR-0002).

## Auto-commit triggers

- Status transition to `ran` after the commands execute.
- Status transition to `passed` (or `failed`). Commit message: `verification(<change-id>): passed` / `failed`.
- **Change-spec status transition `ready-for-implementation → ready-for-review`** (per ADR-0002). Lands as a separate commit after the `verification(<change-id>): passed` commit. Commit message: `change-spec(<change-id>): ready-for-review`. Skipped when verification status is not `passed`, or when the change-spec was already at `ready-for-review` or any downstream status.

## Telemetry sidecar

At the change-spec advance commit (only when verification status is `passed`), write `hstack/specs/changes/<change-id>/.telemetry/verify.json` in the same `git add && git commit` as the change-spec advance. The sidecar is derivative of git + frontmatter (see `hstack/templates/telemetry-sidecar.md`). Schema:

```json
{
  "schema_version": 1,
  "skill": "hstack-verify",
  "change_id": "<change-id>",
  "ran_at": "<ISO-8601, when canonical commands started>",
  "test_suite_runtime_s": <float seconds, wall clock across canonical commands>,
  "phase_coverage": {<mirror of verification.md frontmatter>},
  "test_plan_coverage": {<mirror of verification.md frontmatter>},
  "discrepancies_count": <int, bullet count under verification.md § Discrepancies>,
  "status": "passed"
}
```

When verification ends at `ran` or `failed`, the sidecar still lands with `status` reflecting the canonical artifact status; the change-spec advance commit does not happen, so the sidecar piggybacks on the `verification(<change-id>): ran` (or `failed`) commit instead. `.telemetry/` is git-ignored. If the sidecar write fails, log and continue; the canonical commit must still land.

## Session boundary

`verify` is a natural session cut. The auto-commit above has already written the
durable state to disk — `verification.md` carries everything the next phase loads at session
start, so the conversation itself holds nothing downstream needs. Long contexts
degrade model performance well before the window limit, so cutting here costs
nothing and buys accuracy back.

At terminal state, print this as the last line of output, verbatim:

```
HSTACK-CUT: verify complete — cut recommended before adversarial-review.
  → new session (preferred), or: /compact keep the discrepancies and their recommended actions, drop the raw runner output
```

Never cut mid-phase. A phase in flight has no committed state, and a summary
produced mid-reasoning loses the chain it was built on. The boundary is the
commit, not the context pressure.

## Idempotency contract

- Re-running on a `passed` verification: the subagent re-runs the canonical commands; identical outcomes produce a no-op aside from `updated` timestamps; different outcomes (newly failing test on a flake) update the artifact accordingly.
- Re-running after a `failed`: same — the subagent re-runs and updates.
- The verifier does not write a PASS to avoid re-running. The canonical commands run on every invocation.
- The change-spec advance step (step 8) is idempotent: a re-run against a change-spec already at `ready-for-review` (or any downstream status) produces a no-op for that step. The Skill does not re-advance a change-spec past `ready-for-review` and does not regress one if a later phase has moved it forward.

## Stop conditions

Beyond the kernel's general stop conditions:

- `plan.steps-completed` is incomplete relative to the plan body's phase ids.
- A canonical command in `ci-cd.md` is missing or cannot execute (missing dependency, missing env var).
- A phase's Verifier Expectations cannot be evaluated because the relevant test file is missing.
- A test failure blocks `status: passed`. The Skill halts at `status: ran` (or `failed`) until the implementer fixes the failing test via a new `hstack-implement` invocation.
- A `unit`, `integration`, or `e2e` suite executed zero tests (V-05). The Skill halts at `status: ran`; the subagent records the suite as `not-run` and logs the Discrepancy. Remediation is either (a) the implementer supplies the missing env / fixture so the suite collects and runs, or (b) a scope amendment removes the suite from the plan's Verifier Expectations so the zero-test state is intentional and recorded.

## Failure modes

- **Environment misconfiguration prevents a canonical command from running.** Halt before invoking the subagent; surface the issue and the resolution.
- **A test file the plan promised does not exist.** Halt; this is a discrepancy between plan and reality — surface as a Discrepancy and refuse `status: passed`.
- **The subagent's test runner produces a runtime error (not a test failure).** Surface in Discrepancies; do not record as a PASS or FAIL on the affected suite.

## Anti-patterns

- Never invent a PASS. If tests are not green, status is `ran` or `failed`, not `passed`.
- Never record a suite as `pass` on the absence of failures alone (V-05). A suite that ran zero tests — gated by an unset env var, all `.skip` / `.todo`, empty collection, or filter-collapsed — is `not-run`, not `pass`. The Skill propagates the zero-tests-ran signal from the runner output into the subagent context so the rule is enforceable rather than inferred.
- Never skip a canonical command. The consuming repo's commands in `ci-cd.md` are mandatory.
- Never silently drop a discrepancy. Even benign discrepancies get a one-line note.
- Never score security or data. Stay in the mechanical-verification lane.
- Never modify code or tests to make verification pass. That requires a new `hstack-implement` invocation.
- Never claim phase coverage for phases not in `plan.steps-completed`.
- Never run any command not declared in `ci-cd.md`. Extending the canonical command set requires `hstack-configure --interview ci-cd`.
