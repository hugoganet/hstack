---
name: hstack-test-plan
description: "Use when a change-spec is at `ready-to-plan` and needs `test-plan.md` before `/hstack:change-plan` can run — the planner refuses to sequence phases without it. Skipped for changes marked `trivial: true`."
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
  - "node hstack/scripts/validate-spec.mjs — validates test-plan frontmatter and TS-01..TS-06"
---

## Purpose

`hstack-test-plan` produces `test-plan.md` for a change-spec by orchestrating the `test-strategist` subagent. In hstack v1, the artifact is a structured LLM judgment about test pyramid layering, edge cases, tenant-isolation tests, fixture strategy, and performance budgets, plus three mandatory challenge prompts. It is not a coverage-instrumented or mutation-tested artifact; v2 substrate replaces the strategist's claims with measured coverage runs and benchmark-asserted budgets. This Skill enforces the v1 honesty framing on every output.

The test-plan runs **upstream of the planner**. It is the first per-change artifact authored after the change-spec reaches `ready-to-plan`. The planner reads it; the implementer reads it; the verifier later checks observed tests against both the planner's per-phase Verifier Expectations and the test-plan's pyramid and budgets.

## When to invoke

Invoke when a change-spec reaches `status: ready-to-plan`. The test-plan must reach terminal status (`passed` or `concerns-acknowledged`) before `hstack-change-plan` can run — the planner refuses to start without it. Security-review and data-review can run in parallel with the test-plan; none of those three gate one another.

Trivial changes (`trivial: true` on the change-spec) bypass this Skill per the kernel's trivial-changes carve-out.

## Inputs

- `<change-id>` (required, positional): the change-spec id.

## Preconditions

Before any work:

- Verify the change-spec exists and is at `status: ready-to-plan` or later. If at `draft`, halt — the strategist cannot work against a draft spec.
- Verify the change-spec is **not** `trivial: true`. If trivial, halt and surface that the test-plan is not required.
- Verify the change-spec's `Invariants` section has ≥ 3 bullets (SP-04). The strategist maps tests to invariant ids; without invariants, mapping is impossible.
- Verify `hstack/context/tech-stack.md` and `hstack/context/ci-cd.md` are at `status: current`. The strategist relies on these for framework conventions and canonical command names.
- When `surfaces` includes `db`: verify `hstack/context/data-architecture.md` is at `status: current`.
- Verify the relevant module-spec at `status: current`.
- Determine whether `surfaces` includes `db`, `api`, or `agent`. If yes, the strategist will be required to produce a non-empty `tenant-isolation-tests` array (TS-03).
- Determine whether the change touches a hot path or high-traffic surface. If yes, set `performance-budgets-required: true` for the subagent's session and require the Budgets table to be populated.

## Orchestration steps

0. **Open the phase window (mechanical, no LLM turn, no commit).** The moment the preconditions above pass and *before* any subagent invocation, run `python3 hstack/scripts/telemetry/session_id.py` and keep its `session_id` and `now` values — they become `session_id` and `phase_opened_at` in the sidecar below (ADR-0009). On failure or a null session id, hold `null` for both and continue.

1. **Invoke `test-strategist`.** Use the Task tool with `subagent_type: test-strategist` and context = [kernel, `hstack/templates/test-plan.md`, change-spec, module-spec, tech-stack, ci-cd, data-architecture when applicable]. The subagent walks the eight sections — Surfaces and Risk Profile, Test Pyramid, Edge Cases, Tenant Isolation Tests, Test Data and Fixture Strategy, Performance and Regression Budgets, Challenge Prompts, Open Concerns.

2. **Pyramid bias.** Per the subagent's contract, bias is unit-for-pure-functions, integration-for-multi-module-behavior, e2e-only-for-user-journeys-that-span-the-stack. The Skill rejects any pyramid where the bulk of behavior coverage lands in e2e — that is the slow-and-flaky failure mode the strategist exists to prevent.

3. **Edge case enumeration.** Minimum three bullets unless the change-spec carries `trivial: true`. Each bullet maps to a named test file and test name. The Skill rejects edge cases that name a test without a path.

4. **Tenant-isolation tests (TS-03 enforcement).** When `surfaces` includes `db`, `api`, or `agent`, the `tenant-isolation-tests` array must be non-empty and every entry must cite a real surface (table, RPC, tool boundary) and a real planned test. The subagent grep-verifies surface identifiers; making them up is forbidden.

