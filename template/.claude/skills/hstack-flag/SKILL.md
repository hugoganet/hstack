---
name: hstack-flag
description: |
  Use this skill when the engineer notices in-the-moment friction in the hstack workflow — a Skill loop that felt off, a subagent output that read wrong, a halt firing for an unexpected reason, a confirmation diff that revealed an unstated assumption — and wants to surface it for kernel-fit review without halting the current work. The Skill is the engineer-triggered side of the kernel-fit closed loop (ADR-0005). It drops a tiny frontmatter-only pin to `hstack/kernel-fit/flags/pending/` carrying session-id + transcript path + branch + HEAD + timestamp, completes in under a second, and exits. No interview, no confirmation, no commit. The next `/hstack:kernel-fit-scan` reads each pin, opens the referenced transcript, classifies the friction, and either folds the signal into an existing finding or emits a new one. Examples:

  <example>
  Context: Mid-implementation the engineer notices a Skill produced a confirmation diff that revealed an assumption the kernel does not name.
  user: "/hstack:flag"
  assistant: "📌 pinned at hstack/kernel-fit/flags/pending/flag-20260523T143208-a3f9.md — kernel-fit will review on next scan."
  <commentary>
  Zero-friction is load-bearing. No interview, no confirmation gate, no diff preview. The Skill captures session-id (from most-recently-modified jsonl under ~/.claude/projects/<encoded-cwd>/), branch, HEAD, timestamp, and writes the pin in under a second. The engineer continues working immediately.
  </commentary>
  </example>

  <example>
  Context: The engineer wants to leave a one-word hint so future-them remembers the rough shape of the friction when they re-read the transcript.
  user: "/hstack:flag halt-loop"
  assistant: "📌 pinned with hint 'halt-loop' — kernel-fit will review on next scan."
  <commentary>
  The optional positional hint argument is a one-word string. Multi-word hints are rejected (the Skill takes argv[0] and ignores the rest with a one-line note). The hint is for the engineer's future audit, not for the analyst — per ADR-0005, the analyst forms its classification from the transcript window, not from engineer-written hints, to preserve the no-contamination contract.
  </commentary>
  </example>

  <example>
  Context: The engineer flags from a workspace where the encoded-path directory under ~/.claude/projects/ does not exist (e.g., the harness is storing transcripts elsewhere or the workspace is brand-new).
  user: "/hstack:flag"
  assistant: "📌 pinned with session-id-source: fallback-cwd (no jsonl found under ~/.claude/projects/<encoded>; session-id may not resolve at scan-time). The analyst will classify as transcript-truncated if the transcript cannot be located. Re-flag in a session whose transcript is reachable if the friction is recurring."
  <commentary>
  The session-id capture is heuristic in v1 (per ADR-0005). The Skill does not halt when the heuristic fails — it writes the pin with whatever metadata it can capture and a note in `session-transcript-path` indicating the fallback. The analyst's `transcript-truncated` classification is the safety net. v2 substrate will replace the heuristic with a harness-exposed session-id.
  </commentary>
  </example>
tools:
  - Bash
  - Read
  - Write
  - Glob
---

## Purpose

`hstack-flag` is the engineer-triggered feeder into the kernel-fit closed loop (ADR-0005). It captures a *pointer to the moment* — session-id, transcript path, branch, HEAD, timestamp — so the `kernel-fit-analyst` can later read the surrounding transcript window and classify whatever friction prompted the flag. The Skill carries no engineer interpretation of the friction; the analyst forms its classification independently to preserve the no-contamination contract.

This Skill is mechanical per ADR-0001. No subagent is invoked. The values to write are determined entirely by the invocation context (git state, working directory, the active Claude Code session-id, current transcript message count) plus the optional one-word hint. There is no interview, no confirmation gate, no proposed-diff preview, and no commit — the pin is additive, immutable, and out-of-band from the lifecycle state machine.

## When to invoke

Invoke when:

