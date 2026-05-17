---
name: hstack-tech-debt-resolve
description: |
  Use this skill when the engineer wants to start work on resolving a known tech-debt item. The Skill is the canonical entry point into the resolution flow: it prints the tech-debt's full body, walks each Pre-condition for engineer confirmation, halts on any unmet pre-condition, and on confirmation flips the tech-debt to `in-progress` via `spec-author` and scaffolds a resolution change folder with `resolves-tech-debt` pre-populated and the Acceptance section quoted into Target Behavior. Examples:

  <example>
  Context: The team agreed to live with a hardcoded Tailwind class until the design token system exposed `--warning-yellow-300`. The token landed yesterday; now the team wants to fix TD-0042.
  user: "/hstack:tech-debt-resolve TD-0042-overage-banner-tailwind-class"
  assistant: "I'll print TD-0042 in full, walk each Pre-condition for your confirmation (the design token bullet should now be met), then flip the TD to in-progress and scaffold the resolution change-spec with the Acceptance section quoted into Target Behavior. After the scaffold, continue with /hstack:test-plan."
  <commentary>
  The Skill is the only authoring path that flips a tech-debt out of `open`. The kernel forbids manual frontmatter edits to tech-debt status. Pre-conditions are prose in v1 and require engineer confirmation; the Skill logs that confirmation into the scaffolded change-spec's Open Questions section so the adversarial-reviewer can later verify the team didn't rationalize away an unmet pre-condition.
  </commentary>
  </example>

  <example>
  Context: An engineer attempts to start resolving a tech-debt whose Pre-conditions reference an ADR that has not been accepted.
  user: "/hstack:tech-debt-resolve TD-0019-event-ordering-fallback"
  assistant: "I'll halt — TD-0019's Pre-conditions name 'ADR-0034 must be accepted before we pick a strategy', and ADR-0034 is at `proposed`. Resolve that first via /hstack:adr-new or by advancing ADR-0034 to `accepted`."
  <commentary>
  Some pre-conditions are mechanically checkable (ADR exists at `accepted`, file exists, related TD at `resolved`). The Skill checks those mechanically and halts on failure. Prose pre-conditions still require engineer confirmation. Mechanical halts cannot be overridden by engineer confirmation — the upstream artifact must actually change state first.
  </commentary>
  </example>

  <example>
  Context: An engineer wants to resolve a tech-debt but only partially — the change addresses 2 of 3 Acceptance bullets.
  user: "/hstack:tech-debt-resolve TD-0027-rls-cleanup --partial"
  assistant: "I'll halt — partial resolution is not supported in v1. Either author a new tech-debt via /hstack:tech-debt-new for the portion this change will fix and leave TD-0027 at `open`, or expand the change's scope to satisfy all Acceptance bullets."
  <commentary>
  Per the kernel's tech-debt resolution rules, a change-spec either fully resolves a TD or it doesn't. Partial work creates audit ambiguity ("did this fix it?") and breaks the AR-07 Acceptance-satisfied finding lens. The Skill refuses --partial flags and forces the engineer to make the split explicit.
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
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates the TD frontmatter flip and the scaffolded change-spec frontmatter}}"
---

## Purpose

`hstack-tech-debt-resolve` is the canonical entry point for resolving a known tech-debt item. The Skill orchestrates `spec-author` to flip the TD status `open → in-progress`, set `resolution-attempted-at`, append a Resolution Log entry, and scaffold a resolution change-spec under `hstack/specs/changes/<id>/` with `resolves-tech-debt` pre-populated and the TD's Acceptance section quoted into the change-spec's "Resolves Tech-Debt" section. After this Skill, the engineer continues with the normal workflow (`/hstack:test-plan`, etc.).

This Skill exists because manual frontmatter edits to tech-debt status are forbidden by the kernel. The reciprocal `tech-debt.resolved-by ↔ change-spec.resolves-tech-debt` write is enforced by TD-04 and is owned by `spec-author`.

## When to invoke

Invoke when a tech-debt item is at `status: open`, its Pre-conditions are met, and the engineer wants to begin work on the fix. Re-invoking on a TD already at `in-progress` is a no-op (idempotency): the Skill detects the existing scaffolded change folder via `resolved-by` (set provisionally) and reports its current state.

## Inputs

