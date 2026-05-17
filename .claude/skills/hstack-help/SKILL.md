---
name: hstack-help
description: |
  Use this skill when the engineer (or a cofounder opening the repo cold) wants situation awareness — "where are we, what can I run, what's next." Read-only across every artifact; no subagents invoked, no disk writes, safe to run any time. Examples:

  <example>
  Context: The cofounder hasn't touched the repo in two weeks and wants to know what's in flight before starting work.
  user: "/hstack:help"
  assistant: "I'll read every change folder, the context layer, ADRs, tech-debt, research sessions, and the git state. You'll get a three-section report: where you are, health, commands you can run right now with READY / BLOCKED markers."
  <commentary>
  Default mode is the full status report. No arguments needed. Output is computed entirely from disk frontmatter — no subagent invocations, no MCP calls, fast even on a large repo.
  </commentary>
  </example>

  <example>
  Context: The engineer is mid-change and wants a focused view of one change-spec's phase progression.
  user: "/hstack:help --change 2026-05-billing-overage-warning"
  assistant: "I'll read every artifact for that change and render the phase DAG: spec → ui-brief / figma-handoff / data-review / security-review / plan → implement (N of M phases) → verify → adversarial-review → ship. Each phase shows status and the next action."
  <commentary>
  Detailed mode for one change. Useful when resuming work after an interruption — the DAG view shows exactly which phase is next and what artifact gates it.
  </commentary>
  </example>
tools:
  - Read
  - Grep
  - Glob
  - Bash
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — invoked in --validate sub-mode to surface any artifact drift}}"
---

## Purpose

`hstack-help` is the read-only situation-awareness Skill. Its job is to answer three questions without writing anything: where is the team in their hstack-governed work, what is healthy / unhealthy, and what commands are available to run right now. It invokes no subagent. It writes no artifact. It is safe to run any time, by any team member, on any branch.

## When to invoke

Invoke when:
- You open the repo after a break and need a refresher.
- A cofounder or new contributor is orienting themselves.
- Something feels off (a Skill halted, a status seems wrong) and you want a system-level view before debugging.
- Mid-change, before invoking the next workflow Skill, when you want to confirm preconditions are met without trial-and-error halts.

Safe to run repeatedly. Output is computed from current disk state.

## Inputs