5. **Fixture strategy.** The Test Data and Fixture Strategy section must be non-empty before status can advance. `fixture-strategy-declared: true` is required for terminal status (TS-05).

6. **Performance budgets.** When `performance-budgets-required: true`, every row in the Budgets table must pair a numeric threshold with an asserting test. The Skill deletes any unbacked row and surfaces it as a coverage gap rather than letting an unenforceable budget ship.

7. **Three challenge prompts (mandatory).** Per TS-02 and the subagent's contract, the subagent answers all three challenge prompts. The canonical wording:
   - "What behavior in this change would silently pass the test suite but break in production? Name the test that would catch it, or declare that no such test is planned and justify."
   - "Which invariant from the change-spec has no corresponding negative or regression test? If every invariant has a mapped test, cite the test for each invariant by id."
   - "What concurrent, multi-tenant, or failure-mode scenario is not exercised by the planned tests? If none is plausibly relevant, justify why this change has no such scenario."
   The prompts must be answered; they need not be transcribed. Where a probe fits the change poorly as written, the subagent adapts it so it bites harder and records the adapted question in the heading — the `(a)` / `(b)` / `(c)` prefixes stay, because that is what TS-02 locates the answers by. Each answer is at least one paragraph. The Skill verifies `challenge-prompts-answered: 3` in frontmatter.

8. **Invariant mapping (TS-06).** Every invariant id declared in the change-spec must be referenced at least once in section 3, section 4, or in the (b) challenge prompt. The `invariants-mapped` frontmatter array enumerates the covered ids. The validator fails if any invariant is unmapped.

9. **v1 framing.** Every rationale paragraph uses language like "the planned test asserts X" rather than "we verified X" or "we measured X". The Skill rejects any rationale that asserts coverage-measured evidence — that is v2 substrate territory.

10. **Status transitions.** When every coverage layer is `addressed` or `not-applicable` with justification, every required section is populated, every invariant is mapped, every applicable budget has an asserting test, and all three challenge prompts are answered, the subagent transitions to `status: passed`. When any layer is `partial`, the subagent can only transition to `concerns-acknowledged`, and only when `concerns-acknowledged-by` is non-null (a human handle the owner has explicitly provided) and the Open Concerns section enumerates each partial layer with a tech-debt id. Per TS-04, `passed` is impossible if any layer is `partial`.

11. **Tech-debt for deferred coverage.** When a coverage layer is being deferred rather than addressed, the subagent prompts the engineer to invoke `hstack-tech-debt-new` to create the paper trail. The Skill does not file the tech-debt itself; it surfaces the recommendation.

12. **Validate.** Run `node hstack/scripts/validate-spec.mjs <path>` — TS-01 (parent-change matches), TS-02 (challenge-prompts-answered == 3), TS-03 (tenant-isolation-tests non-empty when surfaces includes db/api/agent), TS-04 (status gating on partial layers), TS-05 (fixture-strategy-declared == true before passed), TS-06 (every invariant id is in `invariants-mapped`).

## Outputs

- `hstack/specs/changes/<change-id>/test-plan.md` at `status: passed` or `concerns-acknowledged`.
- Optional surfaced recommendation to file tech-debt for any deferred `partial` coverage layer.

## Auto-commit triggers

