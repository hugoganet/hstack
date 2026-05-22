---
name: hstack-tech-debt-wontfix
description: |
  Use this skill when a tech-debt item is being closed without a fix because the team has decided the cost of resolving exceeds the cost of living with it. The Skill runs a brief two-question interview (a structured-elicitation loop per the kernel's Mechanical operations section), captures the rationale into the TD's frontmatter, and performs direct mechanical writes (per ADR-0001, no spec-author invocation): writes `wontfix-reason` and `wontfix-accepted-alternative`, flips status `open → wontfix`, appends a Resolution Log entry, all in a single atomic commit. Wontfix is a terminal status — per TD-03, no field rewrites are permitted afterwards. Examples:

  <example>
  Context: TD-0017 captured a deliberate compromise that no longer matters — the surrounding code has been rewritten and the original compromise no longer exists.
  user: "/hstack:tech-debt-wontfix TD-0017-prompt-template-string-concat"
  assistant: "I'll ask two questions: (a) why won't this be fixed; (b) what we're accepting as the alternative. Both answers are required and become non-null wontfix-reason and wontfix-accepted-alternative frontmatter fields (TD-06). On confirmation, the Skill writes both fields and flips status to wontfix directly (per ADR-0001, no spec-author invocation) in a single auto-commit. Wontfix is terminal — no further edits."
  <commentary>
  Wontfix is the controlled escape valve for tech-debt that no longer warrants a fix. The kernel requires both fields because "we don't care anymore" without a recorded alternative is the kind of decision that comes back to bite the team six months later. Future engineers reading the TD see the explicit reasoning rather than a silent closure.
  </commentary>
  </example>

  <example>
  Context: An engineer wants to wontfix a tech-debt because they don't want to deal with it right now, not because the cost-benefit has actually flipped.
  user: "/hstack:tech-debt-wontfix TD-0042-overage-banner-tailwind-class"
  assistant: "I'll ask the two questions. If your answer to (a) is 'we don't have time' or 'we'll get to it later', I'll halt and surface that the right path is to leave the TD at `open` and re-prioritize, not to mark it wontfix. Wontfix is for compromises we've decided to live with permanently, not for deferrals."
  <commentary>
  The Skill applies a deliberate friction at the prose level: if the wontfix-reason reads like a deferral ("later", "not a priority", "we don't have bandwidth"), the Skill halts and asks the engineer to either commit to a real wontfix reason or leave the TD at `open`. Deferrals belong in the backlog, not in the wontfix log.
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
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates the TD frontmatter flip and TD-06 (wontfix-reason and wontfix-accepted-alternative both non-null)}}"
---

## Purpose

`hstack-tech-debt-wontfix` is the controlled closure path for tech-debt items the team has decided not to fix. The Skill captures the rationale in two required fields (`wontfix-reason` and `wontfix-accepted-alternative`) and flips status `open → wontfix` directly in the main session (per ADR-0001, no `spec-author` invocation). Per TD-03, wontfix is terminal — no field rewrites are permitted afterwards.

## When to invoke

Invoke when a tech-debt item at `status: open` will not be fixed and the team has decided to live with the compromise permanently. Do NOT invoke for deferrals ("we'll get to it later") — those items stay at `open`. The Skill applies a deliberate prose-level friction to refuse deferral-flavored rationales.

## Inputs

- `<td-id>` (required, positional): the tech-debt id.

## Preconditions

- Verify `hstack/tech-debt/<td-id>.md` exists and is at `status: open`. If at `in-progress`, halt — work is already underway. Concrete recovery: locate the resolution change-spec via the TD's Resolution Log (most recent entry names the resolving change-spec id) and either complete that change normally or abandon it by direct frontmatter edit (`git checkout HEAD -- hstack/tech-debt/<td-id>.md` to revert the TD to `open`, then archive the resolution change folder manually). Do not invoke `spec-author` for the rollback — the kernel forbids it for status flips. If at any terminal status, halt with the status named.

## Orchestration steps

1. **Print the TD in full.** Read `hstack/tech-debt/<td-id>.md` and print Title, Why we took the shortcut, What it costs us, Fix sketch, Pre-conditions, Acceptance to the conversation. The engineer should re-read before committing to wontfix.

2. **Ask the first question.** "Why won't this tech-debt be fixed? (one sentence, ≤ 200 characters)". Capture the answer.

3. **Deferral check.** If the answer contains deferral indicators ("later", "not a priority", "no time", "we'll come back", "next quarter", "after X ships"), halt with: "That reads like a deferral, not a wontfix. Wontfix is for compromises we've decided to live with permanently. Leave the TD at `open` if this is a deferral; only re-invoke when the cost-benefit has actually flipped." The Skill does not write anything in this case.

4. **Ask the second question.** "What are we accepting as the alternative to fixing this? (one sentence)". This is the on-record acknowledgement of the cost the team is choosing to live with. Examples: "We accept the manual workaround documented in the runbook", "We accept the 50ms latency overhead until v2 substrate lands", "The surrounding code has been rewritten and the original compromise no longer exists".

5. **Confirm.** Print both answers and ask "Mark TD-NNNN as wontfix with this rationale? (Y/n)". Default Yes.

6. **Write the wontfix transition (direct write).** Per the kernel's Mechanical operations section, this Skill performs the writes itself via the `Edit` tool — no `spec-author` invocation. Edit `hstack/tech-debt/<td-id>.md`:
   - **Defensive Resolution Log check.** If `## Resolution Log` is not present in the file (legacy TDs authored before the template included this section), append `\n## Resolution Log\n` to the end of the file first.
   - Edit frontmatter: `wontfix-reason: <answer-a>`, `wontfix-accepted-alternative: <answer-b>`, `status: open → wontfix`, `updated: <today>`.
   - Append to the Resolution Log section: `status: open → wontfix on <today> by <owner>. Reason: <answer-a>. Accepted alternative: <answer-b>.`

   Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` against the file. TD-06 (wontfix requires both rationale fields non-null) must pass. On validation pass, `git add` the file and commit with message `tech-debt(<td-id>): wontfix`. The four frontmatter writes plus the log append land in this single auto-commit, preserving atomicity. On validation failure, halt; unstaged changes can be reverted via `git checkout -- <td-file>`.

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
- Either answer exceeds 200 characters. Ask for a tighter version — wontfix rationales are short and load-bearing.
- The engineer declines confirmation at step 5.

## Failure modes

- **Direct write fails (filesystem, validator, or git).** Halt; the TD's status flip and the two frontmatter writes must land in a single auto-commit. Partial writes are not possible if the Skill aborts on validator failure before staging.
- **Deferral disguised as wontfix.** The prose-level check in step 3 is the v1 defense. v2 substrate could add LLM-graded rationale assessment, but v1 trusts the engineer's willingness to be honest with themselves.

## Anti-patterns

- Never accept a wontfix-reason that reads as a deferral. The check is mandatory and is the only friction protecting against backlog amnesia.
- Never write `status: wontfix` without both rationale fields non-null. TD-06 enforces this at validation.
- Never re-open a wontfix TD. Per TD-03, wontfix is terminal — author a new TD instead.
- Never invoke `spec-author` for the wontfix transition. Per the kernel's Mechanical operations section (ADR-0001), this Skill performs the writes directly. The three writes (status, wontfix-reason, wontfix-accepted-alternative) plus the Resolution Log append land atomically in a single Skill-driven commit.
