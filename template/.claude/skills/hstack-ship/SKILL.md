---
name: hstack-ship
description: Use when every artifact for a change is at terminal status and the change needs its merge-readiness scorecard and a generated PR body. Read-only — it does not merge, and post-merge cleanup is `/hstack:finalize`.
tools:
  - Read
  - Write
  - Grep
  - Glob
  - Bash
  - "node hstack/scripts/validate-spec.mjs — validates every artifact's frontmatter"
  - "node hstack/scripts/compute-merge-readiness.mjs — computes the twelve-gate scorecard from frontmatter and git"
  - "hstack/scripts/run-gates.sh — runs the pattern lints GT-03 reads the exit code of"
---

## Purpose

`hstack-ship` is the final merge-readiness Skill. It runs the twelve-gate merge-readiness scorecard over the change's artifacts and the PR diff, and generates a PR description body. It does not invoke any subagent and does not write to any artifact — `ship` is read-only across the change-spec, plan, reviews, and verification.

## When to invoke

Invoke when every per-change artifact is at terminal status and the engineer is ready to open or mark the PR ready-for-review. May be invoked multiple times — the Skill is idempotent and is often used as a "what's left?" diagnostic before the final pass.

## Inputs

- `<change-id>` (required, positional): the change-spec id.

## Preconditions

Before any work:

- Verify the change folder `hstack/specs/changes/<change-id>/` exists.
- Verify the change-spec exists. Read its `surfaces`, `internal-tooling`, `enables`, `enabled-by`, `trivial` flags to know which conditional gates apply.

The Skill does not pre-halt on artifact non-terminal status — that is what the scorecard reports. It halts only on missing artifacts or unreadable frontmatter.

## Orchestration steps

1. **Run the pattern lints.** `hstack/scripts/run-gates.sh --change <change-id> --suite lint` when `hstack/lints/` carries rule files. Keep the exit code — GT-03 is computed from it and from nothing else.

2. **Compute the twelve-gate scorecard.** Run `node hstack/scripts/compute-merge-readiness.mjs <change-id> --json [--gates-exit <code from step 1>]`. The script reads every artifact's frontmatter, the diff against the merge target, and the git branch, and returns one verdict per gate — `pass`, `fail`, `unknown`, `not-applicable` or `deferred`. `fail` and `unknown` block; "not evaluated" is not "passed".

   Do not re-derive any gate in prose. The gates below are the **contract** — what each gate means, one line each — and `compute-merge-readiness.mjs` is the **only** place they are computed. `--gates` prints the same registry from the script itself.

   | Gate | Contract |
   | --- | --- |
   | GT-01 | Spec presence: change folder exists with a change-spec past `draft`, or the change carries `trivial: true`. |
   | GT-02 | Diff within scope: every changed file is a subset of `change-spec.in-scope`, plus hstack's own artifact trail. Mandatory even for `trivial: true`. |
   | GT-03 | Pattern lints: every `hstack/lints/*.yaml` rule passes, read from `run-gates.sh`'s exit code. |
   | GT-04 | `adversarial-review.md` at `findings-resolved`. |
   | GT-05 | `security-review.md` at `passed` or `concerns-acknowledged`. |
   | GT-06 | `data-review.md` at `passed` or `concerns-acknowledged`, when `surfaces` includes `db`. |
   | GT-07 | `ui-brief.md` at `drafted` and `figma-handoff.md` at `ready`, when `surfaces` includes `ui`. |
   | GT-08 | `user-stories` non-empty, unless exactly one carve-out is declared: `internal-tooling: true` (A), non-empty `enables` (B), `area: bootstrap` (C). Category B is an audit chain, not a transitive check — the downstream spec's user value is the downstream's own GT-08. |
   | GT-09 | Every cross-reference rule CG-01..CG-04 passes. **Deferred**: the range is named but the four rules are stated nowhere, so the script reports `deferred` with that reason rather than inventing them. |
   | GT-10 | `test-plan.md` at `passed` or `concerns-acknowledged`, and `verification.test-plan-coverage` shows no missing tenant-isolation tests and no out-of-budget performance assertions. |
   | GT-11 | When `resolves-tech-debt` is non-empty: every referenced tech-debt exists at `status: in-progress` with `resolution-attempted-at` set, none already carries a `resolved-by`, and the adversarial-review carries its AR-07 Acceptance-satisfied confirmation. `not-applicable` when the array is empty. |
   | GT-12 | SP-13 mutual exclusion (`internal-tooling: true` **and** non-empty `enables` is a hard FAIL) plus SP-14 reciprocity in both directions — a dangling `enables` or a non-reciprocating `enabled-by` is a FAIL, because by ship time the downstream must be scaffolded. |

   Eleven of the twelve are computed from frontmatter, the diff and the branch alone — no artifact body is read (kernel § Reading artifacts). GT-11's AR-07 half is the single exception, and the script reads that one subsection rather than that file.

3. **Frontmatter validation.** Run `node hstack/scripts/validate-spec.mjs` across every artifact. Any FM-* or per-type validation failure blocks ship.

