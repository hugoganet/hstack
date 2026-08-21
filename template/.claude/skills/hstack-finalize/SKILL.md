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
- For each entry in `resolves-tech-debt`: verify the tech-debt artifact exists, is at `status: in-progress`, and its `resolved-by` field is currently `null`. Any deviation halts. Reconciliation is manual: `git log -- hstack/tech-debt/<td-id>.md` to see the recent state changes; `git checkout HEAD -- hstack/tech-debt/<td-id>.md` to revert if the deviation came from a partial prior finalize; or direct frontmatter edit + a `node hstack/scripts/validate-spec.mjs <path>` rerun if the deviation reflects intentional out-of-band state. Do not invoke `spec-author` — the kernel forbids it for status flips and reciprocal back-reference writes.
- **Adversarial-review id preflight read.** When `resolves-tech-debt` is non-empty, read `hstack/specs/changes/<change-id>/adversarial-review.md` and capture its frontmatter `id` field. This id is interpolated into each TD's Resolution Log entry (see step 2). If the adversarial-review file is missing, halt — the AR-07 Acceptance-satisfied confirmation that GT-11 already verified would not be locatable from the resulting Resolution Log entry. The captured id is surfaced in the proposed-diff preview alongside the other writes.

## Orchestration steps

0. **Open the phase window (mechanical, no LLM turn, no commit).** The moment the preconditions above pass and *before* any subagent invocation, run `python3 hstack/scripts/telemetry/session_id.py` and keep its `session_id` and `now` values for the telemetry sidecar below — they become `session_id` and `phase_opened_at` (ADR-0009). The script is read-only, takes milliseconds, and never halts. If it fails to run, or reports `"session_id": null`, hold `null` for both and continue: the phase then reports as *unmeasured*, never as zero. Measurement never gates the workflow.

1. **Print the plan.** Summarize what will be written: "Finalize change `<change-id>`: status `ready-to-ship → shipped`. Resolve tech-debt: `[TD-NNNN, TD-MMMM]` (or `none`). Proceed? (Y/n)". Default Yes.

2. **Resolve each referenced tech-debt FIRST (direct write per TD, in order).** Per the kernel's ordering rule for finalize: every TD must be resolved before the change-spec advances to `shipped`. This ensures a mid-finalize failure leaves the change-spec at `ready-to-ship` (recoverable by re-running finalize), never at `shipped` referencing an unresolved TD. For each entry in `resolves-tech-debt`, perform the following:
   - `Edit` `hstack/tech-debt/<td-id>.md`:
     - **Defensive Resolution Log check.** If `## Resolution Log` is not present in the file (legacy TDs), append `\n## Resolution Log\n` to the end of the file first.
     - Edit frontmatter: `resolved-by: <change-id>`, `status: in-progress → resolved`, `updated: <today>`.
     - Append to the Resolution Log section: `status: in-progress → resolved on <today> by <owner>. Resolving change-spec: <change-id>. Adversarial-review Acceptance-satisfied confirmation: <adversarial-review-id>.`
   - Run `node hstack/scripts/validate-spec.mjs <path>` against the file. TD-04 (resolves-tech-debt ↔ resolved-by) and TD-05 (status:resolved requires resolved-by non-null) must pass. On validation failure, halt — the change-spec remains at `ready-to-ship`, prior TDs in this run have already committed (idempotent on re-run), and the engineer reconciles the failing TD before re-invoking finalize.
   - On validation pass, `git add` and commit with message `tech-debt(<td-id>): resolved (resolved-by: <change-id>)`.
   - Per TD-03, no further field rewrites are permitted after this commit.

3. **Advance the change-spec to `shipped` (direct write, last step).** Only after every entry in `resolves-tech-debt` has been successfully resolved and committed above. Use the `Edit` tool against `hstack/specs/changes/<change-id>/spec.md`:
   - Frontmatter `status: ready-to-ship → shipped`.
   - Frontmatter `updated: <today>`.

   Run `node hstack/scripts/validate-spec.mjs <path>` against the file. On validation pass, `git add` the file and commit with message `change-spec(<change-id>): shipped`. Do not invoke `spec-author` — this is a mechanical write per the kernel.

4. **Validate reciprocity.** Run `node hstack/scripts/validate-spec.mjs <path>` against the change-spec and each affected tech-debt. TD-04 (resolves-tech-debt ↔ resolved-by reciprocity) and TD-05 (status:resolved requires resolved-by non-null) must pass. If either fails, halt and surface — the audit trail is broken. Concrete reconciliation: `git log` the affected files to find the last known-good commit; `git revert <commit>` the bad commit if it landed; or direct frontmatter edit + `validate-spec.mjs` rerun if the corruption is isolated to one field. Do not invoke `spec-author` — the kernel forbids it for reciprocal back-reference writes.

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

`session_id` and `phase_opened_at` are the values captured in step 0; `phase_closed_at` is stamped now, in this same write. The three fields bound the phase so `hstack/scripts/telemetry/parsers/transcripts.py:phase_usage` can sum the transcript's assistant-turn usage between them — TE-4 (cost per phase) and TE-5 (cost per change) in the telemetry report. Any of the three `null`, unparseable, or inverted makes this phase *unmeasured*; it is never counted as zero. A failed resolution is logged and the canonical commit still lands. `hstack/templates/telemetry-sidecar.md` is the canonical schema — when a Skill and that document disagree, that document wins.

## Session boundary

