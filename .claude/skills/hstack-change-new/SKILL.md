---
name: hstack-change-new
description: |
  Use this skill when an engineer wants to start a new change and needs the `hstack/specs/changes/<id>/` folder scaffolded with templates pre-populated, before any spec-author or planner work begins. The Skill validates that the affected module has a current module-spec, derives the change id from the area and slug, scaffolds the folder, and seeds `spec.md` with the canonical template. Examples:

  <example>
  Context: The engineer is about to start work on the billing overage warning feature and needs the change folder before drafting the spec.
  user: "/hstack:change-new billing overage-warning"
  assistant: "I'll scaffold hstack/specs/changes/2026-05-billing-overage-warning/ with spec.md pre-populated from the template. spec-author runs separately when you're ready to fill the fields."
  <commentary>
  This Skill does not author content; it produces the empty folder shape so spec-author has a target to write into. Scaffold-only separation keeps the Skill cheap to re-run and idempotent on partial state.
  </commentary>
  </example>

  <example>
  Context: The engineer tries to scaffold a change in an area that has no module-spec yet.
  user: "/hstack:change-new playbook-runner inline-mode"
  assistant: "I'll halt — there's no hstack/specs/playbook-runner/spec.md at status current. Run /hstack:module-spec playbook-runner first."
  <commentary>
  Scaffolding refuses when the module's baseline doesn't exist. This is a deliberate gate: a change-spec whose `area` points at a nonexistent module-spec fails SP-01 anyway, so the Skill halts before any folder is created rather than producing dead scaffolding.
  </commentary>
  </example>
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

3. **Seed `spec.md`.** Read `hstack/templates/change-spec.md`, instantiate the frontmatter with `id`, `type: change-spec`, `status: draft`, `owner` (from `git config user.name` or `hstack/config.yaml`'s default owner), `area: <area>`, `related-spec: <area>`, `created` and `updated` set to today, `schema-version: 1`. Leave `surfaces`, `user-stories`, `in-scope`, `out-of-scope`, `related-adrs`, `creates-tech-debt`, `parent-change`, `threat-model-delta`, `internal-tooling`, `trivial` as their template defaults (typically empty arrays or `null`). Leave every prose section empty, with the template's interview-prompt comments intact for `spec-author` to consume.

4. **Validate.** Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` against the seeded file. Validation at `status: draft` is permissive — empty arrays and empty prose are allowed at draft — but the universal floor (FM-01) must pass.

5. **Auto-commit.** Commit message: `change-spec(<id>): scaffold`.

6. **Surface next steps.** Print a one-line instruction directing the engineer to invoke `spec-author` (or `hstack-story-draft` first if the change is user-facing and no story exists yet).

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