- A Skill loop felt off — looped longer than expected, asked a question that revealed a wrong assumption, produced output that read strangely.
- A subagent's output read wrong — challenge prompts seemed to dodge real risk, evidence rows looked thin, a finding's category felt mis-categorized.
- A halt fired for an unexpected reason — the halt enum value did not seem to capture what actually happened, or the halt felt like it should have been routine.
- A confirmation diff revealed an unstated kernel assumption — the proposed write surfaced something the kernel does not name but probably should.
- Anything else where the engineer wants the transcript window remembered for later review, but cannot stop the current work to write a tech-debt item or an ADR.

Do NOT invoke for:

- Bugs in individual code changes (those are tech-debt items or revisits-change entries).
- Security gaps in a specific change (those are security-review concerns).
- Genuine emergencies — if the situation requires halting, halt and address it directly.

## Inputs

- Optional positional `<hint>` (one word, ≤ 32 characters). Multi-word arguments are truncated to the first whitespace-delimited token with a one-line note. The hint is for the engineer's future audit, not for the analyst.

## Preconditions

- Working directory is a git repository (`git rev-parse --git-dir` succeeds). If not, halt with "not in a git repo — flag only works inside hstack-governed code."
- The consuming repo has at least the `hstack/kernel-fit/flags/pending/` directory writable (the Skill creates it on demand if absent — no halt).
- No status check on any other artifact. The Skill is intentionally orthogonal to the lifecycle state machine; flagging is permitted in any branch, at any time, regardless of in-flight artifacts.

## Orchestration steps

1. **Capture git state.** Run in parallel:
   - `git rev-parse HEAD` → `head`
   - `git rev-parse --abbrev-ref HEAD` → `branch`
   - `pwd` → `workspace`

2. **Resolve the session-id.** Heuristic per ADR-0005 (v2 substrate will replace this with a harness-exposed mechanism):
   - Compute the encoded workspace path: replace `/` with `-` in the absolute cwd path, prefix with `-`. Example: `/Users/jane/code/moso` → `-Users-jane-code-moso`.
   - Glob `~/.claude/projects/<encoded-cwd>/*.jsonl`.
   - If at least one match: pick the most recently modified (`stat -f %m` on macOS, `stat -c %Y` on Linux) and extract its `session-id` from the filename (basename minus `.jsonl`). Set `session-transcript-path` to its absolute path.
   - If zero matches: set `session-id` to `fallback-<short-uuid>` (generate a short random hex), set `session-transcript-path` to the literal string `fallback-cwd:<workspace>` so the analyst can detect the fallback at scan time. Do NOT halt — the pin still has audit value (timestamp + branch + HEAD), and the analyst's `transcript-truncated` classification is the safety net.

3. **Capture pre-compaction message count.** Count lines in `session-transcript-path` if it points at a real jsonl file (`wc -l < <path>`); else set to 0. The analyst compares this to the file's line count at scan-time to detect compaction.

4. **Read and normalize the hint.** If the engineer passed an argument: take the first whitespace-delimited token, truncate to 32 characters, store as `hint`. If multi-word was passed, note in stdout "hint truncated to first token: <hint>". If no argument: `hint: null`.

5. **Compose the pin id.** Format: `flag-<YYYYMMDD>T<HHMMSS>-<session-id-short>` where `<session-id-short>` is the first 4 characters of the session-id (or `fallback-<hex>`). Example: `flag-20260523T143208-a3f9`.

6. **Write the pin.** Ensure `hstack/kernel-fit/flags/pending/` exists (`mkdir -p`); write `<pin-id>.md` with the frontmatter-only content per `template/templates/kernel-fit-flag.md`. The body is intentionally empty (a single HTML comment from the template is acceptable, but no prose).

7. **Confirm to stdout.** Print one line: `📌 pinned at hstack/kernel-fit/flags/pending/<pin-id>.md — kernel-fit will review on next scan.` If the hint was set, mention it. If the session-id fell back, mention it. Exit 0.

## Outputs

- One new file at `hstack/kernel-fit/flags/pending/<pin-id>.md`.
- No git operations. No commits. No subagent invocations. No edits to any other file.

