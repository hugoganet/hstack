"""Workflow-shape insights: WS-1 phase duration, WS-2 gate findings density,
WS-4 scope-amendment rate."""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta


def compute(commits: list[dict], changes: dict, session_rows: list[dict]) -> dict:
    return {
        "ws_1_phase_duration": _ws_1(commits),
        "ws_2_gate_findings_density": _ws_2(changes),
        "ws_4_scope_amendment_rate": _ws_4(commits, changes),
        "ws_6_halt_reasons": _ws_6(commits, session_rows),
    }


def _ws_1(commits: list[dict]) -> dict:
    """WS-1: time between successive implement(<change-id>) phase commits.

    The implementer auto-commits one commit per completed phase. The interval
    between adjacent implement commits for the same change is a phase-duration
    proxy. Note that this includes any cofounder time between phases (review,
    figma work, etc.) — the metric is per-change-and-phase elapsed, not pure
    LLM compute. v2 with sidecars (started_at / completed_at) sharpens this.
    """
    per_change_implement = defaultdict(list)
    for c in commits:
        if c["artifact_type"] != "implement":
            continue
        if not c["artifact_id"] or not c["timestamp"]:
            continue
        per_change_implement[c["artifact_id"]].append((c["timestamp"], c["phase_id"]))
    all_intervals = []
    per_change_rows = []
    for cid, entries in per_change_implement.items():
        entries.sort()
        intervals = []
        for i in range(1, len(entries)):
            dt = entries[i][0] - entries[i - 1][0]
            intervals.append(dt.total_seconds() / 3600.0)  # hours
        if intervals:
            per_change_rows.append({
                "change": cid,
                "phases": len(entries),
                "min_h": round(min(intervals), 2),
                "mean_h": round(sum(intervals) / len(intervals), 2),
                "max_h": round(max(intervals), 2),
            })
            all_intervals.extend(intervals)
    summary = None
    if all_intervals:
        all_intervals.sort()
        n = len(all_intervals)
        median = all_intervals[n // 2]
        summary = {
            "count": n,
            "median_h": round(median, 2),
            "p90_h": round(all_intervals[min(int(n * 0.9), n - 1)], 2),
            "max_h": round(max(all_intervals), 2),
        }
    return {"summary": summary, "per_change": per_change_rows}


def _ws_2(changes: dict) -> dict:
    """WS-2: findings density per gate.

    For each change, count findings on adversarial-review.md and PASS/CONCERNS/
    FAIL distribution on security-review (via frontmatter scores when present)
    and RLS-coverage on data-review. Outputs per-gate totals + per-change rows.
    """
    adv_findings = []
    sec_concerns = 0
    sec_total = 0
    data_partial = 0
    data_total = 0
    per_change = []
    for cid, arts in sorted(changes.items()):
        adv = arts.get("adversarial-review")
        n_findings = 0
        if adv:
            findings_arr = adv["fm"].get("findings") or []
            if isinstance(findings_arr, list):
                n_findings = len(findings_arr)
                adv_findings.extend(findings_arr if isinstance(findings_arr, list) else [])
        sec = arts.get("security-review")
        sec_status = sec["fm"].get("status") if sec else None
        if sec_status:
            sec_total += 1
            scores = sec["fm"].get("scores") or {}
            if isinstance(scores, dict):
                for v in scores.values():
                    if isinstance(v, str) and v.upper() in ("CONCERNS", "FAIL"):
                        sec_concerns += 1
        dr = arts.get("data-review")
        if dr:
            data_total += 1
            rls = dr["fm"].get("rls-coverage") or dr["fm"].get("RLS-coverage")
            if isinstance(rls, dict):
                for v in rls.values():
                    if isinstance(v, str) and v.lower() in ("partial", "missing"):
                        data_partial += 1
            elif isinstance(rls, str) and rls.lower() in ("partial", "missing"):
                data_partial += 1
        per_change.append({
            "change": cid,
            "adv_findings": n_findings,
            "security": sec_status or "-",
            "data_review": (dr["fm"].get("status") if dr else "-"),
        })
    return {
        "adversarial_review_total_findings": len(adv_findings),
        "adversarial_review_changes_with_findings": sum(1 for r in per_change if r["adv_findings"] > 0),
        "security_review_changes_scored": sec_total,
        "security_review_concerns_or_fail_items": sec_concerns,
        "data_review_changes_scored": data_total,
        "data_review_partial_or_missing_items": data_partial,
        "per_change": per_change,
    }


def _ws_4(commits: list[dict], changes: dict) -> dict:
    """WS-4: scope-amendment rate.

    For each change-spec, count commits that touch spec.md after the change-spec
    first reaches status: ready-for-implementation. Each such commit is a
    candidate scope amendment (or status flip — we can't tell apart without
    diff parsing in v1). The metric tracks the upper bound.
    """
    spec_writes_after_rfi = defaultdict(int)
    rfi_timestamps: dict[str, object] = {}

    # First pass: locate when each change-spec first transitioned to
    # ready-for-implementation, identified by a change-spec(<id>): ready-for-implementation
    # commit (or any later status's predecessor).
    for c in commits:
        if c["artifact_type"] == "change-spec" and c["action"] and "ready-for-implementation" in c["action"]:
            cid = c["artifact_id"]
            if cid and cid not in rfi_timestamps:
                rfi_timestamps[cid] = c["timestamp"]

    # Second pass: count subsequent commits touching that change's spec.md.
    for c in commits:
        if not c["timestamp"]:
            continue
        for f in c["files"]:
            # spec.md path: hstack/specs/changes/<change-id>/spec.md
            if not f.endswith("/spec.md") or "/changes/" not in f:
                continue
            parts = f.split("/")
            try:
                cid = parts[parts.index("changes") + 1]
            except (ValueError, IndexError):
                continue
            rfi_ts = rfi_timestamps.get(cid)
            if rfi_ts is None or c["timestamp"] <= rfi_ts:
                continue
            spec_writes_after_rfi[cid] += 1
    total = sum(spec_writes_after_rfi.values())
    changes_with_amendment = len([v for v in spec_writes_after_rfi.values() if v > 0])
    return {
        "total_spec_writes_after_rfi": total,
        "changes_with_post_rfi_writes": changes_with_amendment,
        "rate": (changes_with_amendment / len(changes)) if changes else 0.0,
        "per_change": [
            {"change": cid, "writes_after_rfi": n}
            for cid, n in sorted(spec_writes_after_rfi.items(), key=lambda kv: -kv[1])
        ],
        "note": (
            "Upper bound: includes status-flip commits as well as content "
            "amendments. v2 with structured spec-revision logs disambiguates."
        ),
    }


def _ws_6(commits: list[dict], session_rows: list[dict]) -> dict:
    """WS-6: halt frequency by reason.

    Sources: (a) commit-body HSTACK-HALT sentinels; (b) transcript-text
    HSTACK-HALT sentinels (when the convention is in use).
    """
    by_reason = defaultdict(int)
    for c in commits:
        for r in c.get("halt_reasons", []):
            by_reason[r.lower()] += 1
    for s in session_rows:
        for r in s.get("halt_reasons", []):
            by_reason[r.lower()] += 1
    rows = sorted(by_reason.items(), key=lambda kv: -kv[1])
    return {
        "rows": [{"reason": r, "count": n} for r, n in rows],
        "total": sum(by_reason.values()),
        "note": (
            "Counts are zero until the halt-sentinel convention is in use. "
            "See kernel § Stop conditions for the HSTACK-HALT format."
        ),
    }