- `<td-id>` (required, positional): the tech-debt id (e.g., `TD-0042-overage-banner-tailwind-class` or the short `TD-0042`).

Optional:

- `--area <module>`: override the area for the scaffolded change-spec. Default: the TD's `related-modules[0]` if non-empty; otherwise the Skill asks.
- `--slug <slug>`: override the slug for the resolution change-spec. Default: `resolve-<td-slug-suffix>` (e.g., `resolve-overage-banner-tailwind-class`).

The `--partial` flag is explicitly rejected — v1 does not support partial resolution.

## Preconditions

Before any work:

- Verify `hstack/tech-debt/<td-id>.md` exists and is at `status: open`. If at `in-progress`, the Skill enters idempotent-resume mode (see below). If at `resolved`, `wontfix`, or `archived`, halt with the terminal status named.
- Verify the engineer is not on `main` (or the configured default branch) if hstack's branch-hygiene rule applies — the resolve flow will create a new branch as part of the scaffold step.
- Read the TD's Pre-conditions section. For each bullet, classify mechanically when possible:
  - References to ADR-NNNN: check that the ADR exists at `status: accepted`. If at `proposed` or `deprecated`, halt mechanically.
  - References to another TD: check that the referenced TD is at `resolved`. If not, halt mechanically.
  - References to a file or symbol existing: grep-verify. If absent, halt mechanically.
  - Prose pre-conditions that name no checkable artifact: defer to engineer confirmation in step 2 of orchestration.

Mechanical halts cannot be overridden by engineer confirmation; the upstream artifact must change state first.

## Orchestration steps

1. **Print the TD in full.** Read `hstack/tech-debt/<td-id>.md` and print its Title, Why we took the shortcut, What it costs us, Fix sketch, Pre-conditions, and Acceptance sections to the conversation. The engineer should re-read this before starting; tech-debt context decays.

2. **Walk Pre-conditions for confirmation.** For each Pre-condition bullet, ask "Is this met? (y/n + one-sentence justification)". Mechanical halts have already filtered the un-confirmable cases; remaining bullets require engineer judgment. Record each `(bullet, met, justification)` triple in a transient state file at `hstack/.session-state/td-resolve-<td-id>.yaml` for resumability and for inclusion in the scaffolded change-spec's Open Questions section. Any "no" halts the Skill with the recommended remediation surfaced from the bullet text.

3. **Confirm proceed.** Print: "TD-NNNN is ready to resolve. Pre-conditions confirmed by `<owner>` on `<date>`. Proceed to scaffold the resolution change folder? (Y/n)". Default Yes.

4. **Determine area and slug.** If `--area` not provided, use TD's `related-modules[0]`. If `related-modules` is empty, ask the engineer. If `--slug` not provided, default to `resolve-<td-slug-suffix>`. Confirm with engineer.

5. **Invoke `spec-author` for the TD status flip.** Use the Task tool with `subagent_type: spec-author` and instructions: flip `hstack/tech-debt/<td-id>.md` frontmatter `status: open → in-progress`, set `resolution-attempted-at: <today>`, append a Resolution Log entry naming the resolving change-spec id (computed in step 6). Auto-commit at the status transition per the kernel's auto-commit rule.

6. **Scaffold the resolution change folder.** Compute the change-spec id (`<YYYY-MM>-<area>-<slug>`). Invoke the scaffold flow inline (do not call `/hstack:change-new` to avoid duplicate interview prompts):
   - Verify the area has a current module-spec.
   - Create `hstack/specs/changes/<change-id>/`.
   - Seed `spec.md` from `hstack/templates/change-spec.md` with frontmatter populated: `id`, `type: change-spec`, `status: draft`, `owner` (from `git config user.name`), `area`, `related-spec: <area>`, `resolves-tech-debt: [<td-id>]`, `created` and `updated` to today, `schema-version: 1`.
   - Pre-populate the "Resolves Tech-Debt" prose section: a pointer to `../../tech-debt/<td-id>.md` followed by the TD's Acceptance section quoted verbatim under the heading "Acceptance from TD-NNNN".
   - Pre-populate the Open Questions section with the Pre-conditions confirmation log from step 2 (the `(bullet, met, justification)` triples), so the adversarial-reviewer can later verify the team did not rationalize away an unmet pre-condition.
   - Pre-populate Problem section opener: "Resolves [<td-id>](../../tech-debt/<td-id>.md): <TD Title>. The TD was introduced by <introduced-by> and has been at `open` since <created>."

