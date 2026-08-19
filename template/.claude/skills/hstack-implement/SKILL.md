---
name: hstack-implement
description: Use when a change-spec is at `ready-for-implementation` and one named phase of the plan should be executed. The only Skill that causes code to be written, one task at a time, scope-locked to `in-scope`.
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

Invoke once the change-spec is at `status: ready-for-implementation` (which means every upstream gate is terminal: test-plan at `passed` or `concerns-acknowledged`, plan at `ready`, security-review at `passed` or `concerns-acknowledged`, data-review at `passed` or `concerns-acknowledged` when applicable, ui-brief at `drafted` and figma-handoff at `ready` when applicable, user-stories non-empty UNLESS `internal-tooling: true` UNLESS `enables` non-empty). One invocation per phase. Re-invoke for each subsequent phase.

## Inputs

- `<change-id>` (required, positional): the change-spec id.
- `<task-id>` (required, positional): the phase id (e.g., `phase-3-component`). Must match an existing `step-id` in the plan body.

## Preconditions

Before any work — the Skill re-checks every gate even when the change-spec carries `status: ready-for-implementation`, because frontmatter can drift:

- Change-spec at `hstack/specs/changes/<change-id>/spec.md`. `status` must be `ready-for-implementation` or `in-progress`. `Invariants` ≥ 3 bullets, `in-scope` non-empty, every `in-scope` glob resolves.
- Plan at `hstack/specs/changes/<change-id>/plan.md` at `status: ready` or `in-progress`. `<task-id>` must match a phase id in the plan body. `Files Touched` for the phase must be a strict subset of `in-scope`.
- **Test-plan at `hstack/specs/changes/<change-id>/test-plan.md` at `status: passed` or `concerns-acknowledged`.** The implementer reads it at session start and writes the tests it specifies; without a terminal test-plan, the implementer halts.
- Security-review at `status: passed` or `concerns-acknowledged`.
- Data-review at `status: passed` or `concerns-acknowledged` when `surfaces` includes `db`.
- ui-brief at `status: drafted` and figma-handoff at `status: ready` when `surfaces` includes `ui`.
- User-stories non-empty UNLESS `internal-tooling: true` (Category A — engineering-only) UNLESS `enables` non-empty (Category B — foundational prerequisite; user value lives in the named downstream change-spec). SP-13: `internal-tooling: true` and `enables` non-empty are mutually exclusive; if both are set, halt with an SP-13 violation message and direct the engineer to `spec-author` to pick one.
- The relevant module-spec at `status: current`.
- **Branch state.** Run `git branch --show-current`. If the current branch is `main` (or the configured default) AND `change-spec.trivial` is not `true`, HARD HALT with: "Refusing to implement on `main` — change-spec `<id>` is not marked trivial. Check out `change/<id>` first, or run `/hstack:branch <id>` to create-and-switch." Trivial changes (`trivial: true`) may proceed on main per the kernel's trivial-changes carve-out. This check enforces the kernel's branch-hygiene contract at the last moment before code lands.

Enumerate the kernel's forbidden tool surfaces explicitly before invoking the subagent — defense in depth with the implementer's own check:

- `service_role` Supabase keys in agent-touching code paths.
- Raw shell (`psql`, `bash`, `sh`) executed against production or remote Supabase. Local Supabase only.
- `supabase db push` / `supabase db reset` against any remote project. Local stack only.
- Pipedream Connect against live customer accounts without per-invocation explicit human approval.
- Any tool that mutates state outside the `in-scope` list.
- MCPs not in the consuming repo's configured allow set.
- `--no-verify` or other hook-bypassing git flags.
- `--update-snapshots`, `jest --updateSnapshot`, `vitest -u`, or any equivalent bulk snapshot-update flag.
- Destructive git operations (`git push --force`, `git reset --hard`, `git checkout .`) without explicit per-invocation authorization.
- Modifications to existing test files without per-test authorization via the test-immutability protocol (`Ok to change test <name>`, `Ok to delete test <name>`, `Ok to update snapshot <name>`, `Ok to refresh fixture <name>`).

If the named phase appears to require any of the above, halt before invoking — surface the violation, ask the engineer to either reshape the phase or authorize per-invocation.

## Orchestration steps

0. **Open the phase window (mechanical, no LLM turn, no commit).** The moment the preconditions above pass and *before* any subagent invocation, run `python3 hstack/scripts/telemetry/session_id.py` and keep its `session_id` and `now` values for the telemetry sidecar below — they become `session_id` and `phase_opened_at` (ADR-0009). The script is read-only, takes milliseconds, and never halts. If it fails to run, or reports `"session_id": null`, hold `null` for both and continue: the phase then reports as *unmeasured*, never as zero. Measurement never gates the workflow.

1. **Re-verify gates.** Run the precondition checks above. Any failure halts the Skill with a precise message naming the failing artifact and field.

2. **Invoke `implementer`.** Use the Task tool with `subagent_type: implementer` and context = [kernel, change-spec, plan, test-plan, security-review, data-review when present, ui-brief and figma-handoff when present, module-spec, tech-stack]. The subagent loads only the In-Scope file list for code reading; everything outside the canonical session-start context plus In-Scope is refused per the kernel.

