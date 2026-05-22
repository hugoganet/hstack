---
name: hstack-kernel-fit-triage
description: |
  Use this skill when the engineer wants to triage an open kernel-fit finding — either acknowledge it (intent to act, not yet promoted) or dismiss it (won't pursue). The Skill is mechanical per ADR-0001: structured-elicitation loop, proposed-diff preview, Y/n confirmation, direct `Edit` writes, one atomic commit. No subagent invoked. Promotion to an ADR is a separate Skill (`/hstack:kernel-fit-promote`); this Skill never touches ADRs or change-specs. Examples:

  <example>
  Context: The engineer received a Slack nudge about KF-0001 (KF-P1, internal-tooling flag conflation) and wants to acknowledge it for later promotion.
  user: "/hstack:kernel-fit-triage KF-0001 --action acknowledge"
  assistant: "I'll read KF-0001, print it in full, show the proposed-diff (status: open → acknowledged; owner: <git-handle>; updated: today; Triage Log entry appended), wait for Y/n, then Edit + commit `kernel-fit(KF-0001): acknowledge`. No reason is required for acknowledge. If you later decide to promote, run `/hstack:kernel-fit-promote KF-0001 --slug <adr-slug>`."
  <commentary>
  Acknowledge does not require a `--reason`. It is the "I've seen this, I intend to act, but I'm not promoting yet" state. The Triage Log records the transition. The finding stays at `status: acknowledged` until promote or dismiss happens.
  </commentary>
  </example>

  <example>
  Context: The engineer reviewed KF-0002 and decided the pattern is engineer-error, not a kernel gap.
  user: "/hstack:kernel-fit-triage KF-0002 --action dismiss --reason \"The two changes flagged actually do have downstream consumers; the change-specs simply omitted the user-stories array because the engineer copied an old template. Not a kernel-flag issue, just stale boilerplate.\""
  assistant: "I'll verify the reason is ≥50 characters (KF-05), read KF-0002, print the proposed-diff (status: open → dismissed; dismissed-reason: <text>; owner; updated; Triage Log entry), wait for Y/n, then commit `kernel-fit(KF-0002): dismiss`. Dismissal is terminal — re-running on this finding will surface that it's already dismissed and exit no-op."
  <commentary>
  Dismissal requires a reason of ≥50 characters per KF-05. The check is mechanical at validation time; the Skill enforces it at step 2. Drive-by dismissals are exactly the failure mode the rule exists to catch. The dismissed-reason is itself audit signal — a high rate of dismissals on a given pattern means either the pattern is poorly tuned or the engineer is gaming the gate.
  </commentary>
  </example>

  <example>
  Context: The engineer tries to dismiss a finding with too-short reason.
  user: "/hstack:kernel-fit-triage KF-0003 --action dismiss --reason \"not relevant\""
  assistant: "I'll halt — `dismissed-reason` is 12 characters; KF-05 requires ≥50. Drive-by dismissals defeat the audit signal. Either provide a more substantive reason or leave the finding at `open` (open is a legitimate long-term state when triage is genuinely deferred)."
  <commentary>
  Short-reason rejection is a hard halt. The Skill does not negotiate — write a real reason or leave the finding alone. Same shape as the deferral-check in `hstack-tech-debt-wontfix`.
  </commentary>
  </example>

tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates the finding frontmatter flip and KF-05 (dismissed-reason ≥50 chars when status: dismissed)}}"
---

## Purpose

