---
name: hstack-implement
description: |
  Use this skill when a change-spec is at `ready-for-implementation` and the engineer wants to execute one task from the plan. This is the only Skill that causes code to be written, and it does so exclusively by invoking the `implementer` subagent against one `task-id` at a time, scope-locked to the change-spec's `in-scope` allowlist. Defense in depth: the Skill checks preconditions and forbidden surfaces before invoking the subagent, and the subagent re-checks at every Read / Edit / Write. Examples:

  <example>
  Context: A UI-only change-spec for the billing-overage banner is at ready-for-implementation; the plan has five phases and phase-3 is next.
  user: "/hstack:implement 2026-05-billing-overage-warning phase-3-component"
  assistant: "I'll verify upstream gates (security-review passed, ui-brief drafted, figma-handoff ready), then invoke implementer for phase-3. Files Touched is a strict subset of in-scope; the subagent refuses any path outside it."
  <commentary>
  The Skill enforces the scope-lock contract from the kernel — Reads as well as Writes are restricted to `in-scope` plus the canonical session-start context loads. Phase-3 is the only thing executed; the Skill does not anticipate phase-4.
  </commentary>
  </example>

  <example>
  Context: A multi-surface change touching ui, db, and api is at ready-for-implementation; phase-2 lands a migration and regenerates types.
  user: "/hstack:implement 2026-06-knowledge-citations phase-2-migration"
  assistant: "I'll invoke implementer for phase-2. The migration runs against local Supabase only; types regen via `supabase gen types typescript --local`; no `supabase db push` against any remote project."
  <commentary>
  The kernel's database workflow is enforced both at the Skill level (the Skill refuses to invoke if the engineer attempts a remote-environment migration) and at the subagent level. Defense in depth on the highest-risk surface.
  </commentary>
  </example>

  <example>
  Context: Mid-phase, the implementer halts because lib/billing/queries.ts is needed but is not in `in-scope`.
  user: "/hstack:implement 2026-05-billing-overage-warning phase-4-wire"
  assistant: "The implementer halted at the queries.ts edit — that file is out-of-scope. Don't proceed; emit the scope-amendment request to the conversation, halt, and wait for the engineer to update the change-spec via spec-author."
  <commentary>
  This is the precondition-failure / scope-amendment case. The Skill does not unilaterally extend in-scope. The engineer invokes spec-author to amend the change-spec, the Skill re-runs, the implementer re-loads and continues.
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
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates plan.steps-completed updates against PL-03/PL-04/PL-05}}"
  - "{{TODO-OTHER: in-scope-enforcement guard — runtime check at every Edit/Write that refuses paths outside change-spec.in-scope; v1 implemented inside the implementer subagent's prompt; v2 substrate moves to a subagent-runtime hook}}"
---

## Purpose

`hstack-implement` is the only Skill that causes code to be written. It orchestrates the `implementer` subagent against one named task from the plan, scope-locked to the change-spec's `in-scope` allowlist. It is the workflow's last line of gating before code lands on disk: it re-checks every upstream gate, enumerates the kernel's forbidden tools, and refuses to invoke the implementer when preconditions are not met.

## When to invoke

Invoke once the change-spec is at `status: ready-for-implementation` (which means every upstream gate is terminal: plan at `ready`, security-review at `passed` or `concerns-acknowledged`, data-review at `passed` or `concerns-acknowledged` when applicable, ui-brief at `drafted` and figma-handoff at `ready` when applicable, user-stories non-empty unless internal-tooling). One invocation per phase. Re-invoke for each subsequent phase.

## Inputs

- `<change-id>` (required, positional): the change-spec id.
- `<task-id>` (required, positional): the phase id (e.g., `phase-3-component`). Must match an existing `step-id` in the plan body.

## Preconditions

Before any work — the Skill re-checks every gate even when the change-spec carries `status: ready-for-implementation`, because frontmatter can drift:

- Change-spec at `hstack/specs/changes/<change-id>/spec.md`. `status` must be `ready-for-implementation` or `in-progress`. `Invariants` ≥ 3 bullets, `in-scope` non-empty, every `in-scope` glob resolves.
- Plan at `hstack/specs/changes/<change-id>/plan.md` at `status: ready` or `in-progress`. `<task-id>` must match a phase id in the plan body. `Files Touched` for the phase must be a strict subset of `in-scope`.
- Security-review at `status: passed` or `concerns-acknowledged`.
- Data-review at `status: passed` or `concerns-acknowledged` when `surfaces` includes `db`.
- ui-brief at `status: drafted` and figma-handoff at `status: ready` when `surfaces` includes `ui`.
- User-stories non-empty unless `internal-tooling: true`.
- The relevant module-spec at `status: current`.

Enumerate the kernel's forbidden tool surfaces explicitly before invoking the subagent — defense in depth with the implementer's own check:

- `service_role` Supabase keys in agent-touching code paths.
- Raw shell (`psql`, `bash`, `sh`) executed against production or remote Supabase. Local Supabase only.
- `supabase db push` / `supabase db reset` against any remote project. Local stack only.
- Pipedream Connect against live customer accounts without per-invocation explicit human approval.
- Any tool that mutates state outside the `in-scope` list.
- MCPs not in the consuming repo's configured allow set.
- `--no-verify` or other hook-bypassing git flags.
- Destructive git operations (`git push --force`, `git reset --hard`, `git checkout .`) without explicit per-invocation authorization.

