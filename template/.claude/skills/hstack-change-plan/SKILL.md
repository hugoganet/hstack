---
name: hstack-change-plan
description: Use when a change-spec is at `ready-to-plan` with `test-plan.md` and every conditional upstream artifact terminal, and needs `plan.md` decomposed into atomic phases. Distinct from `/hstack:change-new`, which only scaffolds the folder.
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
  - "node hstack/scripts/validate-spec.mjs — validates plan frontmatter and PL-01..PL-05"
---

## Purpose

`hstack-change-plan` produces `plan.md` for a change-spec by orchestrating the `planner` subagent. The plan decomposes the change into atomic phases with per-phase verifier expectations, names cross-phase risks, and articulates a rollback strategy. It is the artifact the implementer executes one phase at a time and the verifier checks phase-by-phase.

## When to invoke

Invoke when the change-spec reaches `status: ready-to-plan`, `test-plan.md` is at terminal status, and any conditional upstream artifacts required by the spec's `surfaces` are at terminal status. Re-invoke when the change-spec, the test-plan, or any conditional upstream artifact changes shape in ways that invalidate the existing plan.

When not to invoke — the conditional upstream gate is hard, and each miss has one remedy:

- `surfaces` includes `db` and `data-review.md` is missing or non-terminal → halt; run `/hstack:data-review <change-id>` first. Planning against an unscored data layer produces a plan the implementer would refuse to act on anyway.
- `surfaces` includes `ui` and `ui-brief.md` is not at `drafted` or `figma-handoff.md` is not at `ready` → halt; run `/hstack:ui-brief <change-id>` and get the handoff from the cofounder first.
- `test-plan.md` is missing or non-terminal → halt; run `/hstack:test-plan <change-id>` first.

## Inputs

- `<change-id>` (required, positional): the change-spec id.

## Preconditions

Before any work:

- Verify the change-spec exists at `hstack/specs/changes/<id>/spec.md` and is at `status: ready-to-plan` or later.
- Verify the change-spec's `Invariants` section has ≥ 3 bullets (SP-04) and `Scope Boundaries` is non-empty (SP-05/SP-06). If empty, halt — the planner refuses.
- **Verify `test-plan.md` is at `status: passed` or `concerns-acknowledged`.** This is the hard upstream gate; the planner refuses to sequence phases without a terminal test strategy. Halt otherwise and direct the engineer to `/hstack:test-plan`.
- When `surfaces` includes `ui`: verify `ui-brief.md` at `status: drafted` and `figma-handoff.md` at `status: ready`. Halt otherwise.
- When `surfaces` includes `db`: verify `data-review.md` at `status: passed` or `concerns-acknowledged`. Halt otherwise.
- Verify the relevant module-spec at `status: current`.
- Read `hstack/context/tech-stack.md` (loaded by `planner` for pinned runtime constraints).
- Read `hstack/context/roadmap.md` for the plan's Roadmap Alignment line. Advisory, never a precondition: missing or stale (`status` ≠ `current`, or `updated` > 90 days) yields `n/a — roadmap stale/missing (<detail>)` in that line — no halt.

The security-review is not a planner precondition — security-review and the plan can be produced in either order, since neither depends on the other's content (the implementer reads both at session start). The test-plan, by contrast, IS a planner precondition: the planner's phase ordering and per-phase Test Strategy entries reference test-plan sections, so the test-plan must already be terminal.

## Orchestration steps

1. **Invoke `planner`.** Use the Task tool with `subagent_type: planner` and context = [kernel, `hstack/templates/plan.md`, change-spec, test-plan, ui-brief and figma-handoff if applicable, data-review if applicable, module-spec, tech-stack, roadmap when present]. The subagent walks the five plan sections — Roadmap Alignment (one honest line, per the planner contract: information for the human, never a gate), Phase Overview, Per-Phase Detail, Cross-Phase Risks, Rollback. Per-phase Test Strategy entries point at test-plan sections rather than re-stating tests inline.

2. **Phase decomposition.** Per the `planner` contract, typical plans hold 4–8 phases; > 12 phases requires an `oversized-plan-justification` frontmatter field. Each phase has a `step-id`, one-line summary, `depends-on` list, Files Touched (subset of `change-spec.in-scope`), Test Strategy, Risk sentence, and Verifier Expectations.

3. **Scope subset enforcement.** Per PL-04, every "Files Touched" entry across the plan must be a subset of `change-spec.in-scope`. The subagent verifies during authoring; the Skill verifies post-write via the validator. If a phase requires a file outside `in-scope`, the planner halts with a scope-amendment request.

