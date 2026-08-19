---
name: hstack-tech-debt-resolve
description: Use to start fixing an `open` tech-debt item — walks its Pre-conditions, flips it to `in-progress`, and scaffolds the resolution change-spec. The fix path, as opposed to the wontfix and stale closure paths.
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

`hstack-tech-debt-resolve` is the canonical entry point for resolving a known tech-debt item. The Skill performs direct mechanical writes in the main session (per ADR-0001, no `spec-author` invocation): flips the TD status `open → in-progress`, sets `resolution-attempted-at`, appends a Resolution Log entry, and scaffolds a resolution change-spec under `hstack/specs/changes/<id>/` with `resolves-tech-debt` pre-populated and the TD's Acceptance section quoted into the change-spec's "Resolves Tech-Debt" section. After this Skill, the engineer continues with the normal workflow (`/hstack:test-plan`, etc.).

This Skill exists because manual frontmatter edits to tech-debt status are forbidden by the kernel. The reciprocal `change-spec.resolves-tech-debt: [<td-id>]` write at scaffold time is enforced by TD-04 and lands atomically with the TD status flip in a single auto-commit.

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

4. **Determine area, slug, and change-id.** If `--area` not provided, use TD's `related-modules[0]`. If `related-modules` is empty, ask the engineer. If `--slug` not provided, default to `resolve-<td-slug-suffix>`. Confirm with engineer. Compute the change-spec id as `<YYYY-MM>-<area>-<slug>`. Verify the area has a current module-spec; verify the derived change folder does not already exist. The id is now known and will be referenced by both writes below.

5. **Preview proposed writes (confirmation gate).** Per the kernel's AI writes / humans confirm contract for mechanical operations, print the proposed diff to the engineer:
   - TD frontmatter changes: `status: open → in-progress`, `resolution-attempted-at: <today>`, `updated: <today>`.
   - TD Resolution Log entry to append: `status: open → in-progress on <today> by <owner>. Resolution change-spec: <change-id>.`
   - New change-spec frontmatter (will be seeded in step 7).

   Ask "Proceed with these writes? (Y/n)". Default Yes. On `n`, halt.

6. **Write the TD (direct write + immediate validation).** Edit `hstack/tech-debt/<td-id>.md`:
   - **Defensive Resolution Log check.** If `## Resolution Log` is not present in the file (legacy TDs authored before the template included this section), append `\n## Resolution Log\n` to the end of the file first.
   - Edit frontmatter: `status: open → in-progress`, `resolution-attempted-at: <today>`, `updated: <today>`.
   - Append the Resolution Log entry: `status: open → in-progress on <today> by <owner>. Resolution change-spec: <change-id>.`
   - Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` against the file. On validation failure, halt — do NOT proceed to step 7. Unstaged changes can be reverted via `git checkout -- <td-file>`.

7. **Scaffold the resolution change folder.** (Do not call `/hstack:change-new` to avoid duplicate interview prompts.)
   - Create `hstack/specs/changes/<change-id>/`.
   - Seed `spec.md` from `hstack/templates/change-spec.md` with frontmatter populated: `id`, `type: change-spec`, `status: draft`, `owner` (from `git config user.name`), `area`, `related-spec: <area>`, `resolves-tech-debt: [<td-id>]`, `created` and `updated` to today, `schema-version: 1`.
   - Pre-populate the "Resolves Tech-Debt" prose section: a pointer to `../../tech-debt/<td-id>.md` followed by the TD's Acceptance section quoted verbatim under the heading "Acceptance from TD-NNNN".
   - Pre-populate the Open Questions section with the Pre-conditions confirmation log from step 2 (the `(bullet, met, justification)` triples), so the adversarial-reviewer can later verify the team did not rationalize away an unmet pre-condition.
   - Pre-populate Problem section opener: "Resolves [<td-id>](../../tech-debt/<td-id>.md): <TD Title>. The TD was introduced by <introduced-by> and has been at `open` since <created>."
   - Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` against the seeded change-spec. On validation failure, halt — the TD write from step 6 must be reverted manually via `git checkout -- <td-file>` before re-running the Skill.

8. **Offer branch creation.** Mirror `/hstack:change-new`'s branch hygiene step: offer to create `change/<change-id>` from the current branch. Default Yes.

9. **Auto-commit (single atomic commit).** `git add` both the TD and the new change-spec, commit with message `chore(tech-debt-resolve): scaffold <change-id> resolving <td-id>`. The reciprocal pair (TD `in-progress` ↔ change-spec `resolves-tech-debt: [<td-id>]`) lands in this single commit, preserving the kernel's atomicity rule.

10. **Direct engineer to next step.** Print: "Resolution change scaffolded at `hstack/specs/changes/<change-id>/`. Continue with `/hstack:test-plan <change-id>` when ready. The TD is now at `in-progress` and will be flipped to `resolved` by `/hstack:finalize` after the resolving change is merged."

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
- Re-running after the TD's `resolved-by` is set but status is still `in-progress` (an inconsistent state): the Skill halts and surfaces the inconsistency. Reconciliation is manual: either (a) `git checkout HEAD -- hstack/tech-debt/<td-id>.md` to revert to the prior committed state if the inconsistency came from an interrupted finalize, or (b) directly edit the TD frontmatter to set `resolved-by: null` and re-run `validate-spec.ts`. Do not invoke `spec-author` for this reconciliation — the kernel forbids it for reciprocal-back-reference writes.

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
- **A direct write fails mid-scaffold.** Halt before any commit. Per the new ordering (step 6 writes TD, step 7 writes change-spec, step 9 commits both atomically), no partial commit is possible — the failure leaves both files unstaged for the engineer to inspect or discard via `git checkout -- <file>`.

## Anti-patterns

- Never invoke `spec-author` for the TD status flip. Per the kernel's Mechanical operations section (ADR-0001), this Skill performs the flip directly via the `Edit` tool. The kernel's "spec-author is the only subagent permitted to write" rule applies to subagents; this Skill runs in the main session.
- Never accept blanket "all pre-conditions are met" confirmations. Each bullet must be individually confirmed with a one-sentence justification.
- Never silently downgrade a mechanical halt to a soft warning. Mechanical halts represent upstream state that must actually change.
- Never scaffold without quoting the TD's Acceptance into the change-spec's Resolves Tech-Debt section. The quote is what AR-07 checks against.
- Never accept `--partial`. Direct the engineer to split the TD via `/hstack:tech-debt-new` instead.
- Never proceed when the TD is at a terminal status. Resolved is resolved; wontfix is final.