If the named phase appears to require any of the above, halt before invoking — surface the violation, ask the engineer to either reshape the phase or authorize per-invocation.

## Orchestration steps

1. **Re-verify gates.** Run the precondition checks above. Any failure halts the Skill with a precise message naming the failing artifact and field.

2. **Invoke `implementer`.** Use the Task tool with `subagent_type: implementer` and context = [kernel, change-spec, plan, security-review, data-review when present, ui-brief and figma-handoff when present, module-spec, tech-stack]. The subagent loads only the In-Scope file list for code reading; everything outside the canonical session-start context plus In-Scope is refused per the kernel.

3. **Phase execution.** The subagent executes one phase per invocation. It writes the code diff scoped to the phase's Files Touched, updates `plan.steps-completed` to include `<task-id>` when the phase completes, and writes tests per the phase's Test Strategy.

4. **Database workflow enforcement.** For phases touching schema: the subagent creates migration files via `supabase migration new <descriptive_name>`; enables RLS in the same migration as a new table; regenerates types via `supabase gen types typescript --local > types/database.types.ts`. Never `supabase db push` / `supabase db reset` against a remote project.

5. **Trigger.dev v4 only.** For phases touching trigger code, the subagent uses `@trigger.dev/sdk` task / schemaTask; never `client.defineJob` (v2 deprecated). `triggerAndWait` returns a `Result`; `result.ok` is checked before reading `result.output`.

6. **Scope-amendment halt.** If the subagent would touch a file outside `in-scope`, it halts and emits a scope-amendment request to the conversation. The Skill does not extend `in-scope` unilaterally. The engineer invokes `spec-author` (typically via direct request, not a Skill) to amend the change-spec, the Skill re-runs, the subagent re-loads.

7. **Hook failures.** If a pre-commit hook fails on the auto-commit, the subagent investigates and fixes the underlying issue; does not bypass via `--no-verify`. If the fix would require out-of-scope edits, halt with a scope-amendment request.

8. **Validate.** Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` against the plan — PL-03 (every `steps-completed` entry matches a plan phase id), PL-04 (every Files Touched path is a subset of `in-scope`), PL-05 (plan status gating).

## Outputs

- Code diffs in the consuming repo, scoped to `change-spec.in-scope` and matching the phase's Files Touched.
- Test files written or updated per the phase's Test Strategy.
- `plan.md` updated with `<task-id>` appended to `steps-completed`; `blocked-on: null` (or set to a phase id when interactive blocker stops progress).
- One git commit on the active working branch naming `<change-id>` and `<task-id>`.

The change-spec is never written by the implementer or by this Skill (architecture amendment A3).

## Auto-commit triggers

- One commit when the phase completes and `steps-completed` advances. Commit message: `implement(<change-id>) <task-id>`.
- An additional commit when `plan.status` advances to `completed` after the final phase.

## Idempotency contract

- Re-running with the same `<task-id>` after the phase already landed: the subagent reads `steps-completed`, recognizes the phase as done, and produces a no-op diff. Re-running on a partially applied phase: the subagent reads current file state and applies only the remaining diff.
- Re-running on a phase whose dependencies are not yet complete (`depends-on` references a phase not in `steps-completed`): the subagent halts and surfaces the missing dependency.

## Stop conditions

Beyond the kernel's general stop conditions:

- A modification outside `in-scope` is needed. Halt; emit scope-amendment request.
- An invariant would be weakened, dropped, or modified.
- A required upstream artifact is non-terminal.
- A forbidden tool would be used (see enumeration above).
- A load-bearing MCP is unreachable mid-phase.
- The change requires a migration against a remote environment.
- A pre-commit or pre-push hook fails after investigation — halt and surface; do not bypass.
- The engineer has not authorized a destructive git operation that the situation seems to call for.
- An ambiguity in the plan or change-spec would require the implementer to make a design call beyond its role.

## Failure modes

- **Phase depends-on a phase not yet in `steps-completed`.** Halt and surface the dependency.
- **Type regen fails after a migration.** The phase is incomplete; `steps-completed` is not advanced; halt and surface.
- **Tests written but failing.** Halt at `steps-completed` not advanced; the engineer either re-invokes after fixing or amends the plan via the planner.
- **Validator fails PL-04.** A Files Touched path crept outside `in-scope` — halt; this should have been caught upstream.

## Anti-patterns

- Never bypass scope-lock by one file, even one line. Halt and amend.
- Never modify the change-spec. `steps-completed` lives on the plan.
- Never weaken or remove an invariant.
- Never use `service_role` Supabase keys in agent code paths.
- Never use raw shell or `supabase db push` against production or any remote project.
- Never use Pipedream Connect against live customer accounts without explicit per-invocation approval.
- Never skip a hook with `--no-verify`. Fix the failing check.
- Never execute destructive git operations without explicit authorization in the current conversation.
- Never anticipate the next phase. Execute the named task and stop.
- Never use `client.defineJob` (Trigger.dev v2 deprecated).
- Never invent a migration filename. Use `supabase migration new <descriptive_name>`.
- Never claim a phase complete when tests fail or types are stale.