4. **Generate the PR description body.** Write `hstack/specs/changes/<change-id>/pr-body.md` containing:
   - Title: the change-spec's `Problem` first sentence, prefixed with the change id.
   - Summary section: pull the Target Behavior bullets from the change-spec.
   - Surfaces touched: from frontmatter.
   - Linked artifacts: pointers to spec, plan, test-plan, reviews, verification, adversarial-review.
   - Tech-debt created: pointers from `change-spec.creates-tech-debt`.
   - Test plan: pulled from `test-plan.md` — pyramid summary, tenant-isolation tests, and performance budgets — cross-referenced with `verification.test-plan-coverage` to show observed-vs-promised.
   - Tech-debt resolved: pointers from `change-spec.resolves-tech-debt` with each TD's Title and Acceptance summary. When non-empty, the body explicitly notes that `/hstack:finalize <change-id>` must be run post-merge to flip each TD to `resolved`.
   - Scorecard summary: the twelve-gate table from step 2.

   The pr-body.md is for the engineer to copy into the actual PR description — the Skill does not call `gh pr create` or otherwise open the PR.

5. **Advance change-spec status.** When every gate passes, the Skill emits the recommended status transition: `ready-for-review` → `ready-to-ship`. The Skill does not write this transition itself — the engineer either confirms (in which case the engineer can advance via direct edit, or `spec-author` is invoked separately) or addresses any remaining issues. This separation preserves the kernel's rule that humans confirm status transitions to ship-readiness.

6. **Surface finalize handoff.** When every gate passes AND `change-spec.resolves-tech-debt` is non-empty, the Skill emits a clear directive: "After this PR merges, run `/hstack:finalize <change-id>` to advance the change-spec to `shipped` and flip [TD-NNNN, TD-MMMM] to `resolved` with `resolved-by` set." When `resolves-tech-debt` is empty, the Skill still notes: "After merge, run `/hstack:finalize <change-id>` to advance the change-spec to `shipped`." The finalize handoff is informational at ship time — the actual writes happen in `/hstack:finalize`, never here.

## Outputs

- `hstack/specs/changes/<change-id>/pr-body.md` (new or updated) — the PR description body.
- A scorecard printed to the conversation: per-gate pass/fail summary with the failing artifact and field named for any FAIL.
- A recommended next action: either "open / mark the PR ready-for-review and advance status to `ready-to-ship`" or a list of failing gates.

The Skill does not auto-commit any artifact status transitions. `pr-body.md` is committed when written.

## Auto-commit triggers

- One commit when `pr-body.md` is written or updated. Commit message: `ship(<change-id>): pr-body`.

## Session boundary

`ship` is a natural session cut: the auto-commit above left `pr-body.md` and the scorecard on disk, so the conversation holds nothing the next phase needs. The cut-notice format, the kickoff-prompt template and the context-block rules are in `KERNEL.md` § Session boundaries; this Skill's two variables are:

```
HSTACK-CUT: ship complete — cut recommended before the merge, then finalize.
```

and the next command, `/hstack:finalize <change-id>`.

## Idempotency contract

- Re-running on the same change: re-reads every artifact and recomputes the scorecard. `pr-body.md` is rewritten if any artifact has changed since the prior run; otherwise a no-op. When the existing `pr-body.md` carries engineer edits beyond the generated template, surface a diff and ask before rewriting — never silently overwrite hand-written PR prose.
- Re-running after fixing a failing gate: the scorecard reports the new state.

## Stop conditions

Beyond the kernel's general stop conditions:

- The change folder or the change-spec is missing on disk, or any artifact's frontmatter cannot be parsed. Both exit `compute-merge-readiness.mjs` with code 2 and a named cause — surface it verbatim rather than scoring a partial set.
- GT-02 (diff within scope) fails — this is a hard halt with a clear message naming the out-of-scope files; the engineer either reshapes the change-spec via `spec-author` or splits via the multi-module pattern.
- GT-02 reports `unknown` because HEAD is the merge target. There is no PR diff to score from the default branch; check out `change/<change-id>` (`/hstack:branch <change-id>`) and re-run.

## Failure modes

- **Trivial PRs.** When the change-spec carries `trivial: true`, several gates are skipped per the kernel. The Skill still computes the diff-within-scope and pattern-lint gates (GT-02 and GT-03 remain mandatory even for trivial PRs).
- **Parent-change (multi-module) records.** When the change-spec is a coordination record (`children` non-empty), run the script once per child id and produce a parent-level summary. The parent reaches ready-to-ship only when every child does.
- **Pattern-lint failure.** Surface the failing rule and the offending lines from the captured output. The fix is via a new `hstack-implement` invocation against an appropriate phase (or a scope amendment if the lint surfaced new in-scope needs).
- **A gate reports `unknown`.** Something could not be evaluated — git is unavailable, the merge target does not resolve, or the lint runner was not run. `unknown` blocks exactly like `fail`: report what was not evaluated and why, and do not present the change as ready.
