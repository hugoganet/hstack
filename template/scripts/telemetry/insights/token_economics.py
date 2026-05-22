"""Token-economics insights: TE-1 cost per change, TE-2 cache-hit ratio per
subagent, TE-3 subagent entry-tax amortization."""

from __future__ import annotations

from collections import defaultdict


def compute(session_rows: list[dict], changes: dict) -> dict:
    """Compute the three TE metrics.

    Args:
        session_rows: from transcripts.collect_session_rows
        changes: from frontmatter.load_change_artifacts

    Returns a dict ready for rendering.
    """
    return {
        "te_1_cost_per_change": _te_1(session_rows, changes),
        "te_2_cache_hit_per_subagent": _te_2(session_rows),
        "te_3_subagent_entry_tax": _te_3(session_rows),
    }


def _te_1(session_rows: list[dict], changes: dict) -> dict:
    """TE-1: cost-score per change-spec.

    Best-effort attribution: a session is associated with a change when its skill
    is one of the per-change Skills and any of its user messages mention the
    change-id. We approximate by matching skill∈{change-new, change-plan,
    implement, verify, adversarial-review, ship, finalize, test-plan,
    security-review, data-review, ui-brief, tech-debt-resolve}, then bucket
    unassigned sessions under '(unassigned)'.

    With sidecars present (v2 of this script), TE-1 sharpens by joining sidecar
    change_ids directly. v1 produces a coarse-but-honest ranking.
    """
    per_change_skills = {
        "change-new", "change-plan", "implement", "verify",
        "adversarial-review", "ship", "finalize", "test-plan",
        "security-review", "data-review", "ui-brief",
        "tech-debt-resolve", "tech-debt-new", "tech-debt-wontfix",
        "tech-debt-stale",
    }
    cost_total = defaultdict(int)
    session_counts = defaultdict(int)
    for s in session_rows:
        if s["skill"] in per_change_skills:
            # Heuristic: we don't have a structured change-id-per-session yet,
            # so accumulate by skill until sidecars exist. The (skill, total)
            # ranking is the v1 surface here.
            cost_total[s["skill"]] += s["cost_score"]
            session_counts[s["skill"]] += 1
    rows = []
    for skill, total in sorted(cost_total.items(), key=lambda kv: -kv[1]):
        sessions = session_counts[skill]
        rows.append({
            "skill": skill,
            "sessions": sessions,
            "cost_score_total": total,
            "cost_score_mean": total // sessions if sessions else 0,
        })
    return {
        "rows": rows,
        "note": (
            "v1 attribution is per-Skill, not per-change. Per-change cost will "
            "sharpen once verify.json / finalize.json sidecars carry change_id."
        ),
    }


def _te_2(session_rows: list[dict]) -> dict:
    """TE-2: cache-hit ratio = cache_read / (cache_read + cache_creation) per
    subagent appearance. Without isSidechain attribution we group by the host
    Skill and report per-Skill cache effectiveness — same shape, coarser grain.
    """
    per_skill = defaultdict(lambda: {"cache_read": 0, "cache_creation": 0, "turns": 0})
    for s in session_rows:
        key = s["skill"] or "(non-hstack)"
        t = s["totals"]
        per_skill[key]["cache_read"] += t.get("cache_read_input_tokens", 0)
        per_skill[key]["cache_creation"] += t.get("cache_creation_input_tokens", 0)
        per_skill[key]["turns"] += t.get("turns", 0)
    rows = []
    for skill, agg in sorted(per_skill.items(), key=lambda kv: -(kv[1]["cache_read"] + kv[1]["cache_creation"])):
        denom = agg["cache_read"] + agg["cache_creation"]
        ratio = (agg["cache_read"] / denom) if denom > 0 else None
        rows.append({
            "skill": skill,
            "turns": agg["turns"],
            "cache_read": agg["cache_read"],
            "cache_creation": agg["cache_creation"],
            "ratio": ratio,
        })
    return {"rows": rows}


def _te_3(session_rows: list[dict]) -> dict:
    """TE-3: subagent entry-tax amortization.

    For each subagent type, count invocations and aggregate the host sessions'
    cache_creation (the entry tax is paid as cache_creation on first turn of a
    fresh subagent). Without isSidechain attribution, this is a structural
    proxy: high-cache_creation skills that invoke many subagents are paying
    the entry tax over and over.
    """
    subagent_appearances = defaultdict(int)
    subagent_host_cache_creation = defaultdict(int)
    for s in session_rows:
        for sa in s["subagents"]:
            subagent_appearances[sa] += 1
            subagent_host_cache_creation[sa] += s["totals"].get("cache_creation_input_tokens", 0)
    rows = []
    for sa, count in sorted(subagent_appearances.items(), key=lambda kv: -kv[1]):
        rows.append({
            "subagent": sa,
            "appearances": count,
            "host_cache_creation_total": subagent_host_cache_creation[sa],
            "host_cache_creation_per_invocation": subagent_host_cache_creation[sa] // count if count else 0,
        })
    return {
        "rows": rows,
        "note": (
            "Entry-tax attribution is approximate in v1 (isSidechain=False in "
            "moso-app transcripts means subagent tokens land in the host "
            "session bucket). v2 with sidecars carrying subagent start/end "
            "timestamps will sharpen this."
        ),
    }
