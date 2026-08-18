#!/usr/bin/env python3
"""Resolve the active Claude Code session id — the one heuristic, in one place.

Per ADR-0009 § Neutral: `/hstack:flag` resolved the session id inline in its own
prose; the five sidecar-emitting Skills would have duplicated that prose a sixth
time. They call this module instead.

The heuristic (unchanged from ADR-0005): Claude Code writes one `*.jsonl`
transcript per session under `~/.claude/projects/<encoded-cwd>/`, where
`<encoded-cwd>` is the absolute working directory with `/` replaced by `-`. The
most recently modified file in that directory is the active session; the session
id is its basename.

Both the heuristic and the transcript layout are harness implementation details,
not a contract (ADR-0009 § Negative). Every failure mode resolves to
`session_id: null` — never a guess, never a halt. A null session id means the
phase reports as *unmeasured*, which is the whole point of the null-not-zero
rule.

CLI:
    python3 scripts/telemetry/session_id.py            # JSON on stdout, always exit 0
    python3 scripts/telemetry/session_id.py --cwd DIR  # resolve for another dir

Output:
    {"session_id": "062b8fe8-…" | null,
     "transcript_path": "/Users/…/062b8fe8-….jsonl" | null,
     "message_count": 1423,
     "source": "transcript" | "unresolved",
     "fallback_id": "a3f9c1d2",
     "now": "2026-08-15T09:12:44Z"}

`now` is the UTC stamp at resolution time, so a Skill opening a phase gets its
`session_id` and its `phase_opened_at` from one call. `fallback_id` is short
random hex for callers that need a non-null id anyway (`/hstack:flag` writes
`fallback-<id>`); sidecar emitters ignore it and write `null`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


PROJECTS_ROOT = Path.home() / ".claude" / "projects"


def encoded_cwd(cwd: Path | str | None = None) -> str:
    """`/Users/jane/code/moso` → `-Users-jane-code-moso`."""
    p = Path(cwd) if cwd is not None else Path.cwd()
    return str(p.resolve()).replace("/", "-")


def project_dir(cwd: Path | str | None = None, projects_root: Path | None = None) -> Path:
    root = projects_root or PROJECTS_ROOT
    return root / encoded_cwd(cwd)


def utc_now_iso() -> str:
    """ISO-8601 UTC, second precision, `Z` suffix — the sidecar timestamp format."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def resolve_session(cwd: Path | str | None = None,
                    projects_root: Path | None = None) -> dict:
    """Resolve the active session for `cwd`. Never raises; never halts."""
    out = {
        "session_id": None,
        "transcript_path": None,
        "message_count": 0,
        "source": "unresolved",
        "fallback_id": os.urandom(4).hex(),
        "now": utc_now_iso(),
    }
    d = project_dir(cwd, projects_root)
    try:
        candidates = [f for f in d.glob("*.jsonl") if f.is_file()]
    except OSError:
        return out
    if not candidates:
        return out
    try:
        newest = max(candidates, key=lambda f: f.stat().st_mtime)
    except OSError:
        return out
    out["session_id"] = newest.stem
    out["transcript_path"] = str(newest)
    out["source"] = "transcript"
    out["message_count"] = _count_lines(newest)
    return out


def _count_lines(path: Path) -> int:
    try:
        with open(path, "rb") as fh:
            return sum(1 for _ in fh)
    except OSError:
        return 0


def transcript_for_session(session_id: str | None,
                           projects_root: Path | None = None) -> Path | None:
    """Locate a transcript by session id, across every project directory.

    The sidecar carries the session id, not the path: a Conductor worktree can be
    renamed or removed between the write and the read, and the encoded-cwd
    directory with it. Returns None when no transcript is found — retention
    sweep, another machine, or a harness layout change. None means *unmeasured*.
    """
    if not session_id or not isinstance(session_id, str):
        return None
    if session_id.startswith("fallback-"):
        return None
    root = projects_root or PROJECTS_ROOT
    if not root.is_dir():
        return None
    for d in sorted(root.iterdir()):
        if not d.is_dir():
            continue
        candidate = d / f"{session_id}.jsonl"
        if candidate.is_file():
            return candidate
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Resolve the active Claude Code session id.")
    parser.add_argument("--cwd", type=Path, default=None,
                        help="Directory to resolve for (default: current working directory).")
    args = parser.parse_args(argv)
    print(json.dumps(resolve_session(args.cwd), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
