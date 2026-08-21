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
  - "{{TODO-SCRIPT: hstack/scripts/compute-merge-readiness.ts — computes the nine-gate scorecard from artifact frontmatter}}"
---

## Purpose

`hstack-ship` is the final merge-readiness Skill. It reads every artifact's frontmatter for the change, computes the nine-gate scorecard from `hstack-gates.yml`, and generates a PR description body. It does not invoke any subagent and does not write to any artifact — `ship` is read-only across the change-spec, plan, reviews, and verification.

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

1. **Read every change artifact.** Read `spec.md`, `plan.md`, `test-plan.md`, `security-review.md`, `data-review.md` (when surfaces includes db), `ui-brief.md` and `figma-handoff.md` (when surfaces includes ui), `verification.md`, `adversarial-review.md`. Capture each artifact's `status` and key gating fields.

2. **Compute the twelve-gate scorecard.** Run `{{TODO-SCRIPT: hstack/scripts/compute-merge-readiness.ts}}` against the artifact set, or inline the equivalent logic:
   - GT-01: spec presence — change folder exists with non-draft change-spec, or PR carries `trivial: true`.
   - GT-02: diff within scope — every file in the PR diff (against the merge target) is a subset of `change-spec.in-scope`.
   - GT-03: pattern lints — every `hstack/lints/*.yaml` rule passes (the Skill runs `{{TODO-SCRIPT: hstack/scripts/run-gates.sh}}` for this and reads the exit code).
   - GT-04: adversarial-review at `findings-resolved`.
   - GT-05: security-review at `passed` or `concerns-acknowledged`.
   - GT-06: data-review at `passed` or `concerns-acknowledged` (when applicable).
   - GT-07: ui-brief at `drafted` and figma-handoff at `ready` (when applicable).
   - GT-08: `user-stories` non-empty UNLESS `internal-tooling: true` (Category A) UNLESS `enables` non-empty (Category B). The audit-chain assumption: a Category-B spec's user value lives in one of the change-specs named in `enables`; this gate does not transitively verify that downstream spec has `user-stories` non-empty — that's the downstream's GT-08 check, run at its own ship time.
   - GT-09: every cross-reference rule (CG-01..CG-04) passes.
   - GT-10: test-plan at `passed` or `concerns-acknowledged`, and `verification.test-plan-coverage` shows no missing tenant-isolation tests and no out-of-budget performance assertions.
   - GT-11: When `change-spec.resolves-tech-debt` is non-empty: (a) every referenced tech-debt must exist and be at `status: in-progress` with `resolution-attempted-at` set; (b) the adversarial-review must contain the AR-07 Acceptance-satisfied confirmation enumerating each TD's Acceptance bullets against the diff; (c) no referenced tech-debt may have a non-null `resolved-by` already (that would indicate a double-resolution attempt). When `resolves-tech-debt` is empty, GT-11 is `not-applicable`.
   - GT-12 (SP-13 mutual exclusion): `internal-tooling: true` AND `enables` non-empty is forbidden. Hard FAIL. Reciprocity (SP-14): for every id in `enables`, the named downstream spec must exist on disk and must list this change-id in its `enabled-by` array. Missing downstream specs are a FAIL (forward references are only legal at authoring time — by ship time, the downstream must be scaffolded so reciprocity holds). The reverse direction (`enabled-by` entries that point at non-existent or non-listing upstream specs) is also FAIL.

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

- A required artifact is missing on disk.
- Any artifact's frontmatter cannot be parsed.
- GT-02 (diff within scope) fails — this is a hard halt with a clear message naming the out-of-scope files; the engineer either reshapes the change-spec via `spec-author` or splits via the multi-module pattern.

## Failure modes

- **Trivial PRs.** When the change-spec carries `trivial: true`, several gates are skipped per the kernel. The Skill still computes the diff-within-scope and pattern-lint gates (GT-02 and GT-03 remain mandatory even for trivial PRs).
- **Parent-change (multi-module) records.** When the change-spec is a coordination record (`children` non-empty), the Skill computes scorecards for every child and produces a parent-level summary. The parent reaches ready-to-ship only when every child does.
- **Pattern-lint failure.** Surface the failing rule and the offending lines. The fix is via a new `hstack-implement` invocation against an appropriate phase (or a scope amendment if the lint surfaced new in-scope needs).
