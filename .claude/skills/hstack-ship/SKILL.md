---
name: hstack-ship
description: |
  Use this skill when every artifact for a change is at terminal status and the engineer wants the final merge-readiness scorecard and a generated PR description. The Skill is the merge gate's prelude — it checks that every CI gate's preconditions are met, computes the scorecard, and produces the PR description body. It does not perform the merge; the engineer opens or marks the PR ready-for-review themselves. Examples:

  <example>
  Context: Every artifact for the billing-overage change is at terminal status and the engineer wants to open the PR.
  user: "/hstack:ship 2026-05-billing-overage-warning"
  assistant: "I'll compute the scorecard: spec at ready-to-ship, test-plan passed, plan completed, security-review passed, ui-brief drafted, figma-handoff ready, data-review passed, verification passed, adversarial-review findings-resolved. PR description will land in hstack/specs/changes/<id>/pr-body.md for you to paste."
  <commentary>
  The Skill is mechanical — it reads frontmatter and computes the gate result. No subagent is invoked. If any gate fails, the Skill names the failing artifact and halts.
  </commentary>
  </example>

  <example>
  Context: The engineer tries to ship a change whose adversarial-review is still at findings-open.
  user: "/hstack:ship 2026-06-knowledge-citations"
  assistant: "I'll halt — adversarial-review is at findings-open. Three findings still at status: open with no resolution. Resolve those via the existing adversarial-review.md before re-running ship."
  <commentary>
  The Skill names the exact blocker and the exact remediation path. It does not advance any status itself; ship is read-only across the artifact set.
  </commentary>
  </example>
tools:
  - Read
  - Write
  - Grep
  - Glob
  - Bash
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates every artifact's frontmatter}}"
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
- Verify the change-spec exists. Read its `surfaces`, `internal-tooling`, `trivial` flags to know which conditional gates apply.

The Skill does not pre-halt on artifact non-terminal status — that is what the scorecard reports. It halts only on missing artifacts or unreadable frontmatter.

## Orchestration steps

1. **Read every change artifact.** Read `spec.md`, `plan.md`, `test-plan.md`, `security-review.md`, `data-review.md` (when surfaces includes db), `ui-brief.md` and `figma-handoff.md` (when surfaces includes ui), `verification.md`, `adversarial-review.md`. Capture each artifact's `status` and key gating fields.

2. **Compute the ten-gate scorecard.** Run `{{TODO-SCRIPT: hstack/scripts/compute-merge-readiness.ts}}` against the artifact set, or inline the equivalent logic:
   - GT-01: spec presence — change folder exists with non-draft change-spec, or PR carries `trivial: true`.
   - GT-02: diff within scope — every file in the PR diff (against the merge target) is a subset of `change-spec.in-scope`.
   - GT-03: pattern lints — every `hstack/lints/*.yaml` rule passes (the Skill runs `{{TODO-SCRIPT: hstack/scripts/run-gates.sh}}` for this and reads the exit code).
   - GT-04: adversarial-review at `findings-resolved`.
   - GT-05: security-review at `passed` or `concerns-acknowledged`.
   - GT-06: data-review at `passed` or `concerns-acknowledged` (when applicable).
   - GT-07: ui-brief at `drafted` and figma-handoff at `ready` (when applicable).
   - GT-08: `user-stories` non-empty (unless `internal-tooling: true`).
   - GT-09: every cross-reference rule (CG-01..CG-04) passes.
   - GT-10: test-plan at `passed` or `concerns-acknowledged`, and `verification.test-plan-coverage` shows no missing tenant-isolation tests and no out-of-budget performance assertions.

3. **Frontmatter validation.** Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` across every artifact. Any FM-* or per-type validation failure blocks ship.

4. **Generate the PR description body.** Write `hstack/specs/changes/<change-id>/pr-body.md` containing:
   - Title: the change-spec's `Problem` first sentence, prefixed with the change id.
   - Summary section: pull the Target Behavior bullets from the change-spec.
   - Surfaces touched: from frontmatter.
   - Linked artifacts: pointers to spec, plan, test-plan, reviews, verification, adversarial-review.
   - Tech-debt created: pointers from `change-spec.creates-tech-debt`.
   - Test plan: pulled from `test-plan.md` — pyramid summary, tenant-isolation tests, and performance budgets — cross-referenced with `verification.test-plan-coverage` to show observed-vs-promised.
   - Scorecard summary: the nine-gate table from step 2.

   The pr-body.md is for the engineer to copy into the actual PR description — the Skill does not call `gh pr create` or otherwise open the PR.

5. **Advance change-spec status.** When every gate passes, the Skill emits the recommended status transition: `ready-for-review` → `ready-to-ship`. The Skill does not write this transition itself — the engineer either confirms (in which case the engineer can advance via direct edit, or `spec-author` is invoked separately) or addresses any remaining issues. This separation preserves the kernel's rule that humans confirm status transitions to ship-readiness.

## Outputs

- `hstack/specs/changes/<change-id>/pr-body.md` (new or updated) — the PR description body.
- A scorecard printed to the conversation: per-gate pass/fail summary with the failing artifact and field named for any FAIL.
- A recommended next action: either "open / mark the PR ready-for-review and advance status to `ready-to-ship`" or a list of failing gates.

The Skill does not auto-commit any artifact status transitions. `pr-body.md` is committed when written.

## Auto-commit triggers

- One commit when `pr-body.md` is written or updated. Commit message: `ship(<change-id>): pr-body`.

## Idempotency contract

- Re-running on the same change: re-reads every artifact and recomputes the scorecard. `pr-body.md` is rewritten if any artifact has changed since the prior run; otherwise a no-op.
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

## Anti-patterns

- Never write status transitions on any artifact from this Skill. Ship is read-only across the artifact set.
- Never call `gh pr create` or perform the merge. The engineer opens the PR.
- Never silently pass a gate. Every FAIL names the artifact and field.
- Never collapse the nine gates into a single PASS / FAIL. The scorecard is per-gate.
- Never extend `change-spec.in-scope` to make GT-02 pass — the scope amendment goes through `spec-author`, not this Skill.
- Never overwrite `pr-body.md` content the engineer has hand-edited without confirmation. If the file exists with edits beyond the template, surface a diff and ask before rewriting.