- No flag (default): full three-section status report.
- `--change <id>`: detailed view of one change-spec, including the phase DAG.
- `--commands`: print only the Skills cheat sheet (no current-state computation).
- `--explain <concept>`: look up a concept from the kernel, the template schemas, or the glossary. Examples: `--explain invariant`, `--explain tenant-isolation`, `--explain trivial-tag`.
- `--validate`: run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` against every artifact under `hstack/` and report violations.

## Preconditions

Minimal. The Skill is best-effort and degrades gracefully:

- Verify `hstack/` exists. If not, print "hstack is not installed in this repo. See `hstack/README.md` if vendoring, or run the vendoring procedure from the framework source."
- Verify `hstack/config.yaml` exists. If not (init not started), print "hstack is installed but not initialized. Run `/hstack:init` to bootstrap. Other Skills will halt until init completes."
- Beyond that, the Skill tolerates missing or partial artifacts — they show up in the report as "not present" or "draft", which is useful information, not an error.

## Orchestration steps

No subagents are invoked. Every step is a direct file read or shell call.

### Default mode (no flag)

1. **Section 1 — Where you are.**
   - Read `hstack/config.yaml` for `init-status` and the active MCP set.
   - Glob `hstack/specs/changes/*/spec.md`. For each, read frontmatter (`id`, `status`, `surfaces`, `owner`, `internal-tooling`, `trivial`, `parent-change`). Filter to non-terminal status (anything before `shipped`, `archived`).
   - For each in-flight change, compute the **next blocking action**:
     - `status: draft` → "Author via `spec-author` directly (or run `/hstack:story-draft` first if user-facing)."
     - `status: ready-to-plan` and missing conditional artifacts → name them; suggest the appropriate Skill (`/hstack:test-plan` first if missing — it gates the planner, `/hstack:security-review`, `/hstack:data-review` if db, `/hstack:ui-brief` if ui, `/hstack:change-plan`).
     - `status: ready-for-implementation` and plan has un-completed phases → "/hstack:implement <id> <next-task-id>" with the next phase id computed from `plan.steps-completed`.
     - `status: in-progress` → continue implementing remaining phases; verify after.
     - `status: ready-for-review` and no `verification.md` at passed → "/hstack:verify <id>".
     - `status: ready-for-review` and no `adversarial-review.md` at `findings-resolved` → "/hstack:adversarial-review <id> (FRESH SESSION REQUIRED)".
     - `status: ready-to-ship` → "/hstack:ship <id>".
   - Glob `hstack/adr/ADR-*.md`, count those at `status: proposed`. List ids.
   - Glob `hstack/tech-debt/TD-*.md`, count those at `status: open`. List the top 3 by severity.
   - Glob `hstack/research/sessions/*.md`, count those within the 30-day retention window. List the most recent 3.
   - Glob `hstack/specs/*/spec.md` and `hstack/context/*.md`, list any at `status: needs-refresh`.

2. **Section 2 — Health.**
   - MCPs: read `hstack/context/mcp-status.md` for wired vs degraded.
   - **Branch hygiene.** Run `git branch --show-current`. For each in-flight non-trivial change-spec, the expected branch is `change/<change-id>` per the kernel's branch-hygiene rule. Compare:
     - Current branch is `main` AND ≥ 1 non-trivial in-flight change exists → flag explicitly: "On `main` with in-flight non-trivial change `<id>`; expected `change/<id>`. Run `/hstack:branch <id>` to switch."
     - Current branch matches the expected `change/<id>` of one in-flight change → "Branch `change/<id>` matches in-flight change `<id>`."
     - Current branch is `change/<other-id>` and `<other-id>` is no longer in-flight (shipped or archived) → "On `change/<other-id>` (shipped); ready to start something new."
     - Trivial-only in-flight changes → no branch warning (trivial may commit on main).
   - Git state: `git status --short` count. Flag uncommitted hstack-relevant files.
   - Last hstack commit: `git log -1 --format='%h %s (%cr)' -- hstack/`. Shows when hstack-touching work last landed.
   - Local-ahead-of-remote: `git rev-list --count @{u}..HEAD 2>/dev/null` (silently skip if no upstream).

3. **Section 3 — Commands you can run right now.**
   - List every Skill grouped by category (setup, workflow, cross-cutting).
   - For each, compute a marker:
     - `READY` — preconditions detectable as met.
     - `BLOCKED: <reason>` — name the missing precondition.
     - `N/A — context` — e.g., `/hstack:ui-brief` for a repo with no in-flight ui-surface change.
   - For Skills that take arguments, show a parameterized example using the most likely current value (e.g., the active in-flight change-id).

### `--change <id>` mode

Read every artifact in `hstack/specs/changes/<id>/`. Render the phase DAG as ASCII with status per node:

```
spec [ready-for-implementation]
  ├── test-plan [passed] ✓
  ├── ui-brief [drafted] ✓
  ├── figma-handoff [ready] ✓
  ├── data-review [passed] ✓
  ├── security-review [concerns-acknowledged] ✓
  └── plan [in-progress]
        steps-completed: phase-1, phase-2, phase-3 of phase-1..phase-5
        next phase: phase-4-wire (depends on phase-3 ✓)
verification [not present]
adversarial-review [not present]
```

Below the DAG, the explicit next-action recommendation.

### `--commands` mode

Just the Skills cheat sheet. No state computation. Useful when typing in muscle memory.

### `--explain <concept>` mode

Grep `hstack/CLAUDE.md`, `hstack/context/glossary.md`, and (if available) the cached template schemas for the concept. Print the most relevant paragraph plus a pointer to the source file. If the concept is not found in any source, print: "Not in the kernel, glossary, or template schemas. Try the architecture doc at the URL in `hstack/README.md`, or ask in natural language and I'll pull from kernel context."

### `--validate` mode

Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` against every artifact under `hstack/`. Group failures by validation-rule id (SP-*, PL-*, AR-*, etc.) and name the offending file. Read-only — does not auto-fix anything.

## Outputs

- Console-rendered status report. No disk writes. No commits.
- No mutation of any artifact frontmatter.

## Auto-commit triggers

None. This Skill is strictly read-only.

## Idempotency contract

Trivially idempotent. Re-runs produce a fresh report from current disk state. No persisted state, no side effects.

## Stop conditions

Beyond the kernel's general stop conditions:

- The `--explain <concept>` lookup finds no match in any canonical source. Print the "not found" message and exit cleanly — not a failure.
- `--validate` mode requires the validator script. If absent, print a clear "validator not yet implemented" message (it's a known TODO) and skip the validation; the other modes still work.

## Failure modes

- **Cofounder runs the Skill before vendoring is complete.** Print the install pointer; do not try to compute a status report.
- **Many in-flight change-specs with conflicting next-action recommendations.** Just list them all; let the engineer prioritize.
- **Git state cannot be read (not a git repo).** Skip the git-related health lines; surface a "git not initialized" note.

## Anti-patterns

- Never write to any artifact, never auto-commit. The Skill's value is that it's safe to run any time.
- Never invoke a subagent. Status awareness does not require the conversational interview machinery.
- Never invent a "next action" for an artifact whose status is ambiguous — print the ambiguity, not a guess.
- Never run the validators with `--fix` or any write flag (when the validator gains those).
- Never call MCPs or perform network requests for the status report. Local file reads only.
