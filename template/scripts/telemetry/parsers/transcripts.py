"""Walk Claude Code transcript JSONL files for token economics and halt signals.

Generalized from scripts/audit-token-usage.py. Same cost-score weighting; same
classify-by-Skill heuristic. Adds: halt-sentinel detection, per-session
start/end timestamps, cwd grouping for Conductor worktree dedup.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Iterable


PROJECTS_ROOT = Path.home() / ".claude" / "projects"

HSTACK_SLASH = re.compile(r"/hstack:([a-z][a-z0-9\-]*)")
HSTACK_CMD_TAG = re.compile(r"<command-name>/?hstack:?-?([a-z][a-z0-9\-]*)</command-name>")
SUBAGENT_TYPE = re.compile(r'"subagent_type"\s*:\s*"([a-z][a-z0-9\-]*)"')
HALT_SENTINEL = re.compile(r"HSTACK-HALT:\s*reason=([a-z-]+)", re.IGNORECASE)


def message_text(msg) -> str:
    if msg is None:
        return ""
    if isinstance(msg, str):
        return msg
    content = msg.get("content") if isinstance(msg, dict) else None
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for blk in content:
            if isinstance(blk, dict):
                if blk.get("type") == "text" and isinstance(blk.get("text"), str):
                    parts.append(blk["text"])
                else:
                    parts.append(json.dumps(blk, default=str))
            else:
                parts.append(str(blk))
        return "\n".join(parts)
    return json.dumps(content, default=str)


def discover_transcript_files(repo_paths: Iterable[Path]) -> list[Path]:
    """Discover transcript jsonl files for the given consuming-repo paths.

    Each repo_path corresponds to a Claude Code project dir (`-Users-...` form).
    We accept either real repo paths (we convert) or already-converted prefixes.
    """
    if not PROJECTS_ROOT.exists():
        return []
    prefixes = []
    for p in repo_paths:
        p_str = str(Path(p).resolve()).replace("/", "-")
        prefixes.append(p_str)
        # Also match Conductor worktrees of the repo's basename
        basename = Path(p).name
        prefixes.append(f"-Users-hugoganet-conductor-workspaces-{basename}-")
    files = []
    for d in PROJECTS_ROOT.iterdir():
        if not d.is_dir():
            continue
        name = d.name
        if not any(name.startswith(prefix) or name == prefix.rstrip("-") for prefix in prefixes):
            continue
        for f in d.glob("*.jsonl"):
            files.append(f)
    return files


def load_session(path: Path) -> list[dict]:
    out = []
    try:
        with open(path, "r", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        return []
    return out


def classify_session(records: list[dict]) -> tuple[str | None, set[str], list[str]]:
    """Return (skill_name, set of subagent types invoked, halt reasons)."""
    skill = None
    subagents: set[str] = set()
    halts: list[str] = []
    for r in records:
        t = r.get("type")
        if t == "user" and skill is None:
            text = message_text(r.get("message"))
            m = HSTACK_CMD_TAG.search(text) or HSTACK_SLASH.search(text)
            if m:
                skill = m.group(1)
        elif t == "assistant":
            text = message_text(r.get("message"))
            for sa in SUBAGENT_TYPE.findall(text):
                subagents.add(sa)
            for h in HALT_SENTINEL.findall(text):
                halts.append(h.lower())
    return skill, subagents, halts


def session_bounds(records: list[dict]) -> tuple[datetime | None, datetime | None]:
    first = last = None
    for r in records:
        ts = r.get("timestamp")
        if not ts:
            continue
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            continue
        if first is None or dt < first:
            first = dt
        if last is None or dt > last:
            last = dt
    return first, last


def tally_usage(records: list[dict]) -> dict[str, int]:
    totals: dict[str, int] = defaultdict(int)
    for r in records:
        if r.get("type") != "assistant":
            continue
        usage = (r.get("message") or {}).get("usage") or {}
        for k in ("input_tokens", "cache_creation_input_tokens",
                  "cache_read_input_tokens", "output_tokens"):
            totals[k] += usage.get(k, 0) or 0
        totals["turns"] += 1
    return dict(totals)


def cost_score(totals: dict[str, int]) -> int:
    """Same weighting as scripts/audit-token-usage.py: input + 1.25*cache_creation
    + 0.10*cache_read + 5*output. Approximates billable $-weight for ranking."""
    return (
        totals.get("input_tokens", 0)
        + int(totals.get("cache_creation_input_tokens", 0) * 1.25)
        + int(totals.get("cache_read_input_tokens", 0) * 0.10)
        + totals.get("output_tokens", 0) * 5
    )


def collect_session_rows(repo_paths: Iterable[Path], since: datetime | None = None) -> list[dict]:
    """Walk every transcript for the given repos and return one row per session."""
    out = []
    for f in discover_transcript_files(repo_paths):
        recs = load_session(f)
        if not recs:
            continue
        skill, subagents, halts = classify_session(recs)
        first, last = session_bounds(recs)
        if since is not None and last is not None and last < since:
            continue
        totals = tally_usage(recs)
        if totals.get("turns", 0) == 0:
            continue
        out.append({
            "file": f,
            "project_dir": f.parent.name,
            "skill": skill,
            "subagents": sorted(subagents),
            "halt_reasons": halts,
            "started_at": first,
            "ended_at": last,
            "totals": totals,
            "cost_score": cost_score(totals),
        })
    return out
