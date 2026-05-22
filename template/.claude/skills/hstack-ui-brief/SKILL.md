---
name: hstack-ui-brief
description: |
  Use this skill when a change-spec at `ready-to-plan` or later has `ui` in its surfaces and needs `ui-brief.md` drafted before the cofounder produces Figma frames and before `hstack-change-plan` runs. The Skill orchestrates the `ui-ux-briefer` subagent against the configured design system docs. Examples:

  <example>
  Context: The billing-overage change-spec is at ready-to-plan with surfaces: [ui, db]; the cofounder is about to start Figma work and needs the brief first.
  user: "/hstack:ui-brief 2026-05-billing-overage-warning"
  assistant: "I'll invoke ui-ux-briefer with the design system docs, the change-spec, the linked story, and the growth-marketer persona. Reused components first; any new component carries a justification per UI-01."
  <commentary>
  The Skill is the only entry point for ui-brief production. It enforces the reuse-bias by relying on the subagent's challenge prompt and the validator's UI-01 rule. Skipping the Skill and letting the cofounder freelance in Figma erodes the design system.
  </commentary>
  </example>

  <example>
  Context: A change-spec without `ui` in surfaces is mistakenly passed to this Skill.
  user: "/hstack:ui-brief 2026-05-internal-cron-rebuild"
  assistant: "I'll halt — surfaces on that change-spec is [api, infra], no ui. The ui-brief is conditional and is not produced for changes without ui surfaces."
  <commentary>
  The surface-conditional gate is hard. Producing a ui-brief for a non-ui change inflates the artifact count and slows the merge without value.
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
  - "{{TODO-MCP: Figma MCP — optional; enables richer reuse hints when present, falls back to URL-only references when absent}}"
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates ui-brief frontmatter and UI-01/UI-02}}"
---

## Purpose

`hstack-ui-brief` produces `ui-brief.md` for a change touching the `ui` surface by orchestrating the `ui-ux-briefer` subagent. It is the upstream artifact for the cofounder's Figma work and a co-input for the implementer alongside `figma-handoff.md`. It is conditional on `surfaces` including `ui` and halts otherwise.

## When to invoke

Invoke after the change-spec reaches `status: ready-to-plan` and before `hstack-change-plan` runs, when the change-spec's `surfaces` includes `ui`. Re-invoke when the spec changes shape in ways the existing brief no longer reflects.

## Inputs

- `<change-id>` (required, positional): the change-spec id.

## Preconditions

Before any work:

- Verify the change-spec exists at `hstack/specs/changes/<id>/spec.md` and is at `status: ready-to-plan` or later.
- Verify `surfaces` includes `ui`. If not, halt with the surface-conditional message.
- Verify the configured design-system resources are reachable per their declared source in `hstack/config.yaml` (`design-system.components.source`, `tokens.source`, `brand-guidelines.source`). For each resource the brief will need: `in-repo` paths must resolve; `figma-mcp` / `notion-mcp` sources require the corresponding MCP to be wired and reachable (UI-surface changes are high-stakes — graceful degradation is not safe here); `submodule` / `npm` / `external-other` must fetch. A resource at `source: none` is treated as "not yet captured" — halt if the brief genuinely needs it, otherwise proceed against the resources that ARE configured.
- Verify the `design-system-version` declared in `hstack/config.yaml` is current and is what the brief will reference. Halt on drift.
- Read the change-spec's `user-stories` array; verify each story is reachable in the configured store and read it. Halt if any linked story or its persona is missing.

## Orchestration steps

1. **Invoke `ui-ux-briefer`.** Use the Task tool with `subagent_type: ui-ux-briefer` and context = [kernel, `hstack/templates/ui-brief.md`, change-spec, linked stories, referenced personas, design-system components / tokens / brand-guidelines at the configured paths]. The subagent walks the six sections — Goal, Layouts and States, Reused Components, New Components, Copy, Accessibility Notes — with confirmation gates.

2. **Exercise the new-component challenge.** Per the `ui-ux-briefer` contract, every entry in `new-components` carries a justification paragraph in section 4, elicited via the challenge "Why is this new and not a reuse?" The Skill does not bypass this.

3. **Token-gap surfacing.** When the brief requires a value not in the design system's current token set, `ui-ux-briefer` names the gap and notes that a tech-debt item should be filed via `hstack-tech-debt-new` before implementation begins. The Skill does not file the tech-debt itself; it surfaces the recommendation and waits for the engineer to act.

4. **Validate.** Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` against the in-progress brief — UI-01 (every `new-components` entry has a section-4 justification paragraph), UI-02 (`design-system-version` matches config).

5. **Transition.** When every section is confirmed and the validator passes, `ui-ux-briefer` advances status from `draft` to `drafted`. Auto-commit fires.

## Outputs

- `hstack/specs/changes/<change-id>/ui-brief.md` at `status: drafted`.
- Optional surfaced recommendation to author a tech-debt item for any design-token gap.

## Auto-commit triggers

- Status transition to `draft` after the first section confirms.
- Status transition to `drafted` at the end. Commit message: `ui-brief(<change-id>): drafted`.
- Edits to `new-components` array (because UI-01 enforcement depends on it).

## Idempotency contract

- Re-running on an existing `drafted` brief without changes: the subagent reads the existing instance as the proposal layer; identical re-confirmation is a no-op.
- Re-running after a halt mid-brief: `ui-ux-briefer` reads the partial file and resumes at the next un-confirmed section.
- Re-running after the change-spec's `surfaces` has been amended to drop `ui`: halt with the surface-conditional message; the existing brief is archived only on explicit engineer action.

## Stop conditions

Beyond the kernel's general stop conditions:

- The change-spec's `surfaces` does not include `ui`.
- The configured design system docs are unreachable.
- `design-system-version` in config has drifted from what the brief would target.
- A new component's justification cannot be articulated under the challenge prompt — the signal that an existing component should be reused.
- The brief requires a new design-system token and no tech-debt item exists or is filed concurrently.

## Failure modes

- **Linked story unreachable.** Halt; reconcile via `hstack-story-draft` or fix the change-spec's `user-stories` array.
- **Figma MCP absent.** Degraded mode — `ui-ux-briefer` produces the brief without frame-content hints, flags in the conversation, continues.
- **Validator fails UI-01 because a `new-components` entry has no body justification.** Halt; the subagent re-runs the challenge prompt for that component.

## Anti-patterns

- Never invent a new component when composition of existing primitives would work. The challenge prompt exists to force this discipline.
- Never paste design-token values inline. Use named tokens; gaps are flagged for tech-debt.
- Never produce a ui-brief for a non-ui change. The conditional is hard.
- Never write Figma frame URLs in the ui-brief — that is `figma-handoff.md`'s domain (the cofounder's deliverable).
- Never silently brief against a stale design-system version.