- Status transition to `in-progress` after the Test Pyramid section lands.
- Status transition to terminal (`passed` or `concerns-acknowledged`). Commit message: `test-plan(<change-id>): passed` or `concerns-acknowledged`.
- Edits to the `coverage-layers` map (because TS-04's terminal-gating depends on it).
- Edits to `tenant-isolation-tests` (because TS-03's gating depends on it).
- Edits to `concerns-acknowledged-by` (because it gates the partial-layer path).

## Telemetry sidecar

At the terminal-status auto-commit above (`test-plan(<change-id>): passed` or `concerns-acknowledged`), write `hstack/specs/changes/<change-id>/.telemetry/test-plan.json` in the same `git add && git commit` as the canonical write. The sidecar is derivative of git + frontmatter (see `hstack/templates/telemetry-sidecar.md`). Schema:

```json
{
  "schema_version": 2,
  "skill": "hstack-test-plan",
  "change_id": "<change-id>",
  "session_id": "<session id from step 0, or null>",
  "phase_opened_at": "<ISO-8601 from step 0, or null>",
  "phase_closed_at": "<ISO-8601, now — same write as this sidecar, or null>",
  "completed_at": "<ISO-8601, when terminal status reached>",
  "status": "passed | concerns-acknowledged",
  "coverage_layers": {<mirror of frontmatter coverage-layers map>},
  "tenant_isolation_tests_count": <int, length of tenant-isolation-tests array>,
  "tenant_isolation_required": <bool, true when surfaces includes db/api/agent>,
  "performance_budgets_required": <bool>,
  "performance_budgets_count": <int, rows in the Budgets table>,
  "challenge_prompts_answered": <int, frontmatter field; must be 3 at terminal>,
  "invariants_mapped_count": <int, length of invariants-mapped array>,
  "invariants_declared_count": <int, count of bullets in change-spec Invariants>,
  "edge_cases_count": <int, bullets in Edge Cases section>,
  "test_files_named_count": <int, distinct test file paths referenced>,
  "fixture_strategy_declared": <bool>,
  "halt_reasons": [<kernel halt-sentinel enum values, if any>]
}
```

Reason this sidecar matters: it makes the test-strategist's rubber-stamp signal cheap. A `passed` test-plan with `tenant_isolation_tests_count: 0` despite `tenant_isolation_required: true`, or `challenge_prompts_answered: 3` paired with zero invariants-mapped diff against declared, are the cases the telemetry layer's WS-2 and QO-1 metrics exist to surface. `.telemetry/` is git-ignored. If the sidecar write fails, log and continue; the canonical commit must still land.

The three phase-window fields (`session_id`, `phase_opened_at`, `phase_closed_at`) come from step 0 and from this write. Their rules — best-effort, unmeasured rather than zero, never a halt — are stated once in `hstack/templates/telemetry-sidecar.md` § The phase window, which is the canonical schema and wins over any Skill.

## Session boundary

`test-plan` is a natural session cut: the auto-commit above left `test-plan.md` on disk, so the conversation holds nothing the next phase needs. The cut-notice format, the kickoff-prompt template and the context-block rules are in `KERNEL.md` § Session boundaries; this Skill's two variables are:

```
HSTACK-CUT: test-plan complete — cut recommended before change-plan.
```

and the next command, `/hstack:change-plan <change-id>`.

## Idempotency contract

- Re-running on a terminal test-plan without spec changes: the subagent reads the existing artifact and produces a no-op aside from `updated` timestamps.
- Re-running after the change-spec's Invariants have been amended: the subagent re-verifies `invariants-mapped` covers every id and adds new entries where needed; halts if an amended invariant has no mappable test.
- Re-running mid-authoring after a halt: the subagent reads the partial file and resumes at the next un-confirmed section or un-answered challenge prompt.

## Stop conditions

Beyond the kernel's general stop conditions:

- Change-spec at `draft` rather than `ready-to-plan`. Halt.
- Change-spec carries `trivial: true`. Halt and inform — test-plan is not required.
- Change-spec `Invariants` empty or fewer than three bullets. Halt; the strategist cannot map tests to invariants that do not exist.
- `tech-stack.md`, `ci-cd.md`, or (when applicable) `data-architecture.md` at `needs-refresh` or absent. Halt.
- `surfaces` includes `db`/`api`/`agent` but the change-spec does not name a tenant-isolation invariant. Halt and ask the engineer to amend via `spec-author`.
- A performance budget is being declared but the consuming repo has no test pattern that can assert it. Halt; file tech-debt for the missing test infrastructure or drop the budget.
- A coverage layer would be marked `addressed` without concrete test file paths. The Skill rejects and the subagent bias-falls to `partial`.
- `concerns-acknowledged-by` would be written without the owner's explicit acknowledgement. Halt.
- The test-plan would name more than fifteen test files — halt and ask whether the change-spec should split per the kernel's multi-module rule.

## Failure modes

- **Module-spec missing or `needs-refresh`.** Halt; refresh via `hstack-module-spec` first.
- **Change-spec Invariants are present but generic ("no regressions").** Halt; the strategist cannot map tests to non-specific invariants. Ask the engineer to amend via `spec-author`.
- **Validator fails TS-02 (fewer than three challenge prompts answered).** Halt; the subagent re-runs the missing prompt.
- **Validator fails TS-03 (empty tenant-isolation-tests on a db/api/agent surface).** Halt; the subagent re-walks every new tenant-scoped surface and names a negative test.
- **Validator fails TS-06 (an invariant is unmapped).** Halt; the subagent either adds a test for the unmapped invariant, surfaces it in the (b) challenge prompt with a defended rationale, or escalates to amend the invariant via `spec-author`.
- **v1 framing slips in a rationale.** The Skill detects "verified by test execution" or "measured coverage" language and halts; the subagent re-words.