## Auto-commit triggers

None. Pins are gitignored per ADR-0005 (derivative signal, mirroring `.telemetry/` sidecars from ADR-0004). The flag is not a lifecycle event, so the kernel's auto-commit-at-status-transition rule does not apply.

## Idempotency contract

Each invocation produces a new pin with a unique id (timestamp granularity is one second; session-id-short is appended for collision safety across rapid re-flags). Re-running the Skill on the same friction produces a second pin — this is intentional. The analyst processes both and the duplication itself is signal (engineer felt strongly enough to flag twice). The Skill never overwrites or deduplicates.

## Stop conditions

Beyond the kernel's general stop conditions:

- Not inside a git repo. Halt with the explanation above. The Skill is meaningful only inside hstack-governed code where the analyst can correlate the pin to a finding surface.

The Skill explicitly does NOT halt on:

- Missing jsonl under `~/.claude/projects/<encoded-cwd>/` — falls back to `fallback-cwd` and writes the pin anyway.
- Branch mismatch with an in-flight change-spec — flagging is orthogonal to lifecycle.
- A `validate-spec.ts` failure on the pin frontmatter — until the validator ships, FL-01 and FL-02 are advisory only; the pin lands.
- Disk-write failure on the pin file. (If `mkdir -p` or `Write` errors, halt with the OS error — there is nothing useful the Skill can do.)

No halt sentinel is emitted by this Skill in the success path. The success path is a clean exit-0 with the one-line stdout confirmation.

## Failure modes

- **`~/.claude/projects/<encoded-cwd>/` does not exist or is empty.** Fall back as described in step 2; write the pin with `session-transcript-path: fallback-cwd:<workspace>`. The analyst will classify `transcript-truncated` at scan-time.
- **Multiple `.jsonl` files in the encoded directory.** Pick the most recently modified. This is the v1 heuristic; v2 will replace it with a harness-exposed session-id.
- **Engineer flags many times in rapid succession.** Each flag produces a distinct pin (timestamp granularity + session-id-short suffix prevents collisions). The high flag-rate itself becomes signal in the next scan's Slack tail summary.
- **Engineer flags from inside a subagent's session.** The encoded-cwd heuristic resolves to the main-session jsonl (subagents do not get their own jsonl under `~/.claude/projects/`), which is correct — the analyst wants the main session's transcript. No special handling required.
- **Engineer passes a quoted multi-word hint.** Truncate to the first token, note it in stdout, write the pin. Do not halt.

## Anti-patterns

- Never prompt the engineer for a description of the friction. The Skill is one-shot and silent. Asking for prose re-opens the contamination surface the analyst guards against and defeats the zero-friction goal.
- Never invoke a subagent. The pin's value is determined by invocation context; no subagent decision-making is needed.
- Never commit the pin. Pins are gitignored. Committing them would (a) defeat the cadence (every flag becomes a commit), (b) pollute git history with derivative-cache files, and (c) break the gitignore decision recorded in ADR-0005's Decision and Consequences.
- Never edit an existing pin to add context. Pins are immutable from the engineer's perspective; the only legal post-creation writes are by the analyst at processing time. To add context, re-flag in a follow-up turn.
- Never invoke a confirmation gate. The proposed-diff preview rule from the kernel's Mechanical operations section does not apply here because the pin is additive (not a state-machine write) and there is no risk to mitigate: the pin is immutable, gitignored, and out-of-band from every lifecycle gate.
- Never block the conversation on slow operations. The Skill's wall-clock budget is <1s. If `wc -l` against a multi-gigabyte jsonl is too slow, accept an approximate count (the field is for change-detection at scan-time, not exact accounting) — but `wc -l` on jsonl files in practice completes in tens of milliseconds and this concern is theoretical.
- Never escalate a flag into a tech-debt item, ADR, or research session automatically. Promotion is exclusively the analyst's call at scan-time, gated by the engineer via `/hstack:kernel-fit-triage` and `/hstack:kernel-fit-promote`. The Skill is a feeder, not a router.
