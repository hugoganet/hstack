---
name: hstack-finalize
description: |
  Use this skill once a change-spec's branch has been merged into the configured default branch. The Skill is the post-merge cleanup step: it verifies the merge actually landed, then invokes `spec-author` to (a) advance the change-spec `ready-to-ship → shipped`, (b) for each entry in `change-spec.resolves-tech-debt`, write `resolved-by: <change-spec-id>`, append a Resolution Log entry, and flip the tech-debt `in-progress → resolved`. Per TD-03, no further field rewrites are permitted on the tech-debt afterwards. Examples:

  <example>
  Context: The billing-overage-warning change just merged. Its change-spec has `resolves-tech-debt: [TD-0042-overage-banner-tailwind-class]`.
  user: "/hstack:finalize 2026-05-billing-overage-warning"
  assistant: "I'll verify the change branch merged to main, then invoke spec-author to advance the change-spec to shipped and flip TD-0042 to resolved with resolved-by set. Per TD-03, TD-0042 becomes immutable after this point."
  <commentary>
  Finalize is the only Skill that flips a tech-debt to `resolved` (mirroring how `/hstack:tech-debt-resolve` is the only Skill that flips one to `in-progress`). The reciprocal write of `resolved-by` lands atomically with the status flip via spec-author, preserving TD-04 reciprocity.
  </commentary>
  </example>

  <example>
  Context: An engineer runs finalize on a change whose branch has not actually merged yet.
  user: "/hstack:finalize 2026-06-knowledge-citations"
  assistant: "I'll halt — `change/2026-06-knowledge-citations` has not been merged into main per git log. Finalize is post-merge cleanup; running it pre-merge would mark a tech-debt resolved that's not yet deployed. Open or complete the PR first."
  <commentary>
  The merge-verification check is load-bearing. Marking a tech-debt `resolved` based on intent rather than landed code is exactly the audit-trail corruption the workflow is built to prevent.
  </commentary>
  </example>

  <example>
  Context: A change-spec with empty `resolves-tech-debt` is finalized after merge.
  user: "/hstack:finalize 2026-05-typo-fix"
  assistant: "I'll advance the change-spec to shipped. No tech-debt to resolve. Single auto-commit."
  <commentary>
  Finalize works on every merged change, not just those that resolve tech-debt. The change-spec → shipped transition is always written here; the tech-debt flips are conditional on `resolves-tech-debt`.
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
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates the change-spec and tech-debt status flips and TD-04/TD-05 reciprocity}}"
---

## Purpose

`hstack-finalize` is the post-merge cleanup Skill. It performs exactly two kinds of state changes, both via `spec-author`:

1. **Advance the change-spec.** `ready-to-ship → shipped`. Always runs on invocation.
2. **Resolve referenced tech-debt.** For each entry in `change-spec.resolves-tech-debt`: write `resolved-by: <change-spec-id>`, append a Resolution Log entry, flip status `in-progress → resolved`. Only runs when `resolves-tech-debt` is non-empty.

The Skill is the only path that flips a tech-debt to `resolved`, mirroring how `/hstack:tech-debt-resolve` is the only path that flips one to `in-progress`. The reciprocal `tech-debt.resolved-by ↔ change-spec.resolves-tech-debt` (TD-04) is enforced by writing both halves atomically through spec-author.

## When to invoke

Invoke once the change's branch (`change/<change-id>`) has been merged into the configured default branch and the engineer is closing out the change. Idempotent: re-running on a change-spec already at `shipped` is a no-op aside from informing the engineer.

## Inputs

- `<change-id>` (required, positional): the change-spec id.

## Preconditions

Before any work:

- Verify `hstack/specs/changes/<change-id>/spec.md` exists. Read `status` and `resolves-tech-debt`.
- Verify `status: ready-to-ship`. If at `ready-for-review` (ship hasn't run yet), halt and direct the engineer to `/hstack:ship` first. If at `shipped` or `archived`, halt as a no-op with the terminal status named.
- **Verify the merge landed.** Run `git log <default-branch> --grep="<change-id>"` and `git log <default-branch> --merges --oneline` and check that the change's branch merge commit exists on the default branch. Multiple verification heuristics are acceptable: (a) a merge commit whose message references the change-id; (b) the change-spec's auto-commit history appearing in the default branch's log via `git log <default-branch> -- hstack/specs/changes/<change-id>/`; (c) the change branch's tip being an ancestor of the default branch's tip (`git merge-base --is-ancestor`). If none of these is true, halt — finalize is post-merge cleanup, never pre-merge.
- For each entry in `resolves-tech-debt`: verify the tech-debt artifact exists, is at `status: in-progress`, and its `resolved-by` field is currently `null`. Any deviation halts; the engineer reconciles via `spec-author`.

## Orchestration steps

1. **Print the plan.** Summarize what will be written: "Finalize change `<change-id>`: status `ready-to-ship → shipped`. Resolve tech-debt: `[TD-NNNN, TD-MMMM]` (or `none`). Proceed? (Y/n)". Default Yes.

2. **Invoke `spec-author` for the change-spec flip.** Use the Task tool with `subagent_type: spec-author` and instructions: flip `hstack/specs/changes/<change-id>/spec.md` `status: ready-to-ship → shipped`. Update `updated` to today. Auto-commit at the status transition per the kernel.

3. **Invoke `spec-author` for each tech-debt resolution.** For each entry in `resolves-tech-debt`:
   - Read `hstack/tech-debt/<td-id>.md`.
   - Write `resolved-by: <change-id>`.
   - Append a Resolution Log entry: `status: in-progress → resolved on <today> by <owner>. Resolving change-spec: <change-id>. Adversarial-review Acceptance-satisfied confirmation: <adversarial-review-id>.`
   - Flip `status: in-progress → resolved`.
   - Update `updated` to today.
   - Per TD-03, no further field rewrites permitted after this commit.

   These three writes per TD land in a single auto-commit. Multiple TDs land in separate commits (one per TD) for cleaner audit trail.

4. **Validate reciprocity.** Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` against the change-spec and each affected tech-debt. TD-04 (resolves-tech-debt ↔ resolved-by reciprocity) and TD-05 (status:resolved requires resolved-by non-null) must pass. If either fails, halt and surface — the audit trail is broken and manual reconciliation is required.

5. **Confirm completion.** Print: "Finalized: change-spec at `shipped`, [TD-NNNN, TD-MMMM] at `resolved`. Per TD-03, these tech-debt items are now immutable. The change-spec may later move to `archived` via direct edit when historical pruning is desired."

## Outputs

- `hstack/specs/changes/<change-id>/spec.md` advanced to `status: shipped`.
- For each resolved tech-debt: `hstack/tech-debt/<td-id>.md` at `status: resolved` with `resolved-by` set and a Resolution Log entry appended.
- One commit per artifact transition. Commit messages: `change-spec(<change-id>): shipped` and `tech-debt(<td-id>): resolved (resolved-by: <change-id>)`.

## Auto-commit triggers

- One commit when the change-spec advances to `shipped`.
- One commit per tech-debt resolution. Each commit's body cites the resolving change-spec id for cross-reference.

## Idempotency contract

- Re-running on a change-spec already at `shipped`: the Skill reads the existing state and produces a no-op aside from informing the engineer. If `resolves-tech-debt` items are still at `in-progress` (an inconsistent state from a partial prior run), the Skill resumes by flipping only those.
- Re-running mid-flip after a halt: the Skill detects which transitions have already landed by reading current artifact statuses, and writes only the missing ones.

## Stop conditions

Beyond the kernel's general stop conditions:

- The change-spec is not at `ready-to-ship`. Direct the engineer to either `/hstack:ship` (if at `ready-for-review`) or surface the existing terminal status.
- The merge cannot be verified via any of the heuristics. Hard halt — finalize is strictly post-merge.
- Any referenced tech-debt is not at `in-progress` or already has a non-null `resolved-by`. Halt; the audit trail is inconsistent.
- The validator fails TD-04 or TD-05 after the writes. Halt and surface — manual reconciliation via spec-author is required.

## Failure modes

- **Spec-author write fails mid-resolution.** The change-spec flip and each tech-debt resolution land as independent commits. If the change-spec flip lands but a subsequent tech-debt resolution fails, the change-spec is at `shipped` but a TD remains at `in-progress`. Re-running the Skill resumes from the failed TD. The audit trail records the partial state honestly.
- **Resolved tech-debt was not actually delivered by the merged change.** The adversarial-review's AR-07 Acceptance-satisfied confirmation is the upstream guard. If a tech-debt is flipped to `resolved` but the change did not actually deliver it, that is an adversarial-review failure, not a finalize failure. Surface it as a `wontfix → re-open` is not permitted; the engineer authors a new TD via `/hstack:tech-debt-new`.
- **Default branch detection fails.** The Skill reads `hstack/config.yaml` for the configured default branch; if absent, defaults to `main`. If neither resolves, halt and ask the engineer.

## Anti-patterns

- Never flip a tech-debt to `resolved` without an accompanying change-spec at `shipped` whose `resolves-tech-debt` references it. The reciprocal write via spec-author is the only legal path.
- Never run finalize pre-merge. The merge-verification check is mandatory.
- Never overwrite a non-null `resolved-by` field. Per TD-03, a resolved tech-debt is immutable.
- Never invoke spec-author for any write outside the three documented transitions (change-spec to shipped; tech-debt to resolved with resolved-by; Resolution Log appends).
- Never skip TD-04/TD-05 post-write validation. The reciprocity check is the v1 substitute for the v2 substrate's mechanical cross-graph validator.
- Never accept a force-merge or rebase-merge that loses the change branch's auto-commit history. The merge-verification heuristics assume the auto-commit log lands on the default branch; squash-merges that compress the history break heuristic (b). The engineer should configure merge strategy to preserve history, or the Skill should be re-run after manual confirmation.