`finalize` is a natural session cut. The auto-commit above has already written the
durable state to disk — `the change-spec at shipped and the resolved tech-debt` carries everything the next phase loads at session
start, so the conversation itself holds nothing downstream needs. Long contexts
degrade model performance well before the window limit, so cutting here costs
nothing and buys accuracy back.

At terminal state, emit a cut notice followed by a ready-to-paste kickoff prompt.
The kickoff prompt is the handoff mechanism: the engineer carries it into a fresh
session, so no hook, no cursor and no on-disk state is needed to route it. Format:

```
HSTACK-CUT: finalize complete — cut recommended before the next change.

Paste into a fresh session:
────────────────────────────────────────────────
/hstack:help <change-id>

Context from the previous session (not in any artifact):
- <what was decided that no artifact records>
- open: <question raised and unresolved, with the artifact that is silent on it>
- ruled out: <approach rejected, and why, with the artifact reference>
────────────────────────────────────────────────
```

Rules for the context block: only facts that no artifact already carries — never
restate the spec, the plan, or the phase output, which the next Skill loads from
disk anyway. Three bullets maximum. If nothing qualifies, print the command line
alone and say so; an empty context block is the correct output for a clean phase,
not a failure to fill it in.

Never cut mid-phase. A phase in flight has no committed state, and a summary
produced mid-reasoning loses the chain it was built on. The boundary is the
commit, not the context pressure.

## Idempotency contract

Under the TDs-first-then-change-spec ordering, the legitimate resume cases are:

- **Change-spec at `ready-to-ship` with all `resolves-tech-debt` items at `resolved`**: the Skill skips the (already-completed) TD resolutions and advances the change-spec to `shipped`.
- **Change-spec at `ready-to-ship` with some TDs at `resolved` and others at `in-progress`**: the Skill detects per-TD status, skips the resolved ones (no-op on those), and resumes from the first un-resolved TD. Once all TDs are resolved, it advances the change-spec.
- **Change-spec at `shipped`**: clean no-op halt with the terminal status reported. By construction this state cannot coexist with any TD at `in-progress` (the ordering rule guarantees TDs finish first), so no resume work is needed.

The state "change-spec at `shipped` with a TD still at `in-progress`" is not reachable from a normal partial run under the new ordering. If observed (e.g., manual frontmatter edit, prior-run before this ADR landed), the Skill halts at the change-spec `shipped` precondition and the engineer reconciles via manual investigation.

## Stop conditions

Beyond the kernel's general stop conditions:

- The current branch is not the configured default branch, or the local default branch is not in sync with its remote. Direct the engineer to `git checkout <default-branch> && git pull` (and `git push` if local is ahead) before re-invoking.
- The change-spec is not at `ready-to-ship`. Direct the engineer to either `/hstack:ship` (if at `ready-for-review`) or surface the existing terminal status.
- The merge cannot be verified via any of the heuristics. Hard halt — finalize is strictly post-merge.
- Any referenced tech-debt is not at `in-progress` or already has a non-null `resolved-by`. Halt; the audit trail is inconsistent.
- The validator fails TD-04 or TD-05 after the writes. Halt and surface — manual reconciliation is required (see step 4's concrete recovery guidance: git revert the bad commit, or direct frontmatter edit + validator rerun). `spec-author` is not a valid recovery path for these reciprocal-write fields per the kernel.

## Failure modes

- **A direct write fails mid-resolution.** Because TDs are resolved BEFORE the change-spec advances to `shipped`, a mid-finalize failure leaves the change-spec at `ready-to-ship` — never at `shipped` referencing an unresolved TD. Prior TDs in the current run may have already committed; the Skill is idempotent on re-run (already-resolved TDs are detected and skipped). The audit trail records the partial state honestly.
- **Resolved tech-debt was not actually delivered by the merged change.** The adversarial-review's AR-07 Acceptance-satisfied confirmation is the upstream guard. If a tech-debt is flipped to `resolved` but the change did not actually deliver it, that is an adversarial-review failure, not a finalize failure. Surface it as a `wontfix → re-open` is not permitted; the engineer authors a new TD via `/hstack:tech-debt-new`.
- **Default branch detection fails.** The Skill reads `hstack/config.yaml` for the configured default branch; if absent, defaults to `main`. If neither resolves, halt and ask the engineer.

## Anti-patterns

- Never flip a tech-debt to `resolved` without an accompanying change-spec at `shipped` whose `resolves-tech-debt` references it. The reciprocal-write pair is the only legal path.
- Never run finalize pre-merge. The merge-verification check is mandatory.
- Never run finalize on the (now-merged) change branch. The Skill's auto-commits land on the current branch; running on a merged change branch strands the `shipped` and `resolved` commits where the default branch never sees them. The default-branch precondition enforces this.
- Never overwrite a non-null `resolved-by` field. Per TD-03, a resolved tech-debt is immutable.
- Never invoke `spec-author` for these writes. They are mechanical operations per the kernel's Mechanical operations section; the Skill performs them directly via the `Edit` tool. Invoking `spec-author` costs ~25k tokens per call for what is a handful of frontmatter character changes.
- Never skip TD-04/TD-05 post-write validation. The reciprocity check is the v1 substitute for the v2 substrate's mechanical cross-graph validator.
- Never accept a force-merge or rebase-merge that loses the change branch's auto-commit history. The merge-verification heuristics assume the auto-commit log lands on the default branch; squash-merges that compress the history break heuristic (b). The engineer should configure merge strategy to preserve history, or the Skill should be re-run after manual confirmation.
