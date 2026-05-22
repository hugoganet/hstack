---
name: hstack-kernel-fit-scan
description: |
  Use this skill when the engineer wants to scan for kernel-fit gaps — patterns in shipped practice suggesting the kernel itself (CLAUDE.md, templates, validators, Skill flows) needs revision. The Skill runs the detection layer (`scripts/telemetry/run_kernel_fit.py`), invokes the `kernel-fit-analyst` subagent to synthesize one finding file per fired pattern, then nudges Slack on `high`/`medium` confidence findings with a 14-day dedup gate. Findings land at `hstack/kernel-fit/findings/KF-NNNN-<slug>.md`; the disk artifact is canonical, Slack is a side-channel pointer with graceful degradation when MCP is unwired. Promotion to a kernel change is human-gated via `/hstack:kernel-fit-promote`. See ADR-0003.

  <example>
  Context: The engineer wants a weekly kernel-fit scan after shipping several changes.
  user: "/hstack:kernel-fit-scan"
  assistant: "I'll run the detector against this repo's shipped changes / ADRs / tech-debt / commits / transcripts in the last 30 days. If any pattern fires, I'll invoke `kernel-fit-analyst` to synthesize findings (one file per pattern). Slack nudge on medium/high; dedup against open findings within 14 days. Disk-write is the load-bearing action — if Slack MCP is unreachable, the scan still completes and findings land on disk."
  <commentary>
  The Skill is opt-in by invocation. It is the only Skill that causes the `kernel-fit-analyst` subagent to run. Detection is post-hoc and derivative — no decision-time instrumentation; the no-parallel-tracker rule is preserved because the detector reads, never writes.
  </commentary>
  </example>

  <example>
  Context: The detector returns no fired patterns — the kernel is in good shape against the current corpus.
  user: "/hstack:kernel-fit-scan"
  assistant: "Detection ran; no patterns fired. No findings written, no Slack notification, no commit. The kernel-fit-analyst subagent was not invoked (no work to do). Exit clean."
  <commentary>
  No-fire is the most common output on a healthy repo, especially in the first 4–8 weeks of operation. The Skill must not invoke the subagent or write anything when no pattern fires — every Slack message has a cost in attention, and the dedup gate's purpose is undermined if scans run noise-free but the engineer still sees messages.
  </commentary>
  </example>

  <example>
  Context: KF-P1 fires but an open finding for the same pattern already exists from a scan 5 days ago.
  user: "/hstack:kernel-fit-scan"
  assistant: "KF-P1 fired with 3 evidence rows. An open finding (KF-0003) already exists for KF-P1 from 5 days ago — within the 14-day dedup window. I'll invoke the analyst; if the new evidence is materially equivalent the analyst will skip writing and surface the dedup; if it is materially stronger, the analyst writes a new KF-NNNN and supersedes KF-0003. Either way no Slack message fires today — the engineer was already notified within the window."
  <commentary>
  Dedup happens at two layers: (a) the analyst decides whether to write a new finding or skip (per its supersession carve-out); (b) the Skill decides whether to fire Slack. The 14-day window is the v1 default — tunable when calibration data exists.
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
  - "{{TODO-MCP: Slack — mcp__claude_ai_Slack__slack_send_message — required for kernel-fit notifications. Without it, findings still land on disk; the Skill logs to stderr and exits 0 (deliberate carve-out from the kernel's general MCP-unreachable stop condition — Slack is a side-channel pointer, not authoritative state).}}"
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates kernel-fit-finding frontmatter and KF-01 through KF-05}}"
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

3. **Decide whether to invoke the subagent.** Parse the JSON. If every pattern has `fired: false`, exit clean: print "kernel-fit-scan: no patterns fired in window — kernel is consistent with shipped practice in current corpus" to stdout, write nothing, do not invoke the subagent, do not nudge Slack, do not commit. This is the most common outcome on a healthy repo.

4. **Invoke `kernel-fit-analyst`.** When at least one pattern fired, invoke via Task tool with `subagent_type: kernel-fit-analyst`. The prompt includes (a) the JSON evidence blob verbatim, (b) the canonical reminder of session-isolation (no implementer transcripts loaded), (c) the explicit instruction "one file per fired pattern; mandatory two-bullet counter-explanation; never write outside `hstack/kernel-fit/findings/`". The subagent's writes land in the working tree before the subagent returns.