`hstack-kernel-fit-triage` is the mechanical status-flip Skill for kernel-fit findings. It moves a finding from `status: open` to either `acknowledged` (intent to promote, not yet) or `dismissed` (won't pursue, with mandatory rationale). Per ADR-0001, the Skill performs the `Edit` writes directly in the main session — no subagent invocation; the value to write is fully determined by the engineer's invocation arguments.

This Skill does not promote findings to ADRs. Promotion is a separate Skill (`/hstack:kernel-fit-promote`) with its own structured flow. This Skill also does not edit ADRs, change-specs, or any artifact outside `hstack/kernel-fit/findings/`.

## When to invoke

Invoke when a finding is at `status: open` and the engineer wants to:

- **Acknowledge** (`--action acknowledge`): record intent to act on the finding without committing to an ADR yet. Useful when the finding is real but the team needs more thinking time, or when the right kernel-change shape is unclear.
- **Dismiss** (`--action dismiss --reason <text>`): close the finding without pursuing a kernel change. The reason is mandatory (≥50 characters per KF-05) and becomes part of the audit trail.

For findings already at `acknowledged`, re-invoking with `--action acknowledge` is a no-op; re-invoking with `--action dismiss --reason <text>` is permitted (acknowledged → dismissed is a valid transition when the engineer reconsiders). Findings at terminal status (`dismissed`, `promoted`, `superseded`, `archived`) are immutable from this Skill's perspective — the Skill halts.

## Inputs

- `<finding-id>` (required, positional): the finding id, e.g. `KF-0001-internal-tooling-flag-conflation` or the short form `KF-0001` (the Skill resolves the latter to the matching file via glob).
- `--action <acknowledge | dismiss>` (required): the triage action.
- `--reason <text>` (required when `--action dismiss`; forbidden when `--action acknowledge`): the dismissal rationale. Must be ≥50 characters per KF-05.

## Preconditions

- `hstack/kernel-fit/findings/<finding-id>*.md` exists. If missing, halt.
- The finding is at `status: open` (or `acknowledged` when transitioning to `dismissed`). If at any other status, halt with the current status named and the explanation that the status is terminal.
- `--action` is one of `acknowledge | dismiss` (controlled enum).
- When `--action dismiss`, `--reason` is non-empty and ≥50 characters.
- When `--action acknowledge`, `--reason` is absent (the Skill rejects redundant reasons to keep the audit signal clean — acknowledge reasons live in the next promote / dismiss invocation if needed).

## Orchestration steps

1. **Resolve the finding file.** Glob `hstack/kernel-fit/findings/<finding-id>*.md`. If zero matches, halt. If multiple matches (shouldn't happen with the immutable-id rule, but defense in depth), halt and ask the engineer to disambiguate.

2. **Validate inputs against preconditions.** Walk the precondition checks above. On any failure, halt with the named reason. For the `--reason` length check (`dismiss`), surface the actual character count in the halt message so the engineer can size their next attempt.

3. **Print the finding in full.** Read the resolved file and print its full body to the conversation. The engineer should re-read before committing to the triage action.

4. **Compose the frontmatter edit.** Compute the exact frontmatter changes:

   For `--action acknowledge`:
   - `status: open → acknowledged`
   - `owner: <git-handle>` (read from git config; fall back to the engineer's hstack config owner)
   - `updated: <today>` (ISO date)

   For `--action dismiss`:
   - `status: open → dismissed` (or `acknowledged → dismissed`)
   - `dismissed-reason: <text>` (the engineer's `--reason` verbatim)
   - `owner: <git-handle>`
   - `updated: <today>`

5. **Compose the Triage Log append.** Compute the entry to append to the `## Triage Log` section:

   For acknowledge:
   ```
   - `status: open → acknowledged` on <today> by <owner>. Triggered by `/hstack:kernel-fit-triage <id> --action acknowledge`.
   ```

   For dismiss:
   ```
   - `status: <prev> → dismissed` on <today> by <owner>. Reason: <dismissed-reason>.
   ```

   Defensive Triage Log check: if `## Triage Log` is not present in the file (legacy findings authored before the template included this section), append `\n## Triage Log\n` to the end of the file first.

6. **Print the proposed diff.** Show the engineer the exact frontmatter changes and the exact Triage Log entry that will land. This is the kernel's mechanical-operations confirmation gate — until `validate-spec.ts` ships, the proposed-diff preview is the only contract check between the `Edit` and the commit.

7. **Confirm.** Print "Apply triage to <finding-id>? (Y/n)". Default Yes. On `n`, abort without writing.

8. **Edit + validate + commit.** On `Y`:
   - `Edit` the file: frontmatter changes + Triage Log append.
   - Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` against the file. KF-01 through KF-05 must pass; specifically KF-05 (`dismissed-reason` non-null and ≥50 chars when `status: dismissed`) gates dismissal.
   - On validation pass: `git add` the file and commit with message `kernel-fit(<finding-id>): <action>` (e.g. `kernel-fit(KF-0001): acknowledge`).
   - On validation failure: halt; revert via `git checkout -- <finding-file>`. Report the failing rule to the engineer.

9. **Confirm completion.** Print "Triage applied: <finding-id> is now `<new-status>`. Next steps: `/hstack:kernel-fit-promote <finding-id> --slug <adr-slug>` to elevate to an ADR; or leave at <new-status> and let the next `/hstack:kernel-fit-scan` re-evaluate."

## Outputs

- One edit to `hstack/kernel-fit/findings/<finding-id>*.md` — frontmatter flip + Triage Log append.
- One commit. Message: `kernel-fit(<finding-id>): <action>`.

## Auto-commit triggers

- One commit at the status flip. The kernel's auto-commit-at-status-transition rule applies.

## Idempotency contract

- Re-running with `--action acknowledge` on a finding already at `acknowledged`: no-op. The Skill prints "already acknowledged" and exits without writing.
- Re-running with `--action dismiss` on a finding already at `dismissed`: no-op. The Skill prints "already dismissed" + the existing `dismissed-reason` and exits without writing.
- Re-running with `--action dismiss` on a finding at `acknowledged`: permitted — the `acknowledged → dismissed` transition is valid. The Triage Log entry uses the `<prev> → dismissed` shape.
- Re-running on a finding at `promoted`, `superseded`, or `archived`: halt with the status named. These are terminal from this Skill's perspective.

## Stop conditions

Beyond the kernel's general stop conditions:

- The finding does not exist or is at a terminal-from-triage status (`dismissed`, `promoted`, `superseded`, `archived`). Halt with the status named.
- `--action` is missing or not in the enum. Halt with usage.
- `--action dismiss` without `--reason`, or with `--reason` <50 characters. Halt with the actual length count.
- `--action acknowledge` with `--reason` present. Halt — acknowledge does not take a reason.
- The engineer declines confirmation at step 7. Abort cleanly.
- Validator fails at step 8 — halt with the failing rule; revert the unstaged edit.

## Failure modes

- **Edit fails (filesystem, validator, git).** The frontmatter flip and the Triage Log append must land together in a single auto-commit. If `Edit` succeeds but `git add` or `git commit` fails, the working tree carries the unstaged change — revert via `git checkout -- <finding-file>` and re-invoke.
- **Drive-by dismissal attempt.** The ≥50-character check at step 2 is the v1 defense. Short reasons fail before any write occurs.
- **Stale finding (post-scan supersession in flight).** If a concurrent `/hstack:kernel-fit-scan` has just superseded the finding the engineer is triaging, the post-edit validator would catch the inconsistent state (superseded finding cannot be re-triaged). Halt and let the engineer re-fetch the working tree.

## Anti-patterns

- Never invoke a subagent for triage. The action's value is fully determined by `--action` and `--reason`; the kernel's Mechanical operations section requires direct Skill writes for cases like this (saving ~25k subagent-context tokens per call).
- Never accept a dismissal reason shorter than 50 characters. The audit signal depends on substantive rationales — drive-bys defeat the loop.
- Never edit a finding's `pattern`, `evidence-rows`, `confidence`, or `evidence-row-count` fields. Those are the analyst's domain; triage only flips `status`, sets `owner` / `updated`, and writes `dismissed-reason` (when dismissing).
- Never edit a `promoted` finding's `promoted-to` field. That is owned by `/hstack:kernel-fit-promote` and is reciprocally bound to the target ADR.
- Never re-open a `dismissed` or `superseded` finding. If the kernel-fit pattern recurs with new evidence, the next `/hstack:kernel-fit-scan` will produce a new finding with a new id — that's the right path.
- Never invoke `spec-author` for the triage action. Per ADR-0001, the Skill writes directly.
