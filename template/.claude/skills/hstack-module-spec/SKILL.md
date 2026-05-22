---
name: hstack-module-spec
description: |
  Use this skill when an engineer needs a baseline `hstack/specs/<module>/spec.md` reverse-engineered for an existing module on a brownfield repo. Module-specs are foundational: every change-spec validates that `area` references an existing module-spec at `status: current`, and every per-change downstream subagent loads the relevant module-spec at session start. Examples:

  <example>
  Context: The team has just finished `hstack-init` and the engineer wants to produce a module-spec for the billing module before any change work begins there.
  user: "Run /hstack:module-spec billing."
  assistant: "I'll invoke spec-author with the billing paths from hstack/config.yaml, pack the module via RepoMix, and walk the seven module-spec sections through an interview."
  <commentary>
  Module-specs are the only artifact the `spec-author` reverse-engineers from existing code rather than authoring fresh. The Skill is run once per critical module on adoption; thereafter the spec is refreshed via `hstack-configure --interview` or by re-running this Skill when the cron flags it `needs-refresh`.
  </commentary>
  </example>

  <example>
  Context: A 60-day refresh cron has flagged `hstack/specs/orchestrator/spec.md` as `needs-refresh` because the orchestrator module has been heavily modified.
  user: "Refresh the orchestrator module-spec."
  assistant: "I'll re-run /hstack:module-spec orchestrator. The existing spec is the proposal layer; spec-author walks each section, confirming or correcting against the current code."
  <commentary>
  Refresh mode is idempotent — when the existing module-spec is read in as the proposal layer, sections that remain accurate produce a no-op confirmation and the timestamp updates without churning the body.
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
  - "{{TODO-TOOL: RepoMix — packs the module slice (paths from hstack/config.yaml) into a single context bundle for spec-author}}"
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates module-spec frontmatter and MS-01/MS-02/MS-03}}"
---

## Purpose

`hstack-module-spec` produces a baseline `hstack/specs/<module>/spec.md` for one named module by orchestrating the `spec-author` subagent against a packed module slice. It is the one Skill where `spec-author` is permitted to grep the code in service of authorship — the module-spec is the system's anchor between its `area` controlled enum and the actual codebase, and a module-spec disconnected from real paths is worthless.

## When to invoke

Invoke once per critical module after `hstack-init` completes, before any change-spec in that module's `area` can validate. Re-invoke when the 60-day `needs-refresh` cron flags the spec, when the module's shape materially changes (new owned table, new public surface, new dependency), or on demand when the engineer wants a refresh.

## Inputs

- `<module>` (required, positional): the module key as declared in `hstack/config.yaml`'s module-to-area mapping. Must match an existing entry.

## Preconditions

Before any work:

- Verify `hstack/config.yaml` exists at `init-status: complete`. If not, halt and direct the engineer to `hstack-init`.
- Verify the named module exists in the config's module-to-area mapping. If not, halt and ask the engineer to add it via `hstack-configure` first.
- Read the module's declared `paths` globs from config and verify at least one path resolves to existing files. If none resolve, halt — the module-to-paths mapping is stale.
- Check whether `hstack/specs/<module>/spec.md` already exists. If yes and at `status: current`, ask the engineer whether this is a refresh (proceed with the existing spec as the proposal layer) or a re-author (archive the existing spec first).
- Read `hstack/context/glossary.md` and `hstack/context/tech-stack.md` (required by `spec-author`'s session-start protocol).

## Orchestration steps

1. **Pack the module slice.** Run `{{TODO-TOOL: RepoMix}}` over the module's `paths` globs and write the packed bundle to a temporary location. If RepoMix is unavailable, fall back to having `spec-author` grep the paths directly; flag the degraded read in the conversation.

2. **Invoke `spec-author`.** Use the Task tool with `subagent_type: spec-author` and context = [kernel, `hstack/templates/module-spec.md`, glossary, tech-stack, packed module bundle, existing module-spec instance if refresh]. The subagent reads the bundle, walks the seven module-spec sections — Purpose, Public Surface, Data Owned, External Dependencies, Invariants, Known Tech-Debt and ADRs, Refresh Policy — with confirmation gates per field.

3. **Exercise the Invariants challenge prompt.** Per the `spec-author` contract and MS-03, the Invariants section requires a minimum of three bullets, elicited via the challenge "What would a careless refactor in this module break that the tests would not catch?" The Skill does not bypass this even on refresh.

4. **Validate.** After each confirmed field write, the subagent runs `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` against the in-progress file. The Skill verifies MS-01 (paths non-empty and resolve), MS-02 (no overlap with other module-specs' paths — important to surface mis-aligned module-to-paths mapping), MS-03 (Invariants ≥ 3 bullets).

5. **Transition to `status: current`.** When every section is confirmed and the validator passes, `spec-author` advances status from `drafted` to `current` and updates `last-refreshed` to today. Auto-commit fires.

## Outputs

- `hstack/specs/<module>/spec.md` at `status: current`, with frontmatter including the module's `paths` array mirrored from `hstack/config.yaml`.

## Auto-commit triggers

- Status moves from absent to `drafted` after the first section is confirmed (so partial work survives).
- Status moves from `drafted` to `current` when the full spec lands. Commit message: `module-spec(<module>): draft baseline` or `module-spec(<module>): refresh` depending on prior state.

## Idempotency contract

- Re-running on a `current` module-spec without specifying refresh intent: the Skill detects the existing spec and asks the engineer whether to refresh.
- Re-running mid-authoring after a halt: `spec-author` reads the partial file, identifies the first un-confirmed section, and resumes the interview there.
- Re-running on a refresh where the engineer accepts every section unchanged: a no-op diff body with only the `updated` and `last-refreshed` timestamps changing.

## Stop conditions

Beyond the kernel's general stop conditions:

- The module's `paths` globs resolve to zero existing files. Halt; the module-to-paths mapping in config is wrong.
- MS-02 fails — the module's paths overlap with another module's paths. Halt and ask the engineer to reconcile the mapping via `hstack-configure`.
- The Invariants challenge prompt cannot produce three bullets after honest interview. Halt; either the module is too small to merit its own spec (fold into a parent module via `hstack-configure`) or the engineer needs more time to think.
- `spec-author` halts because a referenced glossary term cannot be reconciled. Halt and surface; the engineer either updates the glossary via `hstack-configure --interview glossary` or rephrases.

## Failure modes

- **RepoMix unavailable.** Degraded mode — flag in the conversation, fall back to direct grep, continue.
- **Existing module-spec frontmatter does not match config's paths.** Halt; the engineer reconciles before the refresh can proceed.
- **Validator failure on a partial write.** `spec-author` halts at the field; the Skill surfaces the validator's message and waits.

## Anti-patterns

- Never invent paths. The module's `paths` come from `hstack/config.yaml`; the Skill never edits them and never substitutes.
- Never skip the Invariants challenge. Three-or-more bullets is a hard validator rule, not a heuristic.
- Never run this Skill against a module that does not appear in the config. The right move is to add the module to config first.
- Never overwrite an existing `current` module-spec without explicit refresh-or-re-author confirmation from the engineer.
- Never write code. `spec-author` is the only subagent invoked, and it reads code without modifying it.
