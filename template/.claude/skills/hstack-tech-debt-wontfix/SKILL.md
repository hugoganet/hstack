---
name: hstack-tech-debt-wontfix
description: Use to close a tech-debt item the team has decided to live with permanently, recording the reason and the accepted alternative. Wontfix describes a choice; `/hstack:tech-debt-stale` describes a claim that no longer reproduces.
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
  - "node hstack/scripts/validate-spec.mjs — validates the TD frontmatter flip and TD-06 (wontfix-reason and wontfix-accepted-alternative both non-null)"
---

## Purpose

`hstack-tech-debt-wontfix` is the controlled closure path for tech-debt items the team has decided not to fix. The Skill captures the rationale in two required fields (`wontfix-reason` and `wontfix-accepted-alternative`) and flips status `open → wontfix` directly in the main session (per ADR-0001, no `spec-author` invocation). Per TD-03, wontfix is terminal — no field rewrites are permitted afterwards.

## When to invoke

Invoke when a tech-debt item at `status: open` will not be fixed and the team has decided to live with the compromise permanently. Do NOT invoke for deferrals ("we'll get to it later") — those items stay at `open`. The Skill applies a deliberate prose-level friction to refuse deferral-flavored rationales.

## Inputs

- `<td-id>` (required, positional): the tech-debt id.

## Preconditions

- Verify `hstack/tech-debt/<td-id>.md` exists and is at `status: open`. If at `in-progress`, halt — work is already underway. Concrete recovery: locate the resolution change-spec via the TD's Resolution Log (most recent entry names the resolving change-spec id) and either complete that change normally or abandon it by direct frontmatter edit (`git checkout HEAD -- hstack/tech-debt/<td-id>.md` to revert the TD to `open`, then archive the resolution change folder manually). If at any terminal status, halt with the status named.

## Orchestration steps

1. **Print the TD in full.** Read `hstack/tech-debt/<td-id>.md` and print Title, Why we took the shortcut, What it costs us, Fix sketch, Pre-conditions, Acceptance to the conversation. The engineer should re-read before committing to wontfix.

2. **Ask the first question.** "Why won't this tech-debt be fixed?" One sentence is usually enough, and the answer should name the compromise and why living with it is the right call — a reason that survives being read back in a year without the surrounding context. No length bound: the artifact was just printed in full, so the engineer is answering with it on screen.

3. **Deferral check.** If the answer contains deferral indicators ("later", "not a priority", "no time", "we'll come back", "next quarter", "after X ships"), halt with: "That reads like a deferral, not a wontfix. Wontfix is for compromises we've decided to live with permanently. Leave the TD at `open` if this is a deferral; only re-invoke when the cost-benefit has actually flipped." The Skill does not write anything in this case.

4. **Ask the second question.** "What are we accepting as the alternative to fixing this? (one sentence)". This is the on-record acknowledgement of the cost the team is choosing to live with. Examples: "We accept the manual workaround documented in the runbook", "We accept the 50ms latency overhead until v2 substrate lands", "The surrounding code has been rewritten and the original compromise no longer exists".

5. **Confirm.** Print both answers and ask "Mark TD-NNNN as wontfix with this rationale? (Y/n)". Default Yes.

6. **Write the wontfix transition (direct write).** Per the kernel's Mechanical operations section, this Skill performs the writes itself via the `Edit` tool — no `spec-author` invocation. Edit `hstack/tech-debt/<td-id>.md`:
   - Defensive log-header check per the kernel: if `## Resolution Log` is absent, append it before writing the entry.
   - Edit frontmatter: `wontfix-reason: <answer-a>`, `wontfix-accepted-alternative: <answer-b>`, `status: open → wontfix`, `updated: <today>`.
   - Append to the Resolution Log section: `status: open → wontfix on <today> by <owner>. Reason: <answer-a>. Accepted alternative: <answer-b>.`

   Run `node hstack/scripts/validate-spec.mjs <path>` against the file. TD-06 (wontfix requires both rationale fields non-null) must pass. On validation pass, `git add` the file and commit with message `tech-debt(<td-id>): wontfix`. The four frontmatter writes plus the log append land in this single auto-commit, preserving atomicity. On validation failure, halt; unstaged changes can be reverted via `git checkout -- <td-file>`.

7. **Confirm completion.** Print: "TD-NNNN is now `wontfix`. Per TD-03, no further field rewrites are permitted on this artifact. If the team's decision later reverses, author a new tech-debt via `/hstack:tech-debt-new` rather than re-opening this one."

## Outputs

- `hstack/tech-debt/<td-id>.md` advanced to `status: wontfix` with `wontfix-reason` and `wontfix-accepted-alternative` set, and a Resolution Log entry appended.
- One commit. Message: `tech-debt(<td-id>): wontfix`.

## Auto-commit triggers

- One commit at the status flip. The kernel's auto-commit-at-status-transition rule applies.

## Idempotency contract

- Re-running on a TD already at `wontfix`: the Skill reads the existing artifact and produces a no-op aside from informing the engineer the TD is already wontfix.
- Re-running mid-interview after a halt: the Skill does not persist session state (the interview is short enough that re-asking both questions is cheaper than state-file management).

## Stop conditions

Beyond the kernel's general stop conditions:

- The TD does not exist or is at a non-`open` status. Halt with status named.
- The wontfix-reason answer reads as a deferral (per step 3). The Skill refuses to write and surfaces the recommendation.
- The engineer declines confirmation at step 5.

## Failure modes

- **Direct write fails (filesystem, validator, or git).** Halt; the TD's status flip and the two frontmatter writes must land in a single auto-commit. Partial writes are not possible if the Skill aborts on validator failure before staging.
- **Deferral disguised as wontfix.** The prose-level check in step 3 is the v1 defense. v2 substrate could add LLM-graded rationale assessment, but v1 trusts the engineer's willingness to be honest with themselves.
