---
name: hstack-kernel-fit-scan
description: Use to detect kernel-fit gaps — patterns in shipped practice suggesting the kernel itself needs revision — and synthesize one finding file per fired pattern. The first step of the kernel-fit loop; triage and promotion are separate Skills.
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
  - "{{TODO-MCP: Slack — mcp__claude_ai_Slack__slack_send_message — required for kernel-fit notifications. Without it, findings still land on disk; the Skill logs to stderr and exits 0 (deliberate carve-out from the kernel's general MCP-unreachable stop condition — Slack is a side-channel pointer, not authoritative state).}}"
  - "node hstack/scripts/validate-spec.mjs — validates kernel-fit-finding frontmatter and KF-01 through KF-05"
---

## Purpose

`hstack-kernel-fit-scan` is the entry point to the kernel-fit closed-loop system. The Skill orchestrates four steps: detection (Python script, pure read), synthesis (`kernel-fit-analyst` subagent, one file per fired pattern), notification (Slack, best-effort), and the atomic commit. Promotion to a kernel change is a separate, human-invoked Skill (`/hstack:kernel-fit-promote`).

The Skill is the only path by which the `kernel-fit-analyst` subagent runs. The kernel's "AI writes, humans confirm" contract is preserved at the kernel-modification layer because the analyst writes findings only — never ADRs, never change-specs, never kernel edits.

## When to invoke

Common cadence:

- Weekly for active engineering — catches kernel-vs-practice drift early.
- After every ~5 shipped changes — surfaces patterns single-change inspection cannot.
- After a kernel edit lands — confirm the edit moved the relevant pattern off the fired list (or did not introduce a new one).
- Whenever a `kernel-fit-analyst` finding is restated or superseded by triage, to let the analyst write the supersession edit atomically.

The Skill is opt-in. There is no cron, no automatic invocation, no event-driven trigger in v1.

## Inputs

- `--window <N>` (optional): limit detector history to the last N days. Default 30. `--window 0` means all-history.
- `--no-slack` (optional): skip the Slack notification step even if MCP is wired. Useful for dry-runs or for replaying a scan when the engineer has already been notified manually.

## Preconditions

- `hstack/config.yaml` exists at `init-status: complete`. If init is incomplete, halt with `HSTACK-HALT: reason=missing-context`.
- The wrapper script `hstack/scripts/telemetry/run_kernel_fit.py` exists. If missing, halt with `HSTACK-HALT: reason=missing-context` and the recommendation "re-vendor hstack or run `/hstack:configure`".
- The repo contains at least 3 shipped change-specs (count by `status: shipped` across `hstack/specs/changes/*/spec.md`). Below this threshold, the corpus is too small for cross-correlation; the Skill halts with a one-line note: "kernel-fit scan needs ≥3 shipped changes; corpus is too small to produce honest evidence."
- Python 3.10+ is available on PATH (matches `hstack-telemetry`).
- The git repository is intact (`.git/` present).

## Orchestration steps

1. **Verify preconditions.** Walk the checks above; halt with the named reason if any fail. Print "kernel-fit-scan: preconditions OK, N shipped changes in corpus, M-day window" to stderr.

2. **Run detection.** Shell out: `python3 hstack/scripts/telemetry/run_kernel_fit.py --repo <repo-root> --window <N>`. Capture stdout as JSON; capture stderr as the diagnostic log. On non-zero exit, surface the traceback and halt with `HSTACK-HALT: reason=missing-context`.

3. **Enumerate pending engineer flags.** Glob `hstack/kernel-fit/flags/pending/*.md`. Capture the list (may be empty). The analyst processes these per ADR-0005's Pending Flags Processing loop documented in `template/.claude/agents/kernel-fit-analyst.md`; this Skill is responsible for surfacing the list to the analyst and for the post-analyst pin-file moves at step 5.

4. **Decide whether to invoke the subagent.** Parse the detector JSON. If every pattern has `fired: false` **and** no pending flags exist, exit clean: print "kernel-fit-scan: no patterns fired in window, no pending flags — kernel is consistent with shipped practice in current corpus" to stdout, write nothing, do not invoke the subagent, do not nudge Slack, do not commit. If patterns fired OR pending flags exist (or both), proceed to step 5.

5. **Invoke `kernel-fit-analyst`.** Invoke via Task tool with `subagent_type: kernel-fit-analyst`. The prompt includes (a) the JSON evidence blob verbatim, (b) the list of pending flag paths from step 3 (or "no pending flags" when empty), (c) the canonical reminder of session-isolation (no implementer transcripts loaded), (d) the explicit instruction "one file per fired pattern; mandatory two-bullet counter-explanation; never write outside `hstack/kernel-fit/findings/`; process pending flags per the Pending Flags Processing section of the analyst prompt". The subagent's writes land in the working tree before the subagent returns. The analyst's response object reports the flag-processing counts (`processed`, `folded`, `emitted`, `not_actionable`, `transcript_truncated`).

