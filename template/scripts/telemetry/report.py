#!/usr/bin/env python3
"""hstack-telemetry — generate the retrospective report.

Usage:
    python scripts/telemetry/report.py [--repo <path>] [--window <days>] [--out <path>]

Defaults:
    --repo   : the current working directory
    --window : 30 (days)
    --out    : <repo>/hstack/telemetry/reports/<YYYY-MM-DD>.md

The report reads:
    - hstack/specs/changes/*/  (every change artifact)
    - hstack/tech-debt/*.md
    - hstack/adr/*.md
    - hstack/specs/<module>/spec.md
    - git log of the repo (auto-commit patterns)
    - ~/.claude/projects/-<repo-path>-*/*.jsonl  (Claude Code transcripts)

Nothing is written outside the report file. All read paths are local; no
network calls.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# Ensure the parent (`scripts/`) is importable so `telemetry.*` resolves the
# same way whether run from the repo root or from elsewhere.
_THIS = Path(__file__).resolve()
_SCRIPTS = _THIS.parent.parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from telemetry.parsers import frontmatter, commits, transcripts  # noqa: E402
from telemetry.insights import (  # noqa: E402
    token_economics, workflow_shape, quality_outcomes,
    overengineering, contract_drift, kernel_fit,
)
from telemetry import render  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate hstack-telemetry report.")
    parser.add_argument("--repo", type=Path, default=Path.cwd(),
                        help="Consuming-repo root (default: cwd).")
    parser.add_argument("--window", type=int, default=30,
                        help="Limit git/transcript history to last N days (default: 30; 0 = all).")
    parser.add_argument("--out", type=Path, default=None,
                        help="Output report path (default: <repo>/hstack/telemetry/reports/<today>.md).")
    args = parser.parse_args(argv)

    repo = args.repo.resolve()
    hstack_root = repo / "hstack"
    if not hstack_root.is_dir():
        # Permit running against the template repo itself (no hstack/ prefix).
        # CLAUDE.md is the pre-ADR-0010 kernel name — still accepted so an
        # un-migrated tree keeps reporting.
        if (repo / "specs").is_dir() and (
            (repo / "KERNEL.md").is_file() or (repo / "CLAUDE.md").is_file()
        ):
            hstack_root = repo
        else:
            print(f"error: no hstack/ directory at {repo}", file=sys.stderr)
            return 1

    window_days: int | None = args.window if args.window > 0 else None
    since_dt: datetime | None = (
        datetime.now(timezone.utc) - timedelta(days=window_days)
    ) if window_days else None

    print(f"telemetry: reading {hstack_root}", file=sys.stderr)
    changes = frontmatter.load_change_artifacts(hstack_root)
    tech_debt = frontmatter.load_tech_debt(hstack_root)
    adrs = frontmatter.load_adrs(hstack_root)
    module_specs = frontmatter.load_module_specs(hstack_root)
    print(f"telemetry: {len(changes)} changes, {len(tech_debt)} TDs, "
          f"{len(adrs)} ADRs, {len(module_specs)} module-specs", file=sys.stderr)

    print("telemetry: walking git history…", file=sys.stderr)
    git_commits = commits.parse_commits(repo, since_days=window_days)
    print(f"telemetry: {len(git_commits)} commits in window", file=sys.stderr)

    print("telemetry: walking Claude Code transcripts…", file=sys.stderr)
    session_rows = transcripts.collect_session_rows([repo], since=since_dt)
    print(f"telemetry: {len(session_rows)} sessions in window", file=sys.stderr)

    findings_dir = hstack_root / "kernel-fit" / "findings"
    metrics = {
        "token_economics": token_economics.compute(session_rows, changes),
        "workflow_shape": workflow_shape.compute(git_commits, changes, session_rows),
        "quality_outcomes": quality_outcomes.compute(git_commits, changes),
        "overengineering": overengineering.compute(git_commits, changes, session_rows, repo),
        "contract_drift": contract_drift.compute(git_commits, changes, tech_debt, adrs, module_specs),
        "kernel_fit": kernel_fit.compute(git_commits, changes, tech_debt, adrs, module_specs,
                                         session_rows, findings_dir),
    }

    report_md = render.render_report(metrics, repo_name=repo.name, window_days=window_days)

    out_path = args.out
    if out_path is None:
        out_dir = hstack_root / "telemetry" / "reports"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{date.today().isoformat()}.md"
    else:
        out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report_md, encoding="utf-8")

    # Structured twin of the markdown report — same metrics dict, machine-readable.
    # Consumed by the telemetry UI; carries the same derivative-only guarantee.
    json_path = out_path.with_suffix(".json")
    payload = {
        "schema_version": 1,
        "repo": repo.name,
        "generated": date.today().isoformat(),
        "window_days": window_days,
        "counts": {
            "changes": len(changes),
            "tech_debt": len(tech_debt),
            "adrs": len(adrs),
            "module_specs": len(module_specs),
            "commits": len(git_commits),
            "sessions": len(session_rows),
        },
        "watch_list": render.watch_items(metrics),
        "metrics": metrics,
    }
    json_path.write_text(json.dumps(payload, indent=1, default=str), encoding="utf-8")

    print(f"telemetry: report written to {out_path}", file=sys.stderr)
    print(f"telemetry: json written to {json_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
