---
name: hstack-branch
description: Use to check out or create the conventional `change/<change-id>` branch for a change-spec — when the branch offer at change-new was declined, or you are on the wrong branch. No argument defaults to the latest in-flight change.
tools:
  - Bash
  - Read
  - Glob
---

## Purpose

`hstack-branch` is the explicit branch-switching Skill. It honors the kernel's branch-hygiene rule: one branch per change-spec, named `change/<change-id>`. It exists for the mid-flow case where the engineer needs to switch branches outside the `/hstack:change-new` offer moment. No subagent invoked; no artifact writes; just `git checkout`.

## When to invoke

Invoke when:
- You declined the branch offer at `/hstack:change-new` earlier and now want to switch.
- You realized you're on the wrong branch several commits into a change.
- You're picking up a teammate's change-spec and need to be on the right branch before implementing.
- `/hstack:help` flagged a branch mismatch and you want to fix it.

## Inputs

- `<change-id>` (optional, positional): the change-spec id whose branch you want to check out. If omitted, the Skill detects the most recently scaffolded in-flight change-spec and proposes its branch.
- `--from <base-branch>` (optional): the branch to create from when the target branch doesn't exist yet. Defaults to `main` (or the configured default).

## Preconditions

Before any work:

- Verify the working directory is a git repository.
- When `<change-id>` is provided: verify `hstack/specs/changes/<change-id>/spec.md` exists. If not, halt — there's nothing to branch for.
- When `<change-id>` is omitted: glob `hstack/specs/changes/*/spec.md`, filter to non-terminal status, sort by `created` descending, take the first. If none exist, halt with "no in-flight change-specs; nothing to branch for."
- Inspect uncommitted work via `git status --short`. If the working tree is dirty AND switching branches would lose context, warn the engineer before proceeding.

## Orchestration steps

1. **Resolve the change-id.** Either the positional argument or the auto-detected most-recent in-flight change. When auto-detected, surface the detection and ask for confirmation before proceeding.

2. **Compute the target branch.** `change/<change-id>`.

3. **Check whether the target branch exists.** Run `git rev-parse --verify --quiet refs/heads/<target>`.
   - Exists → run `git checkout <target>`. Report the switch.
   - Does not exist → run `git checkout -b <target> <base>` where `<base>` is `--from`'s value or the configured default. Report the create-and-switch.

4. **Verify post-switch state.** Run `git branch --show-current` and `git status --short`. Surface the new state to the engineer.

5. **Suggest the next action.** Read the change-spec's `status`. Based on the status, suggest the natural next Skill (e.g., status `ready-to-plan` → "Next: `/hstack:change-plan <id>`"). Same logic as `/hstack:help`'s next-action computation, scoped to this one change.

## Outputs

- A git branch checkout (existing) or create-and-checkout (new). No artifact writes. No commits.

## Auto-commit triggers

None. Branch operations do not create commits.

## Idempotency contract

- Re-running with the same `<change-id>` when already on the target branch: no-op. Report "already on `change/<id>`" and exit cleanly.
- Re-running with a target branch that already exists: plain checkout, no creation.

## Stop conditions

Beyond the kernel's general stop conditions:

- The named `<change-id>` does not correspond to an existing change-spec.
- The working tree has uncommitted changes that would be lost or conflict on switch. Halt and ask: "Uncommitted changes detected — stash, commit, or discard before switching?" (recommend `/hstack:commit` for the commit path; never auto-stash; never auto-discard).
- The engineer requested a `<base-branch>` that does not exist.
- The current branch is already the target branch — exit cleanly with the no-op message.

## Failure modes

- **`git checkout` fails due to conflicting local changes.** Surface the git error; do not retry. The engineer resolves manually.
- **Branch name collision with an unrelated existing branch.** If `change/<change-id>` exists but points at unrelated history (someone created it manually for another purpose), warn the engineer; do not silently overwrite. Engineer renames the unrelated branch or uses `--from` to specify their intent.

## Anti-patterns

- Never use `git checkout -B` (force-create). Use `git checkout -b` (create or fail) and let the engineer resolve collisions.
- Never auto-stash. Stash policy is the engineer's call.
- Never `git checkout -- <files>` or any path-discarding form.
- Never force-delete a branch. Cleanup of obsolete `change/*` branches is post-ship hygiene, not this Skill's domain.
- Never push the new branch automatically. Push is hard-to-reverse; the engineer pushes when ready.
- Never branch from anywhere other than the configured default (typically `main`) unless `--from` is explicit. The kernel's branching convention starts every change from `main`.
