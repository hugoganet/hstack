#!/usr/bin/env python3
"""Run the kernel-fit detection layer in isolation and dump JSON to stdout.

Thin wrapper around `telemetry.insights.kernel_fit.compute()`. Used by
`/hstack:kernel-fit-scan` to obtain the structured evidence blob the
`kernel-fit-analyst` subagent consumes, without producing the full
telemetry report.

Usage:
    python scripts/telemetry/run_kernel_fit.py [--repo <path>] [--window <days>]

Defaults match `report.py`: `--repo` is cwd; `--window` is 30 days.

The output is a single JSON object whose top-level keys mirror the
`compute()` return value (`existing_open_findings_by_pattern`, and one
key per pattern). The scan Skill reads stdout, parses, and passes the
blob to the subagent.

Read-only. No writes, no git side-effects.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Match report.py's import-path bootstrap so this script can be invoked
# from any directory.
_THIS = Path(__file__).resolve()
_SCRIPTS = _THIS.parent.parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from telemetry.parsers import frontmatter, commits, transcripts  # noqa: E402
from telemetry.insights import kernel_fit  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run kernel-fit detection and dump JSON.")
    parser.add_argument("--repo", type=Path, default=Path.cwd(),
                        help="Consuming-repo root (default: cwd).")
    parser.add_argument("--window", type=int, default=30,
                        help="Limit git/transcript history to last N days (default: 30; 0 = all).")
    args = parser.parse_args(argv)

    repo = args.repo.resolve()
    hstack_root = repo / "hstack"
    if not hstack_root.is_dir():
        # Permit running against the template repo itself.
        if (repo / "specs").is_dir() and (repo / "CLAUDE.md").is_file():
            hstack_root = repo
        else:
            print(f"error: no hstack/ directory at {repo}", file=sys.stderr)
            return 1

    window_days: int | None = args.window if args.window > 0 else None
    since_dt: datetime | None = (
        datetime.now(timezone.utc) - timedelta(days=window_days)
    ) if window_days else None

    changes = frontmatter.load_change_artifacts(hstack_root)
    tech_debt = frontmatter.load_tech_debt(hstack_root)
    adrs = frontmatter.load_adrs(hstack_root)
    module_specs = frontmatter.load_module_specs(hstack_root)
    git_commits = commits.parse_commits(repo, since_days=window_days)
    session_rows = transcripts.collect_session_rows([repo], since=since_dt)

    findings_dir = hstack_root / "kernel-fit" / "findings"

    result = kernel_fit.compute(
        commits=git_commits,
        changes=changes,
        tech_debt=tech_debt,
        adrs=adrs,
        module_specs=module_specs,
        session_rows=session_rows,
        findings_dir=findings_dir,
    )

    # Path objects are not JSON-serializable; strip them where they appear
    # (existing-findings paths get re-derived by the analyst from the id).
    json.dump(result, sys.stdout, default=str, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
