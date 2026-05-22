"""Overengineering insights: OE-1 artifact/diff ratio, OE-3 context-load ×
invocations × downstream-refs, OE-5 trivial-eligible that ran the gauntlet."""

from __future__ import annotations

from collections import defaultdict

from telemetry.parsers.bodies import approx_token_count
from telemetry.parsers.commits import diff_line_count


def compute(commits: list[dict], changes: dict, session_rows: list[dict], repo) -> dict:
    return {
        "oe_1_artifact_to_diff_ratio": _oe_1(changes, commits, repo),
        "oe_3_subagent_context_load_amortization": _oe_3(session_rows, changes),
        "oe_5_trivial_eligible_full_gauntlet": _oe_5(changes, commits),
    }


def _oe_1(changes: dict, commits: list[dict], repo) -> dict:
    """OE-1: artifact tokens / code-diff lines.

    Sums artifact-body token counts (approx 4 chars/token) per change, divides
    by total diff lines on implement(<change-id>) commits for that change.
    Ratio above ~50 is a strong overengineering signal; below ~5 the change is
    likely under-specified for its complexity.
    """
    rows = []
    for cid, arts in sorted(changes.items()):
        artifact_tokens = 0
        for atype, data in arts.items():
            artifact_tokens += approx_token_count(data["body"])
        # Sum implement-commit diffs for this change.
        diff_lines = 0
        for c in commits:
            if c["artifact_type"] != "implement" or c["artifact_id"] != cid:
                continue
            added, removed = diff_line_count(repo, c["sha"])
            diff_lines += added + removed
        ratio = (artifact_tokens / diff_lines) if diff_lines > 0 else None
        rows.append({
            "change": cid,
            "artifact_tokens": artifact_tokens,
            "diff_lines": diff_lines,
            "tokens_per_diff_line": round(ratio, 1) if ratio is not None else None,
        })
    rows.sort(key=lambda r: r["tokens_per_diff_line"] or 0, reverse=True)
    return {"rows": rows}


def _oe_3(session_rows: list[dict], changes: dict) -> dict:
    """OE-3: per subagent, invocations × estimated context-load size.

    Without sidecars to attribute downstream-reference-count, this v1 metric
    surfaces just the subagent × invocation-count × cost dimension and lets
    the reader eyeball which subagents are paying repeated entry-tax.
    """
    appearances = defaultdict(int)
    total_cost_in_host = defaultdict(int)
    for s in session_rows:
        for sa in s["subagents"]:
            appearances[sa] += 1
            total_cost_in_host[sa] += s["cost_score"]
    rows = []
    for sa, n in sorted(appearances.items(), key=lambda kv: -kv[1]):
        rows.append({
            "subagent": sa,
            "invocations": n,
            "host_cost_score_total": total_cost_in_host[sa],
            "cost_per_invocation": total_cost_in_host[sa] // n if n else 0,
        })
    return {"rows": rows}


def _oe_5(changes: dict, commits: list[dict]) -> dict:
    """OE-5: trivial-eligible changes that ran the full gauntlet.

    Heuristic: change-spec at `shipped` (or any terminal state) with `trivial:
    false`, empty `surfaces`, zero or one invariant. These are candidates that
    might have qualified for the trivial-tag escape hatch but ran every gate.
    """
    candidates = []
    for cid, arts in sorted(changes.items()):
        spec = arts.get("change-spec")
        if not spec:
            continue
        fm = spec["fm"]
        if fm.get("trivial") is True:
            continue
        status = fm.get("status")
        if status not in ("shipped", "ready-to-ship", "archived"):
            continue
        surfaces = fm.get("surfaces") or []
        if surfaces:  # any declared surface disqualifies trivial-eligibility
            continue
        # diff size heuristic: a "trivial-eligible" change usually has <50 added lines
        diff_total = 0
        for c in commits:
            if c["artifact_type"] == "implement" and c["artifact_id"] == cid:
                # We can't get accurate line counts here without git access — use file count proxy
                diff_total += len(c.get("files", []))
        candidates.append({
            "change": cid,
            "status": status,
            "surfaces": surfaces,
            "files_touched_in_implement_commits": diff_total,
        })
    return {
        "rows": candidates,
        "note": (
            "Heuristic only. A change with empty `surfaces` AND no `trivial: "
            "true` tag is a candidate for retrospective trivial classification "
            "— or a sign the surfaces list was under-declared."
        ),
    }
