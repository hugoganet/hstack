"""Quality-outcomes insights: QO-2 severity-resolution mix, QO-3 test-
immutability audit, QO-4 verifier observed-vs-promised."""

from __future__ import annotations

from collections import defaultdict


def compute(commits: list[dict], changes: dict) -> dict:
    return {
        "qo_2_severity_resolution_mix": _qo_2(changes),
        "qo_3_test_immutability_audit": _qo_3(commits),
        "qo_4_observed_vs_promised": _qo_4(changes),
    }


def _qo_2(changes: dict) -> dict:
    """QO-2: per finding, cross-tab severity × resolution-type.

    Resolution prefix is the part before the colon: commit | tech-debt |
    justified-in-prose.
    """
    matrix: dict[tuple[str, str], int] = defaultdict(int)
    smell_cases = []  # high/critical severity resolved as justified-in-prose
    for cid, arts in changes.items():
        adv = arts.get("adversarial-review")
        if not adv:
            continue
        findings = adv["fm"].get("findings")
        if not isinstance(findings, list):
            continue
        for f in findings:
            if not isinstance(f, dict):
                continue
            sev = (f.get("severity") or "unknown").lower()
            res = (f.get("resolution") or "unknown")
            res_type = res.split(":", 1)[0].strip().lower() if isinstance(res, str) else "unknown"
            if res_type not in ("commit", "tech-debt", "justified-in-prose"):
                res_type = "other"
            matrix[(sev, res_type)] += 1
            if sev in ("high", "critical") and res_type == "justified-in-prose":
                smell_cases.append({
                    "change": cid,
                    "finding_id": f.get("id"),
                    "category": f.get("category"),
                    "severity": sev,
                })
    severities = sorted({s for s, _ in matrix.keys()})
    res_types = ["commit", "tech-debt", "justified-in-prose", "other"]
    rows = []
    for sev in severities:
        row = {"severity": sev}
        for rt in res_types:
            row[rt] = matrix.get((sev, rt), 0)
        rows.append(row)
    return {
        "rows": rows,
        "high_severity_in_prose_smells": smell_cases,
    }


def _qo_3(commits: list[dict]) -> dict:
    """QO-3: test-immutability audit.

    For every commit touching a test file, check whether the body carries one
    of the canonical authorization phrases. Unauthorized test-edit commits are
    hard kernel violations.
    """
    import re
    test_re = re.compile(r"(\.test\.|\.spec\.|/__tests__/|/__snapshots__/|^e2e/|_test\.go$)")
    auth_re = re.compile(
        r"Ok to (change|delete) test\s+\S+"
        r"|Ok to update snapshot\s+\S+"
        r"|Ok to refresh fixture\s+\S+"
    )
    violations = []
    authorized = []
    for c in commits:
        test_files = [f for f in c.get("files", []) if test_re.search(f)]
        if not test_files:
            continue
        is_implement_or_test_plan = c.get("artifact_type") in ("implement", "test-plan")
        # New-tests-in-an-implement-commit are permitted; we can't distinguish
        # new-vs-modified without per-file diff inspection. As a heuristic, an
        # implement commit touching a test file without an auth phrase is
        # treated as a candidate, not a violation. Adversarial-review-time
        # changes to a test file without auth ARE violations regardless.
        has_auth = bool(auth_re.search(c.get("body", "")))
        if has_auth:
            authorized.append({"sha": c["sha"], "subject": c["subject"], "test_files": test_files})
        elif is_implement_or_test_plan:
            # candidate — could be a new test write, which is permitted
            pass
        else:
            violations.append({
                "sha": c["sha"],
                "subject": c["subject"],
                "test_files": test_files,
                "artifact_type": c.get("artifact_type"),
            })
    return {
        "authorized_count": len(authorized),
        "candidate_violations": violations,
        "note": (
            "Implement-phase commits touching test files are not flagged here "
            "(new tests are permitted by the test-immutability protocol). "
            "Non-implement commits touching test files without an authorization "
            "phrase are listed as candidate violations for manual review."
        ),
    }


def _qo_4(changes: dict) -> dict:
    """QO-4: verifier observed-vs-promised, summarized from
    verification.test-plan-coverage map."""
    counts = defaultdict(lambda: defaultdict(int))
    per_change = []
    for cid, arts in sorted(changes.items()):
        v = arts.get("verification")
        if not v:
            continue
        cov = v["fm"].get("test-plan-coverage")
        if not isinstance(cov, dict):
            continue
        row = {"change": cid}
        for key, value in cov.items():
            counts[key][str(value)] += 1
            row[key] = value
        per_change.append(row)
    summary = {key: dict(buckets) for key, buckets in counts.items()}
    return {"summary": summary, "per_change": per_change}
