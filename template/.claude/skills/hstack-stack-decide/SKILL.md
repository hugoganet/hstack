---
name: hstack-stack-decide
description: Use to decide stack layers — framework, database, auth, hosting, observability — and capture each as an ADR. Greenfield Phase 4, the brownfield stack step when stack ADRs are missing, or a standalone mid-project layer swap.
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
  - "{{TODO-SKILL: /hstack:adr-new — invoked via spec-author handoff for ADR authoring}}"
  - "{{TODO-SKILL: /hstack:research — invoked for unfamiliar-territory deep-dives}}"
  - "node hstack/scripts/validate-spec.mjs — frontmatter validator"
---

## Purpose

`hstack-stack-decide` is the atom that produces stack ADRs via the `stack-architect` subagent. It does NOT write to `hstack/adr/` directly; the kernel rule reserves ADR authoring for `spec-author`. Stack-architect produces pre-populated Context / Decision / Alternatives content; spec-author runs the Nygard interview in confirm-or-revise mode with the Consequences challenge firing fresh.

## When to invoke

- Phase 4 of `/hstack:greenfield-init`.
- The stack-decision step of `/hstack:brownfield-init` when no stack ADRs exist.
- Standalone via `/hstack:stack-decide [--layer <name>]` for mid-project layer swaps.

## Inputs

- `--layer <name>` — optional, standalone mode. Runs against a single declared layer (`framework | database | auth | hosting | observability | <custom>`). In greenfield/brownfield mode, the Skill walks all declared layers.

## Preconditions

- `hstack/config.yaml` at `init-status: minimal-complete` or later, with the default-stack declaration present (set in greenfield-init Phase 0 or via `/hstack:configure default-stack`).
- `hstack/context/app-architecture.md` at `status: current` (greenfield/brownfield mode). In standalone mode, the atom may run without app-architecture only if the layer being swapped doesn't depend on architecture decisions (rare).
- `hstack/templates/adr.md` present.
- No layer choice contradicts `data-architecture.md`'s `assumes-database`. A non-Postgres choice against `assumes-database: postgres` is never honored silently — halt and surface, and the engineer either refreshes the upstream atom or revises the constraint.
- Existing ADRs read at session start to set the next sequential ADR id and detect supersession candidates.

## Orchestration steps

1. **Detect mode.** Greenfield/brownfield: walk all declared layers. Standalone: run against the named `--layer`.
2. **Invoke `stack-architect` subagent.** Via the Task tool with `subagent_type: stack-architect`. Pass mode, layer scope, the canonical session-start context.
3. **For each layer (greenfield/brownfield mode):**
   - **Default check.** stack-architect reads `hstack/config.yaml`'s declared default for this layer.
   - **Fast-path confirmation.** If the engineer accepts the default, the layer is added to a pending rollup ADR.
   - **Deep-dive.** If the engineer chooses to deep-dive, stack-architect runs the constraint interview (scale, ops capacity, compliance, AI-native specifics), surfaces 2–3 candidate options with tradeoff axes, and lets the engineer choose.
   - **ADR handoff.** stack-architect prepares the Context / Decision / Alternatives sections, then invokes `/hstack:adr-new` via the Task tool (which invokes `spec-author`). spec-author runs confirm-or-revise on the prepared content. The Consequences challenge prompt fires fresh per the kernel's Nygard challenge rule.
4. **Rollup ADR (greenfield/brownfield mode).** After per-layer ADRs land, the Skill produces one rollup ADR via `/hstack:adr-new` naming every defaulted layer with the constraint check that confirmed each.
5. **Standalone mode** runs the same constraint interview + spec-author handoff for the single `--layer`. The new ADR carries `supersedes: [<predecessor>]`; the predecessor gets the reciprocal `superseded-by` written atomically by spec-author.
6. **Config update (optional).** After ADRs land, the Skill asks the engineer whether any layer's choice diverged from the prior default in a way they want project-wide. If yes, the Skill proposes a `hstack/config.yaml` update via the proposed-diff preview + Y/n gate, then commits the config update as a mechanical operation.

## Outputs

- One rollup ADR plus N per-layer ADRs (greenfield/brownfield mode), or one new ADR with `supersedes` (standalone mode), all at `status: accepted`.
- Updated `hstack/config.yaml` default-stack declaration (optional, only if changed).
- `hstack/.session-state/<session-id>.yaml` (transient).

## Auto-commit triggers

- Each ADR commits via `/hstack:adr-new`'s standard pattern (single auto-commit per ADR).
- Standalone mode's supersedes / superseded-by reciprocal pair commits atomically in one git commit per the kernel.
- Config update (if any) commits as a separate mechanical operation.

## Idempotency contract

- If a layer's current ADR is at `accepted` and the engineer's constraints + default-stack haven't changed: skip the layer.
- If a deep-dive interview was started but no ADR landed (engineer parked mid-interview): resume the interview from session-state.
- Re-running standalone mode for a layer whose ADR is already at `accepted` and no supersession is requested: print summary, exit no-op.

## Stop conditions

- App-architecture at non-terminal status (greenfield/brownfield mode).
- A chosen option contradicts an upstream invariant (e.g., DB without RLS conflicts with `data-architecture.md`'s tenant-scoped posture). Halt with `HSTACK-HALT: reason=upstream-drift`.
- A research session is needed (unfamiliar territory) but the engineer has not authorized `/hstack:research`.
- Standalone mode supersedes an ADR at a non-accepted status.
- The Postgres assumption in `data-architecture.md` is being contradicted. Halt and surface.

## Failure modes

- **spec-author handoff fails partway** (e.g., Consequences challenge produces a finding the engineer doesn't accept). The pending ADR sits at `draft`; the engineer either revises or routes through `/hstack:configure adr-author <id>` per spec-author's recovery path.
- **Research subagent unavailable when needed.** Persist constraint interview state; resume later.
