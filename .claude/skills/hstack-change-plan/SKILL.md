---
name: hstack-change-plan
description: |
  Use this skill when a change-spec is at `status: ready-to-plan` (with its conditional upstream artifacts also at terminal status) and needs `plan.md` drafted as atomic phases. The Skill orchestrates the `planner` subagent. Examples:

  <example>
  Context: The billing-overage change-spec is at ready-to-plan, the ui-brief is drafted, the figma-handoff is ready, and the engineer is about to start implementation.
  user: "/hstack:change-plan 2026-05-billing-overage-warning"
  assistant: "I'll invoke planner with the change-spec, ui-brief, figma-handoff. Atomic phases with per-phase verifier expectations and a rollback strategy."
  <commentary>
  The planner is the only authoring path for plan.md. The Skill enforces that upstream conditional artifacts (ui-brief, figma-handoff for ui; data-review for db) are at terminal status before invoking — otherwise the planner halts.
  </commentary>
  </example>

  <example>
  Context: A change touching ui and db is at ready-to-plan but data-review has not been run yet.
  user: "/hstack:change-plan 2026-06-knowledge-citations"
  assistant: "I'll halt — surfaces includes db and data-review.md is missing. Run /hstack:data-review first."
  <commentary>
  The conditional upstream gate is hard. Skipping the data-review and producing a plan against an unscored data layer produces a plan that the implementer would refuse to act on anyway.
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
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates plan frontmatter and PL-01..PL-05}}"
---

## Purpose

`hstack-change-plan` produces `plan.md` for a change-spec by orchestrating the `planner` subagent. The plan decomposes the change into atomic phases with per-phase verifier expectations, names cross-phase risks, and articulates a rollback strategy. It is the artifact the implementer executes one phase at a time and the verifier checks phase-by-phase.

## When to invoke

Invoke when the change-spec reaches `status: ready-to-plan` and the conditional upstream artifacts required by the spec's `surfaces` are at terminal status. Re-invoke when the change-spec or its upstream artifacts change shape in ways that invalidate the existing plan.

## Inputs

- `<change-id>` (required, positional): the change-spec id.

## Preconditions

Before any work:

- Verify the change-spec exists at `hstack/specs/changes/<id>/spec.md` and is at `status: ready-to-plan` or later.
- Verify the change-spec's `Invariants` section has ≥ 3 bullets (SP-04) and `Scope Boundaries` is non-empty (SP-05/SP-06). If empty, halt — the planner refuses.
- When `surfaces` includes `ui`: verify `ui-brief.md` at `status: drafted` and `figma-handoff.md` at `status: ready`. Halt otherwise.
- When `surfaces` includes `db`: verify `data-review.md` at `status: passed` or `concerns-acknowledged`. Halt otherwise.
- Verify the relevant module-spec at `status: current`.
- Read `hstack/context/tech-stack.md` (loaded by `planner` for pinned runtime constraints).

The security-review is not a planner precondition — security-review and the plan can be produced in either order, since neither depends on the other's content (the implementer reads both at session start).

## Orchestration steps

1. **Invoke `planner`.** Use the Task tool with `subagent_type: planner` and context = [kernel, `hstack/templates/plan.md`, change-spec, ui-brief and figma-handoff if applicable, data-review if applicable, module-spec, tech-stack]. The subagent walks the four plan sections — Phase Overview, Per-Phase Detail, Cross-Phase Risks, Rollback.

2. **Phase decomposition.** Per the `planner` contract, typical plans hold 4–8 phases; > 12 phases requires an `oversized-plan-justification` frontmatter field. Each phase has a `step-id`, one-line summary, `depends-on` list, Files Touched (subset of `change-spec.in-scope`), Test Strategy, Risk sentence, and Verifier Expectations.

3. **Scope subset enforcement.** Per PL-04, every "Files Touched" entry across the plan must be a subset of `change-spec.in-scope`. The subagent verifies during authoring; the Skill verifies post-write via the validator. If a phase requires a file outside `in-scope`, the planner halts with a scope-amendment request.

4. **Exercise the Cross-Phase Risks challenge.** Per the `planner` contract, the Cross-Phase Risks section uses the challenge prompt "What could go wrong across phase boundaries that no single phase catches?" Minimum one bullet for multi-phase plans.

5. **Rollback discipline.** Section 4 names what to flip, revert, or feature-gate if a partial rollout breaks something. If the engineer cannot answer, the planner halts rather than writing a plausible default.

6. **Leave `steps-completed: []`.** Per architecture amendment A3 and the planner's contract, `steps-completed` is owned by the implementer; the planner never populates it.

7. **Validate.** Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` — PL-01 (parent-change matches), PL-02 (phase count), PL-03 (steps-completed entries match plan phase ids), PL-04 (Files Touched is subset of in-scope), PL-05 (status advance gating).

8. **Transition.** When the validator passes, `planner` advances status from `draft` to `ready`. Auto-commit fires.

## Outputs

- `hstack/specs/changes/<change-id>/plan.md` at `status: ready`.

## Auto-commit triggers

- Status transition to `draft` after the Phase Overview table lands.
- Status transition to `ready` at end of authoring. Commit message: `plan(<change-id>): ready`.

## Idempotency contract

- Re-running on an existing `ready` plan without spec changes: the subagent reads the existing plan as the proposal layer; identical re-confirmation is a no-op.
- Re-running mid-authoring after a halt: `planner` reads the partial file and resumes at the next un-confirmed section.
- Re-running after the change-spec's `in-scope` has been amended: the planner re-validates every Files Touched entry against the new in-scope, halts if any phase drifted, and prompts the engineer to reshape phases.

## Stop conditions

Beyond the kernel's general stop conditions:

- Change-spec Invariants empty (< 3 bullets) or Scope Boundaries empty.
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
