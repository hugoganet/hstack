"""Token-economics insights: TE-1 cost per Skill, TE-2 cache-hit ratio per
subagent, TE-3 subagent entry-tax amortization, TE-4 cost per phase, TE-5 cost
per change (ADR-0009).

TE-1/TE-2/TE-3 are *session-scoped*: they attribute a whole session to the first
Skill it invoked, because a Skill has a start marker and no end marker. TE-4/TE-5
are *phase-scoped*: they read the sidecar's `[phase_opened_at, phase_closed_at]`
window and sum only the turns inside it. Where a sidecar exists, TE-4/TE-5
supersede TE-1.
"""

from __future__ import annotations

from collections import defaultdict

from telemetry.parsers.transcripts import phase_usage


#: The five Skills that emit sidecars (ADR-0001 § v1 emission list). Every other
#: Skill is invisible to TE-4/TE-5 — which is what the coverage fraction says.
EMITTING_SKILLS = (
    "hstack-test-plan", "hstack-implement", "hstack-verify",
    "hstack-adversarial-review", "hstack-finalize",
)

UNATTRIBUTED = "(unattributed)"


def compute(session_rows: list[dict], changes: dict, sidecars: list[dict] | None = None) -> dict:
    """Compute the five TE metrics.

    Args:
        session_rows: from transcripts.collect_session_rows
        changes: from frontmatter.load_change_artifacts
        sidecars: from sidecars.load_sidecars (empty/None → TE-4/TE-5 report no
            coverage rather than silently vanishing)

    Returns a dict ready for rendering.
    """
    phases = _te_4(sidecars or [])
    return {
        "te_1_cost_per_change": _te_1(session_rows, changes),
        "te_2_cache_hit_per_subagent": _te_2(session_rows),
        "te_3_subagent_entry_tax": _te_3(session_rows),
        "te_4_cost_per_phase": phases,
        "te_5_cost_per_change": _te_5(phases["rows"]),
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
    unattributed = 0
    for s in session_rows:
        if s["skill"] is None:
            unattributed += 1
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
        "unattributed_sessions": unattributed,
        "note": (
            "Session-scoped, not phase-scoped: a Skill has a start marker and no "
            "end marker, so everything a session spends after the invocation "
            "lands in the first bucket — including later phases and unrelated "
            "work. Superseded by TE-4/TE-5 for any change that carries sidecars. "
            "Attribution reads structured invocation markers only (<command-name> "
            "tags, Skill tool_use blocks); sessions with no marker are "
            f"unattributed ({unattributed} of {len(session_rows)} in window) "
            "rather than credited to whichever Skill their prompt mentioned."
        ),
    }


def _te_2(session_rows: list[dict]) -> dict:
    """TE-2: cache-hit ratio = cache_read / (cache_read + cache_creation) per
    subagent appearance. Without isSidechain attribution we group by the host
    Skill and report per-Skill cache effectiveness — same shape, coarser grain.
    """
    per_skill = defaultdict(lambda: {"cache_read": 0, "cache_creation": 0, "turns": 0})
    for s in session_rows:
        key = s["skill"] or UNATTRIBUTED
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
    return {
        "rows": rows,
        "note": (
            "Session-scoped, same caveat as TE-1 — the whole session's cache "
            f"behaviour is credited to its first Skill. `{UNATTRIBUTED}` holds "
            "every session with no structured hstack invocation marker, "
            "including plain non-hstack work. Superseded by TE-4/TE-5 wherever "
            "sidecars exist."
        ),
    }


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


