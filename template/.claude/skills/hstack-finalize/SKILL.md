---
name: hstack-finalize
description: Use once a change-spec's branch has merged into the default branch and the change needs closing out — resolve each referenced tech-debt, then advance the change-spec to `shipped`. Post-merge only; run on the default branch.
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
  - "node hstack/scripts/validate-spec.mjs — validates the change-spec and tech-debt status flips and TD-04/TD-05 reciprocity"
---

## Purpose

`hstack-finalize` is the post-merge cleanup Skill. It performs exactly two kinds of state changes, **directly via Skill-level Edit calls in the main session** (per the kernel's Mechanical operations section, ADR-0001):

1. **Advance the change-spec.** `ready-to-ship → shipped`. Always runs on invocation.
2. **Resolve referenced tech-debt.** For each entry in `change-spec.resolves-tech-debt`: write `resolved-by: <change-spec-id>`, append a Resolution Log entry, flip status `in-progress → resolved`. Only runs when `resolves-tech-debt` is non-empty.

The Skill is the only path that flips a tech-debt to `resolved`, mirroring how `/hstack:tech-debt-resolve` is the only path that flips one to `in-progress`. The reciprocal `tech-debt.resolved-by ↔ change-spec.resolves-tech-debt` (TD-04) is enforced by writing both halves atomically within a single auto-commit per tech-debt.

## When to invoke

Invoke once the change's branch (`change/<change-id>`) has been merged into the configured default branch and the engineer is closing out the change. **Run finalize on the default branch itself, not on the (now-merged) change branch.** The Skill writes auto-commits as part of its work; those commits must land on the default branch so the audit trail (change-spec at `shipped`, TDs at `resolved`) is visible to everyone reading `main`. Running on the merged change branch strands the finalize commits — they're committed cleanly but never reach the default branch.

Workflow: merge the PR → `git checkout <default-branch>` → `git pull` → `/hstack:finalize <change-id>` → `git push`. Idempotent: re-running on a change-spec already at `shipped` is a no-op aside from informing the engineer.

## Inputs

- `<change-id>` (required, positional): the change-spec id.

## Preconditions

Before any work:

- **Verify the current branch is the configured default branch and is up-to-date with its remote.** Read the default branch from `hstack/config.yaml` (fallback `main`). Run `git rev-parse --abbrev-ref HEAD` and confirm it equals the default branch. Run `git fetch <remote>` (default `origin`) then `git rev-list --left-right --count <default-branch>...<remote>/<default-branch>` and confirm both sides are `0` (local is neither ahead nor behind remote). If the current branch is not the default branch, halt with: "finalize must run on `<default-branch>`. You're on `<current-branch>`. Run `git checkout <default-branch> && git pull`, then re-invoke." If the local default is behind or ahead of remote, halt with the specific divergence and recommended `git pull` / push action. This precondition is load-bearing: the Skill's auto-commits land on whatever branch is checked out, and stranding them on a merged change branch defeats the audit-trail purpose of finalize.
- Verify `hstack/specs/changes/<change-id>/spec.md` exists. Read `status` and `resolves-tech-debt`.
- Verify `status: ready-to-ship`. If at `ready-for-review` (ship hasn't run yet), halt and direct the engineer to `/hstack:ship` first. If at `shipped` or `archived`, halt as a no-op with the terminal status named.
- **Verify the merge landed.** Run `git log <default-branch> --grep="<change-id>"` and `git log <default-branch> --merges --oneline` and check that the change's branch merge commit exists on the default branch. Multiple verification heuristics are acceptable: (a) a merge commit whose message references the change-id; (b) the change-spec's auto-commit history appearing in the default branch's log via `git log <default-branch> -- hstack/specs/changes/<change-id>/`; (c) the change branch's tip being an ancestor of the default branch's tip (`git merge-base --is-ancestor`). If none of these is true, halt — finalize is post-merge cleanup, never pre-merge.
- For each entry in `resolves-tech-debt`: verify the tech-debt artifact exists, is at `status: in-progress`, and its `resolved-by` field is currently `null`. Any deviation halts. Reconciliation is manual: `git log -- hstack/tech-debt/<td-id>.md` to see the recent state changes; `git checkout HEAD -- hstack/tech-debt/<td-id>.md` to revert if the deviation came from a partial prior finalize; or direct frontmatter edit + a `node hstack/scripts/validate-spec.mjs <path>` rerun if the deviation reflects intentional out-of-band state.
- **Adversarial-review id preflight read.** When `resolves-tech-debt` is non-empty, read `hstack/specs/changes/<change-id>/adversarial-review.md` and capture its frontmatter `id` field. This id is interpolated into each TD's Resolution Log entry (see step 2). If the adversarial-review file is missing, halt — the AR-07 Acceptance-satisfied confirmation that GT-11 already verified would not be locatable from the resulting Resolution Log entry. The captured id is surfaced in the proposed-diff preview alongside the other writes.

## Orchestration steps

0. **Open the phase window (mechanical, no LLM turn, no commit).** The moment the preconditions above pass and *before* any subagent invocation, run `python3 hstack/scripts/telemetry/session_id.py` and keep its `session_id` and `now` values — they become `session_id` and `phase_opened_at` in the sidecar below (ADR-0009). On failure or a null session id, hold `null` for both and continue.

1. **Print the plan.** Summarize what will be written: "Finalize change `<change-id>`: status `ready-to-ship → shipped`. Resolve tech-debt: `[TD-NNNN, TD-MMMM]` (or `none`). Proceed? (Y/n)". Default Yes.

2. **Resolve each referenced tech-debt FIRST (direct write per TD, in order).** Per the kernel's ordering rule for finalize: every TD must be resolved before the change-spec advances to `shipped`. This ensures a mid-finalize failure leaves the change-spec at `ready-to-ship` (recoverable by re-running finalize), never at `shipped` referencing an unresolved TD. For each entry in `resolves-tech-debt`, perform the following:
   - `Edit` `hstack/tech-debt/<td-id>.md`:
     - Defensive log-header check per the kernel: if `## Resolution Log` is absent, append it before writing the entry.
     - Edit frontmatter: `resolved-by: <change-id>`, `status: in-progress → resolved`, `updated: <today>`.
     - Append to the Resolution Log section: `status: in-progress → resolved on <today> by <owner>. Resolving change-spec: <change-id>. Adversarial-review Acceptance-satisfied confirmation: <adversarial-review-id>.`
   - Run `node hstack/scripts/validate-spec.mjs <path>` against the file. TD-04 (resolves-tech-debt ↔ resolved-by) and TD-05 (status:resolved requires resolved-by non-null) must pass. On validation failure, halt — the change-spec remains at `ready-to-ship`, prior TDs in this run have already committed (idempotent on re-run), and the engineer reconciles the failing TD before re-invoking finalize.
   - On validation pass, `git add` and commit with message `tech-debt(<td-id>): resolved (resolved-by: <change-id>)`.
   - Per TD-03, no further field rewrites are permitted after this commit.

3. **Advance the change-spec to `shipped` (direct write, last step).** Only after every entry in `resolves-tech-debt` has been successfully resolved and committed above. Use the `Edit` tool against `hstack/specs/changes/<change-id>/spec.md`:
   - Frontmatter `status: ready-to-ship → shipped`.
   - Frontmatter `updated: <today>`.

   Run `node hstack/scripts/validate-spec.mjs <path>` against the file. On validation pass, `git add` the file and commit with message `change-spec(<change-id>): shipped`.

4. **Validate reciprocity.** Run `node hstack/scripts/validate-spec.mjs <path>` against the change-spec and each affected tech-debt. TD-04 (resolves-tech-debt ↔ resolved-by reciprocity) and TD-05 (status:resolved requires resolved-by non-null) must pass. If either fails, halt and surface — the audit trail is broken. Concrete reconciliation: `git log` the affected files to find the last known-good commit; `git revert <commit>` the bad commit if it landed; or direct frontmatter edit + `validate-spec.mjs` rerun if the corruption is isolated to one field.

5. **Confirm completion.** Print: "Finalized: change-spec at `shipped`, [TD-NNNN, TD-MMMM] at `resolved`. Per TD-03, these tech-debt items are now immutable. The change-spec may later move to `archived` via direct edit when historical pruning is desired."

## Outputs

- `hstack/specs/changes/<change-id>/spec.md` advanced to `status: shipped`.
- For each resolved tech-debt: `hstack/tech-debt/<td-id>.md` at `status: resolved` with `resolved-by` set and a Resolution Log entry appended.
- One commit per artifact transition. Commit messages: `change-spec(<change-id>): shipped` and `tech-debt(<td-id>): resolved (resolved-by: <change-id>)`.

## Auto-commit triggers

- One commit when the change-spec advances to `shipped`.
- One commit per tech-debt resolution. Each commit's body cites the resolving change-spec id for cross-reference.

## Telemetry sidecar

At the change-spec `shipped` commit (the final write in the finalize sequence), write `hstack/specs/changes/<change-id>/.telemetry/finalize.json` in the same `git add && git commit` as the change-spec advance. The sidecar is derivative of git + frontmatter (see `hstack/templates/telemetry-sidecar.md`). Schema:

```json
{
  "schema_version": 2,
  "skill": "hstack-finalize",
  "change_id": "<change-id>",
  "session_id": "<session id from step 0, or null>",
  "phase_opened_at": "<ISO-8601 from step 0, or null>",
  "phase_closed_at": "<ISO-8601, now — same write as this sidecar, or null>",
  "shipped_at": "<ISO-8601, now>",
  "merge_commit_sha": "<full SHA of the merge commit verified in preconditions>",
  "change_duration_days": <int, change-spec.created -> merge author date>,
  "tds_resolved": [<TD ids that were resolved this finalize run>]
}
```

The finalize sidecar is the most valuable of the five — it closes the per-change observability loop and lets `/hstack:telemetry` compute end-to-end change cycle time without walking transcripts. `.telemetry/` is git-ignored. If the sidecar write fails, log and continue; the canonical commit must still land.

The three phase-window fields (`session_id`, `phase_opened_at`, `phase_closed_at`) come from step 0 and from this write. Their rules — best-effort, unmeasured rather than zero, never a halt — are stated once in `hstack/templates/telemetry-sidecar.md` § The phase window, which is the canonical schema and wins over any Skill.

## Session boundary

`finalize` is a natural session cut: the auto-commit above left the change-spec at `shipped` and the resolved tech-debt on disk, so the conversation holds nothing the next phase needs. The cut-notice format, the kickoff-prompt template and the context-block rules are in `KERNEL.md` § Session boundaries; this Skill's two variables are:

```
HSTACK-CUT: finalize complete — cut recommended before the next change.
```

and the next command, `/hstack:help <change-id>`.

## Idempotency contract

Under the TDs-first-then-change-spec ordering, the legitimate resume cases are:

- **Change-spec at `ready-to-ship` with all `resolves-tech-debt` items at `resolved`**: the Skill skips the (already-completed) TD resolutions and advances the change-spec to `shipped`.
- **Change-spec at `ready-to-ship` with some TDs at `resolved` and others at `in-progress`**: the Skill detects per-TD status, skips the resolved ones (no-op on those), and resumes from the first un-resolved TD. Once all TDs are resolved, it advances the change-spec.
- **Change-spec at `shipped`**: clean no-op halt with the terminal status reported. The step-2 ordering makes "`shipped` with a TD still at `in-progress`" unreachable from a normal partial run; if it is observed anyway (manual frontmatter edit, or a run predating this ordering), the Skill halts at the change-spec `shipped` precondition and the engineer reconciles by hand.

## Stop conditions

Beyond the kernel's general stop conditions:

- The current branch is not the configured default branch, or the local default branch is not in sync with its remote. Direct the engineer to `git checkout <default-branch> && git pull` (and `git push` if local is ahead) before re-invoking.
- The change-spec is not at `ready-to-ship`. Direct the engineer to either `/hstack:ship` (if at `ready-for-review`) or surface the existing terminal status.
- The merge cannot be verified via any of the heuristics. Hard halt — finalize is strictly post-merge.
- Any referenced tech-debt is not at `in-progress` or already has a non-null `resolved-by`. Halt; the audit trail is inconsistent.
- The validator fails TD-04 or TD-05 after the writes. Halt and surface — manual reconciliation is required (see step 4's concrete recovery guidance: git revert the bad commit, or direct frontmatter edit + validator rerun). `spec-author` is not a valid recovery path for these reciprocal-write fields per the kernel.

## Failure modes

- **A direct write fails mid-resolution.** Prior TDs in the current run may have already committed; the Skill is idempotent on re-run (already-resolved TDs are detected and skipped), and step 2's ordering guarantees the change-spec is still at `ready-to-ship`. The audit trail records the partial state honestly.
- **Resolved tech-debt was not actually delivered by the merged change.** The adversarial-review's AR-07 Acceptance-satisfied confirmation is the upstream guard. If a tech-debt is flipped to `resolved` but the change did not actually deliver it, that is an adversarial-review failure, not a finalize failure. Surface it as a `wontfix → re-open` is not permitted; the engineer authors a new TD via `/hstack:tech-debt-new`.
- **Default branch detection fails.** The Skill reads `hstack/config.yaml` for the configured default branch; if absent, defaults to `main`. If neither resolves, halt and ask the engineer.

## Merge-strategy caveat

The merge-verification heuristics assume the change branch's auto-commit log lands on the default branch. A squash-merge compresses that history and breaks heuristic (b); a force-merge or rebase-merge can lose it entirely. Configure the repo's merge strategy to preserve history, or re-run finalize after confirming the merge by hand.