5. **Stage and commit findings.** Compute the set of newly-written or modified finding files (analyst may have superseded a prior finding atomically with a new one). Print the proposed diff for engineer confirmation (per the kernel's "AI writes, humans confirm" mechanical-operations adaptation). On Y/n confirmation `Y` (default Yes), `git add` the finding files and commit with message `kernel-fit: <N> finding(s) detected` (or `kernel-fit: <N> finding(s) detected, <M> superseded` when supersession edits also landed). One commit per scan run, atomic across all new/edited findings.

6. **Notification — Slack nudge (best-effort).** Compute the notification set:

   ```
   notify = [f for f in newly_written_findings
            if f.confidence in ("high", "medium")
            and not _open_finding_exists_for_pattern_in_window(f.pattern, days=14)]
   ```

   For each finding in `notify`, send a Slack message via `mcp__claude_ai_Slack__slack_send_message` with the canonical body:

   ```
   hstack kernel-fit: <N> new finding(s)

   • KF-NNNN — <title>  [confidence: high|medium]
     Pattern: <KF-P1|KF-P2|KF-P3>
     Kernel surface: <one-line>
     hstack/kernel-fit/findings/KF-NNNN-<slug>.md

   Triage:   /hstack:kernel-fit-triage KF-NNNN --action acknowledge
   Dismiss:  /hstack:kernel-fit-triage KF-NNNN --action dismiss --reason "..."
   Promote:  /hstack:kernel-fit-promote KF-NNNN --slug <adr-slug>
   ```

   Bundle multiple findings into a single message when more than one fires in this scan.

7. **Graceful degradation when Slack is unreachable.** If the MCP call raises (tool not configured, network failure, channel-not-found, etc.), log to stderr: `kernel-fit: Slack MCP unreachable; <N> finding(s) written to disk without notification. Triage via /hstack:help to discover open findings.` Exit 0. The disk write from step 5 is the load-bearing action; Slack is a side-channel pointer. This is a deliberate carve-out from the kernel's general MCP-unreachable stop condition — Slack is not load-bearing for kernel-fit (the canonical state lives on disk and is reachable via `/hstack:help`). The carve-out is documented here and in the kernel's `## How hstack improves itself` section.

8. **Report.** Print to stdout: the count of patterns fired, the count of new findings written, the count of supersessions, the count of Slack notifications fired (or "skipped — Slack unreachable" / "skipped — within dedup window for all findings"). Done.

## Outputs

- Zero or more files at `hstack/kernel-fit/findings/KF-NNNN-<slug>.md` at `status: open`.
- Zero or more supersession edits (status flip + `superseded-by` set) on prior finding files.
- Zero or one git commits.
- Zero or one Slack messages (bundled when multiple findings notify).

## Auto-commit triggers

- One commit at the writing of finding files (per the kernel's auto-commit-at-status-transition rule applied at the artifact-creation moment). No commit when no patterns fire.

## Idempotency contract

- Re-running the Skill when no patterns fire: zero new disk artifacts, no commit, no Slack message. Pure no-op.
- Re-running when patterns fire that already have open findings within the dedup window: the analyst is invoked, sees existing findings, and may skip-write or supersede; Slack notification is suppressed by the dedup gate.
- Re-running when the same patterns fire with new evidence: the analyst may produce supersession edits; the dedup gate still suppresses Slack (already-notified within the window).
- Re-running with `--no-slack`: identical to a run with Slack unreachable — findings land on disk, no Slack message.

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

Slack notifications are opt-in per consumer. Without wiring, the Skill still works — findings land on disk and the engineer discovers them via `/hstack:help`. To enable Slack nudges on `medium`/`high` confidence findings:

1. **Wire the MCP server.** Add the Slack MCP to your Claude Code MCP configuration so `mcp__claude_ai_Slack__slack_send_message` is callable from the session that runs `/hstack:kernel-fit-scan`. Follow Anthropic's Slack MCP install docs; the auth scope `chat:write` is required.

2. **Configure the destination channel.** Add a `kernel-fit` block to `hstack/config.yaml`:

   ```yaml
   kernel-fit:
     slack-channel: "#hstack-kernel-fit"   # public channel id or name; the bot must be invited
     slack-fallback: "dm"                  # "dm" | "off" — behavior when slack-channel is absent or unreachable
   ```

   `slack-channel` is optional. When absent and `slack-fallback: "dm"`, the Skill sends to the invoking engineer's DM via the bot. When `slack-fallback: "off"`, missing channel behaves identically to unreachable MCP (log to stderr, exit 0).

3. **Verify with a dry-run.** Run `/hstack:kernel-fit-scan --no-slack` first to confirm the detection layer produces output on your corpus, then re-run without the flag once Slack is wired. The first non-`--no-slack` run will surface any auth or channel issues as the documented graceful-degradation log line.

What you do NOT need to do: no code to write, no hook to install. The Skill is prose-driven; the runtime LLM agent invokes the MCP when the tool is available in the session and the config names a destination. The `{{TODO-MCP}}` placeholder in the tools array is the framework convention naming the contract — the consumer's MCP wiring satisfies it.

## Anti-patterns

- Never invoke the `kernel-fit-analyst` subagent when no patterns fired. Empty invocations waste tokens and produce nothing.
- Never auto-promote a finding to an ADR. Promotion is a separate, human-invoked Skill (`/hstack:kernel-fit-promote`). The contract is non-negotiable per ADR-0003.
- Never silently retry Slack on transient failure. The disk artifact is canonical; the engineer's `/hstack:help` covers the missed-notification case.
- Never write outside `hstack/kernel-fit/findings/` or modify any artifact not produced by the analyst this run. This Skill orchestrates; it does not author.
- Never claim the analyst's output is measured truth. Frame every finding as LLM-strategized judgment per the kernel's v1 / v2 split rule.
- Never bundle a Slack notification across scan runs. One scan, one message (or zero, when the dedup gate suppresses or Slack is unreachable).
