---
name: hstack-tech-debt-stale
description: Use to close a tech-debt item whose original claim no longer reproduces — the code was rewritten, a dependency shipped a fix, the system is gone. Stale describes a verified absence; `/hstack:tech-debt-wontfix` describes a choice.
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - "node hstack/scripts/validate-spec.mjs — validates the TD status flip and TD-07 (stale requires both verification fields non-null)"
---

## Purpose

`hstack-tech-debt-stale` is the controlled closure path for tech-debt items whose original claim no longer reproduces. The Skill captures the verification evidence in two required fields (`stale-verified-at` and `stale-verification-method`) and flips status `open → stale-no-longer-reproducible` directly in the main session (per ADR-0001, no `spec-author` invocation). Per TD-03, the new status is terminal — no field rewrites are permitted afterwards.

The Skill exists because closing aged-out TDs via `/hstack:tech-debt-wontfix` would corrupt the audit signal `wontfix` carries (deliberate cost-benefit decision to live with the compromise). Stale-no-longer-reproducible is the structurally honest closure for organic decay.

## When to invoke

Invoke when a tech-debt item at `status: open` has a claim that no longer reproduces — typically because:

- The surrounding code was rewritten or removed.
- A third-party dependency was upgraded and shipped a fix.
- The bug was fixed incidentally as part of an unrelated change.
- The system, module, or call path the TD described no longer exists.

Do NOT invoke for deferrals ("we won't get to this") — those go to `/hstack:tech-debt-wontfix`. Do NOT invoke for TDs that are still observably true but the team is choosing not to fix — also `/hstack:tech-debt-wontfix`. The semantic distinction is load-bearing: stale describes an absence, wontfix describes a choice. Misusing `wontfix` for a claim that has aged out corrupts the audit signal that separates deliberate deferral from organic decay — the two statuses answer different retrospective questions, and a corpus that conflates them can answer neither.

## Inputs

- `<td-id>` (required, positional): the tech-debt id.

## Preconditions

- Verify `hstack/tech-debt/<td-id>.md` exists and is at `status: open`. If at `in-progress`, halt — work is already underway; complete or cancel the resolution change-spec first. If at any terminal status (`resolved`, `wontfix`, `stale-no-longer-reproducible`, `archived`), halt with the status named.

## Orchestration steps

1. **Print the TD in full.** Read `hstack/tech-debt/<td-id>.md` and print Title, Why we took the shortcut, What it costs us, Fix sketch, Pre-conditions, Acceptance to the conversation. The engineer should re-read before committing to a stale-no-longer-reproducible closure; the verification step depends on understanding what the original claim actually was.

2. **Ask the verification question.** "What evidence shows this TD's claim no longer reproduces?" The answer has to be checkable by someone who was not in the room — a command that returns nothing, a commit that removed the dependent code, a dependency version that carries the upstream fix, a system that no longer exists. Capture it as written; no length bound.

3. **Semantic check.** Stale means the problem no longer exists and someone else could verify that. The answer has to be a fact about the code, the dependency tree, or the deployed system — not a position on the problem. A sentence that says how the team now feels about the compromise is a wontfix rationale however it is phrased, and a sentence that names a removed call path is a stale verification however casually it is written. When it reads as a preference, halt with: "That reads like a wontfix rationale, not stale-no-longer-reproducible. Stale means the original problem has verifiably gone away — code removed, dependency upgraded, system retired. If the problem is still observably present and the team is choosing not to fix it, use /hstack:tech-debt-wontfix instead." The Skill does not write anything in this case.

4. **Confirm.** Print the captured verification method and ask "Mark TD-NNNN as stale-no-longer-reproducible with this evidence? (Y/n)". Default Yes. Include a one-line summary of what will be written to disk so the engineer sees the proposed-diff before committing (per the kernel's AI writes / humans confirm contract for mechanical operations).

5. **Verify the answer is a fact, not a story.** Read it back against one test: could a third party run, read, or look up what it names and reach the same conclusion? If it names something checkable, it qualifies — one clause or four. If it is an account of why the problem stopped mattering, the problem is still there and this is a wontfix; surface that recommendation rather than writing the stale closure.

6. **Write the stale transition (direct write).** Per the kernel's Mechanical operations section, this Skill performs the writes itself via the `Edit` tool — no `spec-author` invocation. Edit `hstack/tech-debt/<td-id>.md`:
   - Defensive log-header check per the kernel: if `## Resolution Log` is absent, append it before writing the entry.
   - Edit frontmatter: `stale-verified-at: <today>`, `stale-verification-method: <answer>`, `status: open → stale-no-longer-reproducible`, `updated: <today>`.
   - Append to the Resolution Log section: `status: open → stale-no-longer-reproducible on <today> by <owner>. Verification method: <answer>.`

   Run `node hstack/scripts/validate-spec.mjs <path>` against the file. TD-07 (stale-no-longer-reproducible requires both `stale-verified-at` and `stale-verification-method` non-null) must pass. On validation pass, `git add` the file and commit with message `tech-debt(<td-id>): stale-no-longer-reproducible`. The three frontmatter writes plus the log append land in this single auto-commit, preserving atomicity. On validation failure, halt; unstaged changes can be reverted via `git checkout -- <td-file>`.

7. **Confirm completion.** Print: "TD-NNNN is now `stale-no-longer-reproducible`. Per TD-03, no further field rewrites are permitted on this artifact. If the original claim ever reappears, author a new tech-debt via `/hstack:tech-debt-new` rather than re-opening this one."

## Outputs

- `hstack/tech-debt/<td-id>.md` advanced to `status: stale-no-longer-reproducible` with `stale-verified-at` and `stale-verification-method` set, and a Resolution Log entry appended.
- One commit. Message: `tech-debt(<td-id>): stale-no-longer-reproducible`.

## Auto-commit triggers

- One commit at the status flip. The kernel's auto-commit-at-status-transition rule applies.

## Idempotency contract

- Re-running on a TD already at `stale-no-longer-reproducible`: the Skill reads the existing artifact and produces a no-op aside from informing the engineer the TD is already stale.
- Re-running mid-interview after a halt: the Skill does not persist session state (the interview is one question; re-asking is cheaper than state-file management).

## Stop conditions

Beyond the kernel's general stop conditions:

- The TD does not exist or is at a non-`open` status. Halt with the status named.
- The verification answer is a preference about the problem rather than a fact about its absence (per step 3). The Skill refuses to write and surfaces the wontfix recommendation.
- The answer names nothing a third party could check. Halt and surface the wontfix recommendation — a verification that cannot be re-run by someone else is a preference about the problem, not evidence of its absence.
- The engineer declines confirmation at step 4.

## Failure modes

- **Direct write fails (filesystem, validator, or git).** Halt; the four frontmatter writes plus the Resolution Log append must land in a single auto-commit. Partial writes are not possible if the Skill aborts on validator failure before staging. Concrete recovery: `git checkout -- hstack/tech-debt/<td-id>.md` to revert to the prior committed state.
- **Stale claim turns out to be reproducible after closure.** Per TD-03 the closed TD is immutable; the engineer authors a new tech-debt via `/hstack:tech-debt-new` describing the reappeared claim. The new TD references the closed one in its Title or Why-we-took-the-shortcut for audit-trail continuity.
