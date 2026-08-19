---
name: hstack-change-new
description: Use to scaffold the `hstack/specs/changes/<id>/` folder and seed `spec.md` from the template at the start of a new change. Scaffolds only — `spec-author` fills the fields, and `/hstack:change-plan` sequences phases much later.
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates the seeded change-spec frontmatter}}"
---

## Purpose

`hstack-change-new` scaffolds the per-change folder under `hstack/specs/changes/<id>/` and seeds `spec.md` from the canonical template. It does no authoring — `spec-author` is invoked separately by the engineer once the folder exists. This Skill exists to keep id-generation, folder layout, and template seeding consistent across changes, and to enforce the module-spec precondition before any change work begins.

## When to invoke

Invoke at the start of any new change. The Skill is the conventional first step of the per-change workflow, run before `hstack-story-draft`, `hstack-change-plan`, or any other per-change Skill. Trivial changes (typo fixes, dependency bumps) that the engineer intends to tag with `trivial: true` may skip this Skill, though most engineers run it anyway for consistency.

## Inputs

- `<area>` (required, positional): the module key, must match an existing module-spec at `status: current`. Examples: `billing`, `orchestrator`, `knowledge-base`.
- `<slug>` (required, positional): kebab-case short name for the change. Examples: `overage-warning`, `inline-mode`. The Skill validates the slug shape (kebab-case, no spaces, no leading numerics).

The change `id` is derived as `YYYY-MM-<area>-<slug>` using the current month from `today`'s ISO date.

## Preconditions

Before any work:

- Verify `hstack/config.yaml` exists at `init-status: complete`. If not, halt and direct the engineer to `hstack-init`.
- Verify `hstack/specs/<area>/spec.md` exists at `status: current`. If absent or non-terminal, halt and direct the engineer to `hstack-module-spec <area>`.
- Verify `hstack/specs/changes/<derived-id>/` does not already exist. If it does, halt and surface the existing folder — the engineer is either resuming (in which case no scaffold is needed) or has a slug collision (in which case they pick a different slug).
- Verify the slug matches `^[a-z][a-z0-9-]*$`.

## Orchestration steps

1. **Derive the id.** Compute `<YYYY-MM>-<area>-<slug>` from today's date and the inputs. Surface the derived id to the engineer for confirmation before writing.

2. **Create the folder.** `mkdir -p hstack/specs/changes/<id>/` via Bash.

3. **Seed `spec.md`.** Read `hstack/templates/change-spec.md`, instantiate the frontmatter with `id`, `type: change-spec`, `status: draft`, `owner` (from `git config user.name` or `hstack/config.yaml`'s default owner), `area: <area>`, `related-spec: <area>`, `created` and `updated` set to today, `schema-version: 1`. Leave `surfaces`, `user-stories`, `in-scope`, `out-of-scope`, `related-adrs`, `creates-tech-debt`, `parent-change`, `threat-model-delta`, `internal-tooling`, `enables`, `enabled-by`, `trivial` as their template defaults (typically empty arrays or `null`). Leave every prose section empty, with the template's interview-prompt comments intact for `spec-author` to consume.

4. **Forward-reference reconciliation for `enables` chains.** Grep every existing `hstack/specs/changes/*/spec.md` for the new `<id>` in `enables:` arrays. For each match: the matched (upstream) spec already declares this new (downstream) spec as a Category-B enabler. Per SP-14, write the reciprocal `enabled-by: [<upstream-id>, ...]` array on the newly-seeded spec in the same scaffold commit (this is the atomic-pair guarantee — both halves land together). When no match exists, leave `enabled-by: []`. Read-only on the upstream spec — its `enables` array was already written when the upstream was authored; no edit there. This is a mechanical operation per the kernel's Mechanical-operations section; no subagent is invoked. Surface the reconciliation to the engineer: "Detected upstream spec(s) declaring `enables: [<id>]` — populating `enabled-by` reciprocally."

5. **Validate.** Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` against the seeded file. Validation at `status: draft` is permissive — empty arrays and empty prose are allowed at draft — but the universal floor (FM-01) must pass.

6. **Offer branch creation.** Run `git branch --show-current`. If the current branch is `main` (or the configured default), ask the engineer: "You're on `<current-branch>`. Convention is one branch per change-spec — create `change/<id>` from here and check out before the scaffold commits? [Y/n/type-different-name]". Default Yes. On confirmation, run `git checkout -b change/<id>` BEFORE step 7 so the scaffold commit lands on the correct branch from the start. If the engineer declines or names a different branch, honor the choice and continue on the chosen branch. If the current branch is anything other than the configured default (i.e., already on a feature branch), do nothing — the engineer has a deliberate branching strategy and the Skill respects it.

7. **Auto-commit.** Commit message: `chore(change-new): scaffold <id>`.

8. **Surface next steps.** Print a one-line instruction directing the engineer to invoke `spec-author` (or `hstack-story-draft` first if the change is user-facing and no story exists yet). If the change has Category-B `enabled-by` populated from step 4, also note the upstream linkage so the engineer is reminded which prerequisite this realizes.

The Skill does not invoke any subagent. Scaffolding is mechanical and the engineer's subsequent moves vary by change.

## Outputs

- New directory `hstack/specs/changes/<id>/`.
- New file `hstack/specs/changes/<id>/spec.md` at `status: draft`, with frontmatter populated to the floor and prose sections empty.

## Auto-commit triggers

- One commit at scaffold completion. No further commits from this Skill.

## Idempotency contract

- Re-running with the same `<area>` and `<slug>` when the derived folder exists is a no-op; the Skill detects the existing folder, surfaces it, and exits without writes.
- Re-running with a different month (e.g., the engineer scaffolded in May, returns in June, and re-runs the same slug) produces a different id and a new folder; this is intentional — month-prefixed ids prevent slug-collision across long-running work.
- If the folder exists but `spec.md` is absent (rare, indicates an interrupted scaffold), the Skill re-seeds `spec.md` only.

## Stop conditions

Beyond the kernel's general stop conditions:

- The `<area>` does not correspond to an existing module-spec at `status: current`. Halt.
- The `<slug>` violates kebab-case shape. Halt.
- The derived folder already exists with content. Halt and ask.

## Failure modes

- **Validator fails on the seeded spec.** The template itself is broken — halt and surface as a hstack installation issue.
- **`git config user.name` returns empty and `hstack/config.yaml` has no default owner.** Halt and ask the engineer for their owner handle.

## Anti-patterns

- Never write prose content into the seeded `spec.md` beyond the template's existing prompts. The Skill scaffolds; `spec-author` authors.
- Never derive the id from anything other than the current month, the area, and the slug. Hand-rolled ids break the kebab-case + chronological-prefix convention that other Skills depend on.
- Never scaffold under an area whose module-spec is absent. The precondition is hard.
- Never modify an existing change folder. Reruns are no-ops or refusals, never overwrites.
- Never advance `status` past `draft` from this Skill. Subsequent transitions are owned by the authoring subagents.
