---
name: hstack-tech-debt-stale
description: |
  Use this skill when a tech-debt item's original claim no longer reproduces because the surrounding code was rewritten, a dependency was upgraded, the bug was fixed incidentally as part of unrelated work, or the system the TD described no longer exists. This is distinct from `/hstack:tech-debt-wontfix`: wontfix says "the problem is still real but we choose to live with it"; stale-no-longer-reproducible says "the problem no longer exists, verifiably." The Skill runs a one-question structured-elicitation loop (a per-kernel Mechanical operations pattern), captures the verification evidence into the TD's frontmatter, and performs direct mechanical writes (per ADR-0001, no spec-author invocation): writes `stale-verified-at` and `stale-verification-method`, flips status `open → stale-no-longer-reproducible`, appends a Resolution Log entry, all in a single atomic commit. The new status is terminal — per TD-03, no field rewrites are permitted afterwards. Examples:

  <example>
  Context: TD-0042 captured a workaround needed because a Tiptap plugin had a known bug. The team upgraded Tiptap last week and the bug is fixed upstream; the workaround is still in the codebase but the underlying claim no longer holds.
  user: "/hstack:tech-debt-stale TD-0042-tiptap-paste-workaround"
  assistant: "I'll ask one question: what evidence shows the original claim no longer reproduces? On confirmation, the Skill writes stale-verified-at and stale-verification-method directly (per ADR-0001, no spec-author invocation), flips status to stale-no-longer-reproducible, and commits atomically. The new status is terminal."
  <commentary>
  Stale-no-longer-reproducible is the controlled exit for organic-decay closures. The kernel requires the verification evidence because "we don't reproduce it anymore" without an artefact is the kind of silent backlog-clearing that lets real debt slip through unaudited. Future engineers reading the TD see the explicit verification rather than just an unexplained closure.
  </commentary>
  </example>

  <example>
  Context: An engineer wants to use this Skill on a TD whose original problem IS still real but they no longer want to fix it.
  user: "/hstack:tech-debt-stale TD-0017-prompt-template-string-concat"
  assistant: "Wait — this is wontfix territory, not stale. Stale-no-longer-reproducible means the problem has verifiably gone away. If the prompt-template string-concat is still in the codebase and still has the original issue, the team is choosing to live with it (wontfix), not observing that it no longer exists (stale). I'll halt and direct you to /hstack:tech-debt-wontfix instead, OR you can show me evidence the string-concat code was actually removed and I'll proceed with stale."
  <commentary>
  The Skill applies a deliberate semantic check at the verification step. Misusing stale for a deferral-flavored closure corrupts the audit signal that distinguishes deliberate-deferral (wontfix) from organic-decay (stale). The engineer's verification evidence must describe an absence, not a preference.
  </commentary>
  </example>
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates the TD status flip and TD-07 (stale requires both verification fields non-null)}}"
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

Do NOT invoke for deferrals ("we won't get to this") — those go to `/hstack:tech-debt-wontfix`. Do NOT invoke for TDs that are still observably true but the team is choosing not to fix — also `/hstack:tech-debt-wontfix`. The semantic distinction is load-bearing: stale describes an absence, wontfix describes a choice.

## Inputs

- `<td-id>` (required, positional): the tech-debt id.

## Preconditions

- Verify `hstack/tech-debt/<td-id>.md` exists and is at `status: open`. If at `in-progress`, halt — work is already underway; complete or cancel the resolution change-spec first. If at any terminal status (`resolved`, `wontfix`, `stale-no-longer-reproducible`, `archived`), halt with the status named.

## Orchestration steps

1. **Print the TD in full.** Read `hstack/tech-debt/<td-id>.md` and print Title, Why we took the shortcut, What it costs us, Fix sketch, Pre-conditions, Acceptance to the conversation. The engineer should re-read before committing to a stale-no-longer-reproducible closure; the verification step depends on understanding what the original claim actually was.

2. **Ask the verification question.** "What evidence shows this TD's claim no longer reproduces? Be specific — a grep result that returns nothing, a git log showing the dependent code was removed, a dependency upgrade that fixes the issue upstream, etc. (one sentence, ≤ 300 characters)". Capture the answer.