6. **Move processed pin files.** For each pin the analyst updated to `status: processed`, `git mv hstack/kernel-fit/flags/pending/<pin>.md hstack/kernel-fit/flags/processed/<pin>.md`. Create the `processed/` directory if missing. This move lands in the same commit as the finding writes at step 7 — the analyst's pin frontmatter updates (classification, classification-rationale, folded-into, emitted-as, status) plus the file move must be atomic from git's perspective. **Note**: pin files are gitignored per ADR-0005, so `git mv` operates only on the filesystem (git will not stage either side). The "atomicity" here is filesystem-only — the analyst's in-place frontmatter update and the directory move complete together before stdout reports flag-processing counts. If the gitignore is later relaxed (would require an ADR amendment), this step's `git mv` becomes a real staged operation.

7. **Stage and commit findings.** Compute the set of newly-written or modified finding files (analyst may have superseded a prior finding atomically with a new one, or appended evidence rows to existing findings via fold). Print the proposed diff for engineer confirmation (per the kernel's "AI writes, humans confirm" mechanical-operations adaptation). On Y/n confirmation `Y` (default Yes), `git add` the finding files and commit with message `kernel-fit: <N> finding(s) detected` (or `kernel-fit: <N> finding(s) detected, <M> superseded` when supersession edits landed; or `kernel-fit: <N> finding(s) detected (<F> from flags), <M> superseded` when flag-emit landed). One commit per scan run, atomic across all new/edited findings. When patterns did not fire and only pending flags were processed, the commit message reads `kernel-fit: <F> flag(s) processed (<E> emit, <FF> fold, <NA> not-actionable, <TT> transcript-truncated)`.

8. **Notification — Slack nudge (best-effort).** Compute the notification set:

   ```
   notify = [f for f in newly_written_findings
            if f.confidence in ("high", "medium")
            and not _open_finding_exists_for_pattern_in_window(f.pattern, days=14)]
   ```

   For each finding in `notify`, send a Slack message via `mcp__claude_ai_Slack__slack_send_message` with the canonical body:

   ```
   hstack kernel-fit: <N> new finding(s)

   • KF-NNNN — <title>  [confidence: high|medium] [via: detector|flag]
     Pattern: <KF-P1|KF-P2|KF-P3|KF-FLAG-NNNN>
     Kernel surface: <one-line>
     hstack/kernel-fit/findings/KF-NNNN-<slug>.md

   Triage:   /hstack:kernel-fit-triage KF-NNNN --action acknowledge
   Dismiss:  /hstack:kernel-fit-triage KF-NNNN --action dismiss --reason "..."
   Promote:  /hstack:kernel-fit-promote KF-NNNN --slug <adr-slug>
   ```

   Bundle multiple findings into a single message when more than one fires in this scan. When flag-processing occurred, append the **flag tail summary** as the last line of the same Slack message:

   ```
   Flags processed: <P> total — <FF> folded, <E> emitted, <NA> not-actionable, <TT> transcript-truncated.
   ```

   The tail is included only when at least one pin was processed AND at least one of `folded` or `emitted` is non-zero, OR when `transcript_truncated > 0` (the transcript-truncated count is operationally interesting because it surfaces v1-heuristic edge cases the engineer should know about). When every processed pin was classified `not-actionable` the tail is suppressed — it would otherwise be pure noise. When the scan produces zero detector findings AND only `not-actionable` pin processing, the Slack message is suppressed entirely (no findings, no tail-worthy signal).

9. **Graceful degradation when Slack is unreachable.** If the MCP call raises (tool not configured, network failure, channel-not-found, etc.), log to stderr: `kernel-fit: Slack MCP unreachable; <N> finding(s) written to disk without notification. <P> flag(s) processed; triage via /hstack:help to discover open findings.` Exit 0. The disk write from step 7 is the load-bearing action; Slack is a side-channel pointer. This is a deliberate carve-out from the kernel's general MCP-unreachable stop condition — Slack is not load-bearing for kernel-fit (the canonical state lives on disk and is reachable via `/hstack:help`). The carve-out is documented here and in the kernel's `## How hstack improves itself` section.

10. **Report.** Print to stdout: the count of patterns fired, the count of new findings written, the count of supersessions, the count of flags processed broken down by classification (`folded`, `emitted`, `not-actionable`, `transcript-truncated`), and the count of Slack notifications fired (or "skipped — Slack unreachable" / "skipped — within dedup window for all findings" / "skipped — no signal worth surfacing"). Done.

## Outputs

- Zero or more files at `hstack/kernel-fit/findings/KF-NNNN-<slug>.md` at `status: open`.
- Zero or more supersession edits (status flip + `superseded-by` set) on prior finding files.
- Zero or more evidence-row appends to existing findings (from flag fold).
- Zero or more pin transitions from `hstack/kernel-fit/flags/pending/` to `hstack/kernel-fit/flags/processed/` with `status: processed` and the analyst-owned classification fields populated. Pins are gitignored per ADR-0005, so the moves are filesystem-only — not staged in git.
- Zero or one git commits (covering finding writes only; pin moves are not staged).
- Zero or one Slack messages (bundled when multiple findings notify, with the flag tail summary appended when applicable).

## Auto-commit triggers

- One commit at the writing of finding files (per the kernel's auto-commit-at-status-transition rule applied at the artifact-creation moment). No commit when no patterns fire AND no flag-emit or flag-fold landed (i.e., only `not-actionable` / `transcript-truncated` flag processing occurred). Pin file moves are filesystem-only (pins are gitignored) and do not require a commit.

## Idempotency contract

- Re-running the Skill when no patterns fire AND no pending flags exist: zero new disk artifacts, no commit, no Slack message. Pure no-op.
- Re-running when no patterns fire but pending flags exist: the analyst is invoked to process flags only. Outcomes depend on classification — fold/emit may produce finding writes and a commit; not-actionable/transcript-truncated produce only pin moves (no commit).
- Re-running when patterns fire that already have open findings within the dedup window: the analyst is invoked, sees existing findings, and may skip-write or supersede; Slack notification is suppressed by the dedup gate.
- Re-running when the same patterns fire with new evidence: the analyst may produce supersession edits; the dedup gate still suppresses Slack (already-notified within the window).
- Re-running with `--no-slack`: identical to a run with Slack unreachable — findings land on disk, flags are processed normally, no Slack message.
- Re-running after pending flags were processed in a prior scan: the prior pins are now in `processed/` and the analyst is forbidden from re-processing them (per the kernel-fit-analyst's discipline rules). Only newly-flagged pins (added to `pending/` since the last scan) are processed this run.

## Stop conditions

Beyond the kernel's general stop conditions:

- Init is incomplete or `run_kernel_fit.py` is missing (`HSTACK-HALT: reason=missing-context`).
- Corpus is below the 3-shipped-changes floor — halt with the one-line note above.
- Detector script exits non-zero or produces malformed JSON — halt with the traceback and `HSTACK-HALT: reason=missing-context`.
- The `kernel-fit-analyst` subagent halts mid-run — propagate the halt sentinel; do not commit partial output (the analyst's writes-so-far remain unstaged on disk; the engineer can either delete them or re-invoke the Skill which will see them on next run).
- The proposed-diff confirmation at step 5 is declined — abort the commit; the analyst's writes-so-far remain in the working tree. Re-invoke to continue.

Slack-MCP-unreachable is NOT a stop condition. See step 7.

## Failure modes

- **Detector raises on malformed frontmatter in a shipped change-spec.** The detector is read-only and tolerant of missing fields; the parser falls back to a degraded YAML reader. If a corrupted frontmatter file genuinely crashes the parser, the traceback names the offending file — fix it and re-run.
- **Subagent produces a finding without two counter-explanations.** The analyst auto-downgrades `confidence: low` per KF-03; the finding still lands on disk but does not nudge Slack. No remediation needed — this is the designed behavior.
- **Subagent writes a finding outside `hstack/kernel-fit/findings/`.** Scope-lock violation. The subagent's prompt forbids this at every Write call. If observed, surface as a kernel-fit-analyst contract violation and do not commit; report the offending path for diagnosis.
- **Slack message rejected by the MCP server (rate limit, channel-not-found, auth error).** Same as MCP unreachable — log to stderr, exit 0, the engineer triages via `/hstack:help` on next session.

## Configuring Slack notifications (consumer-side)

One-time consumer setup, not scan-time reading. The full procedure — MCP wiring and the `chat:write` scope, the `kernel-fit` block in `hstack/config.yaml` (`slack-channel`, `slack-fallback`), and the `--no-slack` dry-run — lives in `references/slack-setup.md` alongside this file.

Read that file only when the engineer is wiring Slack for the first time, or when a run reported a Slack auth / channel / destination problem. Do not read it on a normal scan: Slack is opt-in, the disk artifact is canonical, and an unwired or unreachable Slack is not a stop condition (step 7).

## Anti-patterns

- Never invoke the `kernel-fit-analyst` subagent when no patterns fired. Empty invocations waste tokens and produce nothing.
- Never auto-promote a finding to an ADR. Promotion is a separate, human-invoked Skill (`/hstack:kernel-fit-promote`). The contract is non-negotiable per ADR-0004.
- Never silently retry Slack on transient failure. The disk artifact is canonical; the engineer's `/hstack:help` covers the missed-notification case.
- Never write outside `hstack/kernel-fit/findings/` or modify any artifact not produced by the analyst this run. This Skill orchestrates; it does not author.
- Never claim the analyst's output is measured truth. Frame every finding as LLM-strategized judgment per the kernel's v1 / v2 split rule.
- Never bundle a Slack notification across scan runs. One scan, one message (or zero, when the dedup gate suppresses or Slack is unreachable).
- Never re-process a pin already in `hstack/kernel-fit/flags/processed/`. The analyst's discipline rule (no re-processing) is mirrored here: the Skill globs only `pending/`, never `processed/`. If the engineer believes a processed pin was mis-classified, the path is to re-flag (creating a fresh pin), not to move the prior pin back.
- Never include the flag tail summary in the Slack message when every pin was classified `not-actionable`. The tail's purpose is to surface actionable signal — the all-not-actionable case is pure noise and the suppression is deliberate.
- Never commit a pin move. Pins are gitignored per ADR-0005; the `git mv` from `pending/` to `processed/` is filesystem-only and produces no staged change.