4. **Exercise the Cross-Phase Risks challenge.** Per the `planner` contract, the Cross-Phase Risks section uses the challenge prompt "What could go wrong across phase boundaries that no single phase catches?" Minimum one bullet for multi-phase plans.

5. **Rollback discipline.** Section 4 names what to flip, revert, or feature-gate if a partial rollout breaks something. If the engineer cannot answer, the planner halts rather than writing a plausible default.

6. **Leave `steps-completed: []`.** Per architecture amendment A3 and the planner's contract, `steps-completed` is owned by the implementer; the planner never populates it.

7. **Validate.** Run `node hstack/scripts/validate-spec.mjs <path>` — PL-01 (parent-change matches), PL-02 (phase count), PL-03 (steps-completed entries match plan phase ids), PL-04 (Files Touched is subset of in-scope), PL-05 (status advance gating).

8. **Transition.** When the validator passes, `planner` advances status from `draft` to `ready`. Auto-commit fires.

## Outputs

- `hstack/specs/changes/<change-id>/plan.md` at `status: ready`.

## Auto-commit triggers

- Status transition to `draft` after the Phase Overview table lands.
- Status transition to `ready` at end of authoring. Commit message: `plan(<change-id>): ready`.

## Session boundary

`change-plan` is a natural session cut. The auto-commit above has already written the
durable state to disk — `plan.md` carries everything the next phase loads at session
start, so the conversation itself holds nothing downstream needs. Long contexts
degrade model performance well before the window limit, so cutting here costs
nothing and buys accuracy back.

At terminal state, emit a cut notice followed by a ready-to-paste kickoff prompt.
The kickoff prompt is the handoff mechanism: the engineer carries it into a fresh
session, so no hook, no cursor and no on-disk state is needed to route it. Format:

```
HSTACK-CUT: change-plan complete — cut recommended before implement.

Paste into a fresh session:
────────────────────────────────────────────────
/hstack:implement <first-phase-id> <change-id>

Context from the previous session (not in any artifact):
- <what was decided that no artifact records>
- open: <question raised and unresolved, with the artifact that is silent on it>
- ruled out: <approach rejected, and why, with the artifact reference>
────────────────────────────────────────────────
```

Rules for the context block: only facts that no artifact already carries — never
restate the spec, the plan, or the phase output, which the next Skill loads from
disk anyway. Three bullets maximum. If nothing qualifies, print the command line
alone and say so; an empty context block is the correct output for a clean phase,
not a failure to fill it in.

Never cut mid-phase. A phase in flight has no committed state, and a summary
produced mid-reasoning loses the chain it was built on. The boundary is the
commit, not the context pressure.

## Idempotency contract

- Re-running on an existing `ready` plan without spec changes: the subagent reads the existing plan as the proposal layer; identical re-confirmation is a no-op.
- Re-running mid-authoring after a halt: `planner` reads the partial file and resumes at the next un-confirmed section.
- Re-running after the change-spec's `in-scope` has been amended: the planner re-validates every Files Touched entry against the new in-scope, halts if any phase drifted, and prompts the engineer to reshape phases.

## Stop conditions

Beyond the kernel's general stop conditions:

- Change-spec Invariants empty (< 3 bullets) or Scope Boundaries empty.
- `test-plan.md` missing or non-terminal. Halt and direct the engineer to `/hstack:test-plan`.
- Conditional upstream artifact missing or non-terminal.
- A Files Touched entry would drift outside `in-scope`. Halt and request a scope amendment via `spec-author`.
- > 12 phases without `oversized-plan-justification` in frontmatter.
- The Cross-Phase Risks challenge prompt cannot be answered with at least one bullet on a multi-phase change.
- The engineer cannot answer the rollback prompt.

## Failure modes

- **Module-spec missing or `needs-refresh`.** Halt; refresh via `hstack-module-spec` first.
- **`ui-brief.md` exists at `draft` rather than `drafted`.** Halt; the brief is incomplete.
- **Validator fails PL-04.** The planner halts immediately at the offending phase; the engineer either reshapes the phase or amends in-scope.
- **`planner` halts on cross-phase risk surfacing an invariant gap.** Halt; the engineer amends the change-spec via `spec-author`, then re-runs this Skill.

## Anti-patterns

- Never write code. Plans are prose plus YAML.
- Never silently accept a non-terminal upstream artifact.
- Never invent invariants or modify the change-spec's Invariants section — that is `spec-author`'s domain.
- Never write `steps-completed` values; the field belongs to the implementer.
- Never produce a multi-phase plan with empty Cross-Phase Risks without exercising the challenge prompt.
- Never write a rollback section with a plausible-sounding default the engineer did not endorse.
