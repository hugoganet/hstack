"""Contract-drift insights: module-spec staleness, ADR supersession lag,
tech-debt half-life by exit path."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime


def compute(commits: list[dict], changes: dict, tech_debt: list[dict],
            adrs: list[dict], module_specs: list[dict]) -> dict:
    return {
        "module_spec_staleness": _module_staleness(module_specs, commits),
        "adr_supersession_lag": _adr_lag(adrs),
        "tech_debt_half_life": _td_half_life(tech_debt),
    }


def _parse_date(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value).date()
        except ValueError:
            return None
    return None


def _module_staleness(module_specs: list[dict], commits: list[dict]) -> dict:
    """Per module: spec status + count of recent commits touching that module's
    files. A `needs-refresh` module with high recent activity is the drift
    pathology."""
    # Count commits touching each module dir.
    module_activity: dict[str, int] = defaultdict(int)
    for c in commits:
        for f in c.get("files", []):
            for ms in module_specs:
                module = ms["module"]
                # Use a heuristic — count when a commit touches files outside
                # hstack/ in directories named like the module. Imperfect, but
                # avoids requiring a module→file-path map.
                if module in f and not f.startswith("hstack/"):
                    module_activity[module] += 1
                    break
    rows = []
    for ms in module_specs:
        status = ms["fm"].get("status", "-")
        updated = _parse_date(ms["fm"].get("updated"))
        rows.append({
            "module": ms["module"],
            "status": status,
            "updated": str(updated) if updated else "-",
            "recent_commits_touching_module": module_activity.get(ms["module"], 0),
            "drift_flag": status == "needs-refresh" and module_activity.get(ms["module"], 0) > 0,
        })
    rows.sort(key=lambda r: -r["recent_commits_touching_module"])
    return {"rows": rows}


def _adr_lag(adrs: list[dict]) -> dict:
    """Among ADRs at `superseded` status, how long they lived before the
    superseding ADR landed."""
    by_id = {a["fm"].get("id") or a["path"].stem: a for a in adrs}
    lags = []
    for a in adrs:
        status = a["fm"].get("status")
        if status != "superseded":
            continue
        sup = a["fm"].get("superseded-by")
        a_created = _parse_date(a["fm"].get("created"))
        if not sup or not a_created:
            continue
        sup_adr = by_id.get(sup)
        if not sup_adr:
            continue
        sup_created = _parse_date(sup_adr["fm"].get("created"))
        if not sup_created:
            continue
        days = (sup_created - a_created).days
        lags.append({
            "adr": a["fm"].get("id"),
            "superseded_by": sup,
            "lag_days": days,
        })
    return {"rows": lags}


def _td_half_life(tech_debt: list[dict]) -> dict:
    """For each TD, compute days from created → exit (resolved | wontfix |
    stale-no-longer-reproducible). Surface by exit-path histogram + per-TD
    rows."""
    today = date.today()
    by_exit = defaultdict(list)
    rows = []
    for td in tech_debt:
        fm = td["fm"]
        status = fm.get("status")
        created = _parse_date(fm.get("created"))
        if not created:
            continue
        exit_date = None
        if status == "resolved":
            exit_date = _parse_date(fm.get("updated"))
        elif status == "wontfix":
            exit_date = _parse_date(fm.get("updated"))
        elif status == "stale-no-longer-reproducible":
            exit_date = _parse_date(fm.get("stale-verified-at") or fm.get("updated"))
        if exit_date:
            days = (exit_date - created).days
            by_exit[status].append(days)
        elif status == "open" or status == "in-progress":
            days = (today - created).days
            by_exit[f"{status} (still open)"].append(days)
            exit_date = None
        rows.append({
            "id": fm.get("id"),
            "status": status,
            "created": str(created),
            "days_to_exit": (exit_date - created).days if exit_date else (today - created).days,
            "exit_path": status if exit_date else None,
        })
    summary = {}
    for exit_path, days_list in by_exit.items():
        if not days_list:
            continue
        days_list.sort()
        summary[exit_path] = {
            "count": len(days_list),
            "median_days": days_list[len(days_list) // 2],
            "max_days": max(days_list),
        }
    return {"summary": summary, "rows": rows}
