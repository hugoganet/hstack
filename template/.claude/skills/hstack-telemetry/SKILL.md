---
name: hstack-telemetry
description: |
  Use this skill when the engineer wants a retrospective observability report — token economics, workflow shape, quality outcomes, overengineering detection, and contract drift — generated from on-disk artifacts, git history, and Claude Code transcripts. Read-only across every source; no subagents invoked, no LLM turns, safe to run any time.

  <example>
  Context: The engineer wants a weekly health check on the hstack workflow.
  user: "/hstack:telemetry"
  assistant: "I'll run the telemetry report against this repo with a 30-day window. Output lands at `hstack/telemetry/reports/<today>.md`. No subagents, no LLM turns — pure derivation from frontmatter + git + transcripts."
  <commentary>
  Default mode. The Skill shells out to `python hstack/scripts/telemetry/report.py` and reports the output path. The kernel's "no parallel tracker" rule is preserved because the report is derivative — re-runnable from source, never authoritative.
  </commentary>
  </example>

  <example>
  Context: The engineer wants a deeper history window than the default 30 days.
  user: "/hstack:telemetry --window 90"
  assistant: "I'll run the report with a 90-day window. Larger windows surface more contract-drift signal (TD half-life, module-spec staleness) at the cost of slower transcript walks."
  <commentary>
  The Skill passes `--window <N>` through to the underlying script. A window of 0 means all-history; use sparingly on repos with months of transcript data.
  </commentary>
  </example>

tools:
  - Read
  - Bash
  - Glob
---

## Purpose

`hstack-telemetry` produces a retrospective observability report — a markdown file under `hstack/telemetry/reports/` — by parsing on-disk artifacts, git history, and Claude Code transcripts. The Skill is mechanical: it shells out to a Python script, reports the output path, and returns. No subagent is invoked. The kernel's "no parallel tracker" rule is preserved because the report is derivative — re-runnable from source, never authoritative.

The report covers six buckets:

1. **Token economics** — TE-1 cost-score per Skill, TE-2 cache-hit ratio per Skill, TE-3 subagent entry-tax amortization.
2. **Workflow shape** — WS-1 phase duration, WS-2 gate findings density, WS-4 scope-amendment rate, WS-6 halt reasons.
3. **Quality outcomes** — QO-2 severity × resolution-type mix, QO-3 test-immutability audit, QO-4 verifier observed-vs-promised.
4. **Overengineering** — OE-1 artifact tokens per diff line, OE-3 subagent invocations × host cost, OE-5 trivial-eligible changes that ran the full gauntlet.
5. **Contract drift** — module-spec staleness × recent commit activity, ADR supersession lag, tech-debt half-life by exit path.
6. **Kernel-fit candidates** — KF-P1 Category-A claim spans production paths (post-PR-#5 misclassification), KF-P2 halt-reason cluster, KF-P3 missed-gate recovery. Detection-only rollup; the canonical findings live at `hstack/kernel-fit/findings/` and are produced by `/hstack:kernel-fit-scan`. See ADR-0004.

A watch-list at the report bottom surfaces anomalies (low cache-hit Skills, high-severity findings resolved as `justified-in-prose`, candidate test-immutability violations, scope-amendment rate above 30%, module drift, fired kernel-fit patterns).

## When to invoke

Run any time. Common cadence:

- Weekly for active engineering — catches drift early.
- After every ~5 shipped changes — surfaces trend lines that single-change inspection misses.
- Whenever a Skill or subagent has been tuned — confirm the change moved the relevant metric.

The Skill is read-only and idempotent — re-running produces a fresh report at the same path (overwrites the same-day file).

## Inputs

- `--window <N>` (optional): limit git/transcript history to the last N days. Default 30. `--window 0` means all-history.
- `--out <path>` (optional): override the report output path. Default `hstack/telemetry/reports/<YYYY-MM-DD>.md`.

## Preconditions

- The consuming repo has been initialized via `/hstack:init` (at minimum: `hstack/` directory exists).
- Python 3.10+ is available on PATH (the script uses `from __future__ import annotations` and modern typing).
- The git repository is intact (`.git/` present); the Skill walks `git log --all`.

## Orchestration steps

1. **Locate the script.** The Skill resolves `hstack/scripts/telemetry/report.py` relative to the consuming repo's hstack root. If the script is missing, halt with: "telemetry script not found — re-vendor hstack or run `/hstack:configure`".
2. **Shell out.** Invoke `python3 hstack/scripts/telemetry/report.py --repo <repo-root> --window <N>`. Capture stdout/stderr.
3. **Surface the output path.** On success, print the report path and a one-line summary (number of changes, TDs, commits, sessions analyzed — already printed to stderr by the script).
4. **On failure.** Surface the Python traceback. The script is dependency-light (no PyYAML required); failures typically indicate a corrupted artifact or a git repo issue.

## Outputs

- `hstack/telemetry/reports/<YYYY-MM-DD>.md` — the markdown report.
- No frontmatter changes. No commits. The Skill is read-only.

## Auto-commit triggers

None. The Skill is read-only.

## Idempotency contract

Re-running on the same day overwrites the same-day report file. Different windows produce different reports under the same date — last run wins. To preserve a snapshot, copy or rename the file manually.

## Stop conditions

- `hstack/scripts/telemetry/report.py` is missing.
- Python 3 is not available.
- The git repository is corrupt or `.git/` is missing.

## Anti-patterns

- Never claim the telemetry report is authoritative. It is derivative of frontmatter, git, and transcripts — re-runnable from source. The kernel's "no parallel tracker" rule applies.
- Never use the report as an input to a Skill that writes artifacts. It is a retrospective lens, not an in-flight signal.
- Never delete reports to manipulate trend lines. Old reports are git-tracked and can be referenced for retrospective comparison.
- Never propose a v2 "agent-ledger" rebrand of this tool without first running it for at least 3 months and finding the data layer worth promoting.