def _te_4(sidecars: list[dict]) -> dict:
    """TE-4: cost per phase — the sidecar's window, summed from the transcript.

    One row per sidecar. A row is *measured* when the sidecar carries a phase
    window (schema_version ≥ 2) whose session transcript is still on disk;
    otherwise `tokens` is `None` and the row is unmeasured. Never zero: a phase
    whose transcript was swept spent tokens we can no longer count, and printing
    0 would fold it into the average as if it were free.
    """
    rows = []
    for sc in sidecars:
        usage = phase_usage(sc.get("data") or {})
        data = sc.get("data") or {}
        rows.append({
            "skill": sc.get("skill"),
            "change": sc.get("change_id"),
            "phase_id": sc.get("phase_id"),
            "sidecar": sc.get("file"),
            "schema_version": sc.get("schema_version"),
            "session_id": data.get("session_id"),
            "opened_at": data.get("phase_opened_at"),
            "closed_at": data.get("phase_closed_at"),
            "measured": usage is not None,
            "unmeasured_reason": None if usage is not None else _unmeasured_reason(sc),
            "tokens": usage["total_tokens"] if usage else None,
            "cost_score": usage["cost_score"] if usage else None,
            "turns": usage["turns"] if usage else None,
            "wall_clock_h": round(usage["wall_clock_s"] / 3600, 2) if usage else None,
        })
    rows.sort(key=lambda r: (-(r["tokens"] or 0), r["change"] or "", r["sidecar"] or ""))
    measured = [r for r in rows if r["measured"]]
    return {
        "rows": rows,
        "phases_emitted": len(rows),
        "phases_measured": len(measured),
        "coverage_fraction": (len(measured) / len(rows)) if rows else None,
        "note": (
            "Phase-scoped: tokens are summed over assistant turns whose "
            "timestamp falls inside the sidecar's [phase_opened_at, "
            "phase_closed_at] window. Only the five sidecar-emitting Skills "
            f"({', '.join(EMITTING_SKILLS)}) appear here at all — every other "
            "Skill is invisible, and subagent spend lands in its host's window "
            "(isSidechain=False). Unmeasured rows are phases whose window or "
            "transcript could not be read; they are never counted as zero. "
            "Sidecars are not window-filtered — every change folder on disk is "
            "read, unlike the session and git tables above. Read "
            "this table next to QO-4 (observed vs promised) and WS-2 (gate "
            "findings density): cost without an outcome beside it can only "
            "argue for spending less, never for spending well."
        ),
    }


def _unmeasured_reason(sidecar: dict) -> str:
    data = sidecar.get("data") or {}
    if not data.get("phase_opened_at") or not data.get("phase_closed_at"):
        version = sidecar.get("schema_version")
        return ("pre-ADR-0009 sidecar (schema_version "
                f"{version if version is not None else '?'}) — no phase window")
    if not data.get("session_id"):
        return "session id unresolved at write time"
    return "transcript not found (retention sweep, or written on another machine)"


def _te_5(phase_rows: list[dict]) -> dict:
    """TE-5: cost per change — the sum of that change's measured phases.

    The coverage fraction is not decoration. Five of the 27 Skills emit
    sidecars, so `tokens` is a sum over a subset by construction: the spec, the
    plan, the security- and data-reviews, the ship gate and the whole configure
    family are absent, and so is any phase whose transcript has aged out. A
    reader who takes this column for a change's total cost will read it low.
    """
    per_change: dict[str, dict] = {}
    for r in phase_rows:
        change = r.get("change") or "(unknown)"
        agg = per_change.setdefault(change, {
            "change": change,
            "phases_emitted": 0,
            "phases_measured": 0,
            "skills": set(),
            "tokens": 0,
            "cost_score": 0,
            "turns": 0,
            "wall_clock_h": 0.0,
        })
        agg["phases_emitted"] += 1
        if r.get("skill"):
            agg["skills"].add(r["skill"])
        if not r["measured"]:
            continue
        agg["phases_measured"] += 1
        agg["tokens"] += r["tokens"] or 0
        agg["cost_score"] += r["cost_score"] or 0
        agg["turns"] += r["turns"] or 0
        agg["wall_clock_h"] += r["wall_clock_h"] or 0.0
    rows = []
    for agg in per_change.values():
        measured = agg["phases_measured"]
        rows.append({
            "change": agg["change"],
            "phases_measured": measured,
            "phases_emitted": agg["phases_emitted"],
            "coverage_fraction": (measured / agg["phases_emitted"]) if agg["phases_emitted"] else None,
            "skills_measured": sorted(agg["skills"]),
            "tokens": agg["tokens"] if measured else None,
            "cost_score": agg["cost_score"] if measured else None,
            "turns": agg["turns"] if measured else None,
            "wall_clock_h": round(agg["wall_clock_h"], 2) if measured else None,
        })
    rows.sort(key=lambda r: (-(r["tokens"] or 0), r["change"]))
    total_emitted = sum(r["phases_emitted"] for r in rows)
    total_measured = sum(r["phases_measured"] for r in rows)
    return {
        "rows": rows,
        "phases_emitted": total_emitted,
        "phases_measured": total_measured,
        "coverage_fraction": (total_measured / total_emitted) if total_emitted else None,
        "note": (
            "A subset, not a total. Coverage fraction = measured phases / "
            "emitted sidecars, and sidecars are emitted by five Skills only — "
            "change-new, change-plan, security-review, data-review, ship and the "
            "configure family contribute nothing to these sums. Pair with QO-4 "
            "and the adversarial-review findings density before concluding that "
            "an expensive change was a wasteful one."
        ),
    }