3. **Phase execution.** The subagent executes one phase per invocation. It writes the code diff scoped to the phase's Files Touched, updates `plan.steps-completed` to include `<task-id>` when the phase completes, and writes the tests named in the test-plan sections the phase's Test Strategy references. Test names, file paths, and assertion shape come from the test-plan; the implementer does not rename or omit tests.

4. **Database workflow enforcement.** For phases touching schema: the subagent creates migration files via `supabase migration new <descriptive_name>`; enables RLS in the same migration as a new table; regenerates types via `supabase gen types typescript --local > types/database.types.ts`. Never `supabase db push` / `supabase db reset` against a remote project.

5. **Trigger.dev v4 only.** For phases touching trigger code, the subagent uses `@trigger.dev/sdk` task / schemaTask; never `client.defineJob` (v2 deprecated). `triggerAndWait` returns a `Result`; `result.ok` is checked before reading `result.output`.

6. **Scope-amendment halt.** If the subagent would touch a file outside `in-scope`, it halts and emits a scope-amendment request to the conversation. The Skill does not extend `in-scope` unilaterally. The engineer invokes `spec-author` (typically via direct request, not a Skill) to amend the change-spec, the Skill re-runs, the subagent re-loads.

7. **Hook failures.** If a pre-commit hook fails on the auto-commit, the subagent investigates and fixes the underlying issue; does not bypass via `--no-verify`. If the fix would require out-of-scope edits, halt with a scope-amendment request.

8. **Test-immutability protocol.** When the subagent determines an existing test file must be modified, deleted, or have a snapshot updated, it halts before touching the file and runs the kernel's authorization protocol: surface the test name, the reason, the proposed change, and the alternatives; wait for the canonical phrase verbatim (`Ok to change test <name>`, `Ok to delete test <name>`, `Ok to update snapshot <name>`, `Ok to refresh fixture <name>`); echo the phrase in the commit message body and add a footnote under the relevant phase in `plan.md`. The Skill enforces this defense-in-depth — if a subagent's diff shows a modified pre-existing test file without a matching authorization in the conversation, the Skill blocks the commit.

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

## Telemetry sidecar

At the phase-completion auto-commit above, write `hstack/specs/changes/<change-id>/.telemetry/implement-<task-id>.json` in the same `git add && git commit` as the canonical phase commit. The sidecar is derivative of git + frontmatter (see `hstack/templates/telemetry-sidecar.md`). Schema:

```json
{
  "schema_version": 2,
  "skill": "hstack-implement",
  "change_id": "<change-id>",
  "session_id": "<session id from step 0, or null>",
  "phase_opened_at": "<ISO-8601 from step 0, or null>",
  "phase_closed_at": "<ISO-8601, now — same write as this sidecar, or null>",
  "phase_id": "<task-id>",
  "started_at": "<ISO-8601, session start of this phase>",
  "completed_at": "<ISO-8601, now>",
  "files_touched_count": <int>,
  "tests_written_count": <int, new test files only>,
  "scope_amendment_emitted": <bool>,
  "halt_reasons": [<kernel halt-sentinel enum values, if any>],
  "test_immutability_authorizations": [<canonical phrase strings, if any>]
}
```

`.telemetry/` is git-ignored in the consuming repo. The sidecar write must not introduce any new LLM turn or confirmation gate — it is a deterministic write bundled with the existing commit. If the sidecar write fails, log and continue; the canonical commit must still land.

`session_id` and `phase_opened_at` are the values captured in step 0; `phase_closed_at` is stamped now, in this same write. The three fields bound the phase so `hstack/scripts/telemetry/parsers/transcripts.py:phase_usage` can sum the transcript's assistant-turn usage between them — TE-4 (cost per phase) and TE-5 (cost per change) in the telemetry report. Any of the three `null`, unparseable, or inverted makes this phase *unmeasured*; it is never counted as zero. A failed resolution is logged and the canonical commit still lands. `hstack/templates/telemetry-sidecar.md` is the canonical schema — when a Skill and that document disagree, that document wins.

## Session boundary

`implement` is a natural session cut. The auto-commit above has already written the
durable state to disk — `plan.md (steps-completed) and the committed code` carries everything the next phase loads at session
start, so the conversation itself holds nothing downstream needs. Long contexts
degrade model performance well before the window limit, so cutting here costs
nothing and buys accuracy back.

At terminal state, emit a cut notice followed by a ready-to-paste kickoff prompt.
The kickoff prompt is the handoff mechanism: the engineer carries it into a fresh
session, so no hook, no cursor and no on-disk state is needed to route it. Format:

```
HSTACK-CUT: implement complete — cut recommended before the next phase, or verify once every phase is done.

Paste into a fresh session:
────────────────────────────────────────────────
/hstack:implement <next-phase-id> <change-id>

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
- An existing test would need to be modified, deleted, or have its snapshot updated, and the human has not yet typed the canonical authorization phrase.
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
- Never edit, delete, or neutralize an existing test without per-test authorization. The kernel's test-immutability rule is non-negotiable; the default fix for a failing test is to fix the code under test.
- Never run bulk snapshot-update flags. Each snapshot update needs its own authorization.
- Never accept a blanket "fix the tests" authorization. Per-test scope is mandatory.
