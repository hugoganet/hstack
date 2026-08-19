"""Walk Claude Code transcript JSONL files for token economics and halt signals.

Generalized from scripts/audit-token-usage.py. Same cost-score weighting. Adds:
halt-sentinel detection, per-session start/end timestamps, cwd grouping for
Conductor worktree dedup, and (ADR-0009) per-phase usage summation bounded by a
sidecar's phase window.

Session→Skill attribution reads *structured invocation markers only* — the
`<command-name>` tag the harness writes for a slash command, and `Skill`
tool_use blocks. Free text is never matched: a prompt that merely mentions
`/hstack:coord` used to capture the whole session, which credited `coord` with
roughly half of all measured cache-read tokens (ADR-0009 § Context, defect 2).
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from telemetry.session_id import transcript_for_session


PROJECTS_ROOT = Path.home() / ".claude" / "projects"

# Structured markers only. `<command-name>` is emitted by the harness around a
# slash-command invocation; both the `/hstack:foo` and `/hstack-foo` spellings
# appear in real transcripts.
HSTACK_CMD_TAG = re.compile(r"<command-name>/?hstack[:\-]([a-z][a-z0-9\-]*)</command-name>")
# `Skill` tool_use input, optionally namespaced by a plugin prefix.
HSTACK_SKILL_NAME = re.compile(r"^(?:[A-Za-z0-9_.\-]+:)?hstack[:\-]([a-z][a-z0-9\-]*)$")
SUBAGENT_TYPE = re.compile(r'"subagent_type"\s*:\s*"([a-z][a-z0-9\-]*)"')
HALT_SENTINEL = re.compile(r"HSTACK-HALT:\s*reason=([a-z-]+)", re.IGNORECASE)

USAGE_KEYS = ("input_tokens", "cache_creation_input_tokens",
              "cache_read_input_tokens", "output_tokens")


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


def skill_tool_uses(msg) -> list[str]:
    """hstack Skill names invoked via a `Skill` tool_use block in this message.

    Structural walk, not a regex over flattened text: the marker is the block's
    `type`/`name`/`input.skill` triple, which prose cannot forge.
    """
    if not isinstance(msg, dict):
        return []
    content = msg.get("content")
    if not isinstance(content, list):
        return []
    out = []
    for blk in content:
        if not isinstance(blk, dict):
            continue
        if blk.get("type") != "tool_use" or blk.get("name") != "Skill":
            continue
        inp = blk.get("input")
        name = inp.get("skill") if isinstance(inp, dict) else None
        if not isinstance(name, str):
            continue
        m = HSTACK_SKILL_NAME.match(name.strip())
        if m:
            out.append(m.group(1))
    return out


def classify_session(records: list[dict]) -> tuple[str | None, set[str], list[str]]:
    """Return (skill_name, set of subagent types invoked, halt reasons).

    `skill_name` is the first hstack Skill invoked through a structured marker —
    a `<command-name>` tag or a `Skill` tool_use block. A session carrying
    neither returns `None` and is reported as *unattributed* (ADR-0009 piece 3);
    it is never captured by whatever hstack command its prompt happened to name.
    """
    skill = None
    subagents: set[str] = set()
    halts: list[str] = []
    for r in records:
        t = r.get("type")
        if t == "user":
            if skill is None:
                m = HSTACK_CMD_TAG.search(message_text(r.get("message")))
                if m:
                    skill = m.group(1)
        elif t == "assistant":
            msg = r.get("message")
            if skill is None:
                invoked = skill_tool_uses(msg)
                if invoked:
                    skill = invoked[0]
            text = message_text(msg)
            for sa in SUBAGENT_TYPE.findall(text):
                subagents.add(sa)
            for h in HALT_SENTINEL.findall(text):
                halts.append(h.lower())
    return skill, subagents, halts


def parse_ts(value) -> datetime | None:
    """Parse an ISO-8601 stamp to an aware UTC datetime. None on anything else."""
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def session_bounds(records: list[dict]) -> tuple[datetime | None, datetime | None]:
    first = last = None
    for r in records:
        dt = parse_ts(r.get("timestamp"))
        if dt is None:
            continue
        if first is None or dt < first:
            first = dt
        if last is None or dt > last:
            last = dt
    return first, last


def tally_usage(records: list[dict], start: datetime | None = None,
                end: datetime | None = None) -> dict[str, int]:
    """Sum assistant-turn usage. With `start`/`end`, only turns whose timestamp
    falls inside the closed interval are counted."""
    totals: dict[str, int] = defaultdict(int)
    for k in USAGE_KEYS:
        totals[k] = 0
    totals["turns"] = 0
    for r in records:
        if r.get("type") != "assistant":
            continue
        if start is not None or end is not None:
            ts = parse_ts(r.get("timestamp"))
            if ts is None:
                continue
            if start is not None and ts < start:
                continue
            if end is not None and ts > end:
                continue
        usage = (r.get("message") or {}).get("usage") or {}
        for k in USAGE_KEYS:
            totals[k] += usage.get(k, 0) or 0
        totals["turns"] += 1
    return dict(totals)


def phase_usage(sidecar: dict, projects_root: Path | None = None) -> dict | None:
    """Token usage inside one phase window, per ADR-0009 piece 2.

    Reads the transcript named by `sidecar["session_id"]` and sums assistant-turn
    usage over records whose `timestamp` falls in
    `[phase_opened_at, phase_closed_at]`.

    Returns `None` — *unmeasured* — whenever the window cannot be honoured: a
    schema_version-1 sidecar with no window, a null session id, a transcript
    swept by `cleanupPeriodDays` or living on another machine, an unparseable or
    inverted window. Never zero: zero is a measurement, and a phase whose
    transcript is gone was not measured. Read-only; nothing is written.
    """
    if not isinstance(sidecar, dict):
        return None
    opened = parse_ts(sidecar.get("phase_opened_at"))
    closed = parse_ts(sidecar.get("phase_closed_at"))
    if opened is None or closed is None or closed < opened:
        return None
    path = transcript_for_session(sidecar.get("session_id"), projects_root=projects_root)
    if path is None:
        return None
    records = load_session(path)
    if not records:
        return None
    totals = tally_usage(records, start=opened, end=closed)
    total_tokens = sum(totals.get(k, 0) for k in USAGE_KEYS)
    return {
        **totals,
        "total_tokens": total_tokens,
        "cost_score": cost_score(totals),
        "wall_clock_s": (closed - opened).total_seconds(),
        "session_id": sidecar.get("session_id"),
        "transcript": str(path),
    }


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