7. **Offer branch creation.** Mirror `/hstack:change-new`'s branch hygiene step: offer to create `change/<change-id>` from the current branch. Default Yes.

8. **Auto-commit.** Single commit at scaffold completion. Commit message: `chore(tech-debt-resolve): scaffold <change-id> resolving <td-id>`.

9. **Direct engineer to next step.** Print: "Resolution change scaffolded at `hstack/specs/changes/<change-id>/`. Continue with `/hstack:test-plan <change-id>` when ready. The TD is now at `in-progress` and will be flipped to `resolved` by `/hstack:finalize` after the resolving change is merged."

## Outputs

- `hstack/tech-debt/<td-id>.md` advanced to `status: in-progress` with `resolution-attempted-at` and an appended Resolution Log entry.
- `hstack/specs/changes/<change-id>/spec.md` at `status: draft`, with `resolves-tech-debt: [<td-id>]` and the Resolves Tech-Debt section pre-populated.
- Optional new branch `change/<change-id>`.
- One commit at scaffold completion (with the TD flip and the change-spec scaffold both included in the same commit so the reciprocal write lands atomically).

## Auto-commit triggers

- One commit at scaffold completion, both files included. Commit message: `chore(tech-debt-resolve): scaffold <change-id> resolving <td-id>`.

## Idempotency contract

- Re-running on a TD already at `in-progress`: the Skill reads the TD's Resolution Log to find the existing resolving change-spec id, verifies the change folder exists, and reports its current state ("Resolution in progress at `<change-id>`; current change-spec status: `<status>`. Continue with `<next-skill>`."). No new scaffold is created.
- Re-running mid-interview after a halt: the Skill reads `hstack/.session-state/td-resolve-<td-id>.yaml` and resumes at the next un-confirmed Pre-condition.
- Re-running after the TD's `resolved-by` is set but status is still `in-progress` (an inconsistent state): the Skill halts and surfaces the inconsistency for manual reconciliation via `spec-author`.

## Stop conditions

Beyond the kernel's general stop conditions:

- The TD does not exist or is at a terminal status (`resolved`, `wontfix`, `archived`). Halt with the status named.
- A mechanical Pre-condition halts the Skill (ADR not accepted, dependent TD not resolved, named file absent). Cannot be overridden by engineer confirmation.
- The engineer answers "no" on any prose Pre-condition. The Skill logs the unmet bullet and surfaces the recommended remediation from the bullet text.
- The TD's `related-modules[0]` is empty and the engineer does not provide `--area`.
- The area has no current module-spec.
- The change-spec id (`<YYYY-MM>-<area>-<slug>`) collides with an existing change folder. Ask the engineer for a different slug.
- The TD's Acceptance section is empty (TD authored without Acceptance, which TD-01 should have caught — flag as a validation gap).
- `--partial` flag is passed. Halt with the message above.

## Failure modes

- **TD's Acceptance is too vague to satisfy mechanically.** The Skill scaffolds anyway but flags in the change-spec's Open Questions that the adversarial-reviewer will need to interpret. The engineer is reminded that AR-07 makes Acceptance-satisfied a mandatory finding lens.
- **Pre-condition confirmation session interrupted.** Resumable via the session-state file; engineer continues from the next un-confirmed bullet.
- **Spec-author write fails mid-scaffold.** Halt; the TD's status flip and the change-spec scaffold must land in the same commit to preserve reciprocity. If only the TD flipped, manual reconciliation is required.

## Anti-patterns

- Never flip a tech-debt status without invoking `spec-author`. The kernel forbids direct frontmatter writes to tech-debt by any other agent.
- Never accept blanket "all pre-conditions are met" confirmations. Each bullet must be individually confirmed with a one-sentence justification.
- Never silently downgrade a mechanical halt to a soft warning. Mechanical halts represent upstream state that must actually change.
- Never scaffold without quoting the TD's Acceptance into the change-spec's Resolves Tech-Debt section. The quote is what AR-07 checks against.
- Never accept `--partial`. Direct the engineer to split the TD via `/hstack:tech-debt-new` instead.
- Never proceed when the TD is at a terminal status. Resolved is resolved; wontfix is final.