3. **Semantic check.** If the answer reads like a deferral or a preference rather than an absence ("we don't care anymore", "not worth it", "moved on", "low priority", "not blocking us"), halt with: "That reads like a wontfix rationale, not stale-no-longer-reproducible. Stale means the original problem has verifiably gone away — code removed, dependency upgraded, system retired. If the problem is still observably present and the team is choosing not to fix it, use /hstack:tech-debt-wontfix instead." The Skill does not write anything in this case.

4. **Confirm.** Print the captured verification method and ask "Mark TD-NNNN as stale-no-longer-reproducible with this evidence? (Y/n)". Default Yes. Include a one-line summary of what will be written to disk so the engineer sees the proposed-diff before committing (per the kernel's AI writes / humans confirm contract for mechanical operations).

5. **Verify the answer length.** If the answer exceeds 300 characters, ask for a tighter version — stale verification methods are short, specific, and load-bearing. If the engineer cannot tighten below 300 chars without losing evidence, the verification probably isn't structural enough to qualify as stale; consider whether wontfix is the right path.

6. **Write the stale transition (direct write).** Per the kernel's Mechanical operations section, this Skill performs the writes itself via the `Edit` tool — no `spec-author` invocation. Edit `hstack/tech-debt/<td-id>.md`:
   - **Defensive Resolution Log check.** If `## Resolution Log` is not present in the file (legacy TDs authored before the template included this section), append `\n## Resolution Log\n` to the end of the file first.
   - Edit frontmatter: `stale-verified-at: <today>`, `stale-verification-method: <answer>`, `status: open → stale-no-longer-reproducible`, `updated: <today>`.
   - Append to the Resolution Log section: `status: open → stale-no-longer-reproducible on <today> by <owner>. Verification method: <answer>.`

   Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` against the file. TD-07 (stale-no-longer-reproducible requires both `stale-verified-at` and `stale-verification-method` non-null) must pass once the validator ships; until then, the proposed-diff preview in step 4 is the v1 substitute per the kernel's AI writes / humans confirm clause. On validation pass (or v1 proposed-diff acknowledgement), `git add` the file and commit with message `tech-debt(<td-id>): stale-no-longer-reproducible`. The three frontmatter writes plus the log append land in this single auto-commit, preserving atomicity. On validation failure, halt; unstaged changes can be reverted via `git checkout -- <td-file>`.

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
- The verification answer reads as a deferral or preference (per step 3). The Skill refuses to write and surfaces the wontfix recommendation.
- The answer exceeds 300 characters and the engineer cannot tighten it without losing evidence. Halt and surface the wontfix recommendation — overly long stale verifications usually indicate the claim isn't actually absent.
- The engineer declines confirmation at step 4.

## Failure modes

- **Direct write fails (filesystem, validator, or git).** Halt; the four frontmatter writes plus the Resolution Log append must land in a single auto-commit. Partial writes are not possible if the Skill aborts on validator failure before staging. Concrete recovery: `git checkout -- hstack/tech-debt/<td-id>.md` to revert to the prior committed state.
- **Stale claim turns out to be reproducible after closure.** Per TD-03 the closed TD is immutable; the engineer authors a new tech-debt via `/hstack:tech-debt-new` describing the reappeared claim. The new TD references the closed one in its Title or Why-we-took-the-shortcut for audit-trail continuity.

## Anti-patterns

- Never accept a stale verification that reads as a deferral. The check is mandatory and is the v1 defense against misusing stale to clear backlog without an actual claim-absence verification.
- Never write `status: stale-no-longer-reproducible` without both `stale-verified-at` and `stale-verification-method` non-null. TD-07 enforces this at validation (once the validator ships); the Skill's structured-elicitation loop enforces it at write time.
- Never invoke `spec-author` for this transition. Per the kernel's Mechanical operations section (ADR-0001), this Skill performs the writes directly. The status flip, two field writes, and Resolution Log append land atomically in a single Skill-driven commit.
- Never re-open a stale-no-longer-reproducible TD. Per TD-03, the status is terminal — author a new TD instead if the claim reappears.
- Never use this Skill as a faster path to `wontfix`. The semantic distinction (absence vs choice) is load-bearing for audit signal honesty. If the engineer is tempted to bypass `wontfix`'s two-question discipline by routing through stale, the Skill's semantic check (step 3) is the v1 defense.
