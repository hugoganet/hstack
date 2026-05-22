"""Kernel-fit insights: patterns suggesting the kernel itself needs revision.

This module is the detection layer of the kernel-fit closed-loop system. It
pattern-matches across shipped artifacts and emits evidence rows; an LLM
subagent (`kernel-fit-analyst`) then synthesizes findings from these rows.

See ADR-0003 for the full design rationale and `template/CLAUDE.md` § How
hstack improves itself for the loop contract.

Three starter patterns:

- KF-P1 — `internal-tooling-conflates-categories`: changes with
  `internal-tooling: true` whose in-scope spans production-code paths and
  whose later consumers (other change-specs, commits) reveal user-value flow
  the flag did not capture.
- KF-P2 — `halt-reason-cluster-uncovered-by-enum`: halt sentinels with
  `reason=other` whose surrounding prose clusters above the Jaccard
  threshold, suggesting the enum is missing a case.
- KF-P3 — `skill-precondition-violated-and-recoverable`: adversarial-review
  spec-compliance findings whose resolution commit messages reveal a missed
  upstream gate (the ADR-0002 pattern).

Detection is pure read — no writes. Output is a dict consumed by the
analyst subagent via the scan Skill orchestration.
"""

from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path

from telemetry.parsers import frontmatter as fm_parser
from telemetry.parsers.bodies import parse_findings_section, split_sections


# File-path prefixes that count as "internal-only" for KF-P1 classification.
# A change whose in-scope is entirely under these prefixes is genuine
# Category A (true internal tooling). Anything outside is candidate Category B
# (foundational prerequisite — production code with deferred user value).
INTERNAL_ONLY_PREFIXES = (
    "hstack/",
    "scripts/",
    ".github/",
    "template/",
    ".claude/",
    "docs/",
    "ci/",
)

# Kernel-rule keywords scanned in resolution commits for KF-P3. A
# `spec-compliance` adversarial finding whose resolving commit mentions any
# of these is a candidate "Skill precondition should have halted earlier"
# signal (the ADR-0002 missing-gate pattern).
KERNEL_GATE_KEYWORDS = re.compile(
    r"\b(precondition|missed\s+gate|should\s+have\s+halted|upstream|"
    r"ready-for-implementation|ready-for-review|ready-to-ship|status\s+gate)\b",
    re.IGNORECASE,
)

# Jaccard threshold for KF-P2 cluster membership. Tunable; documented in the
# plan as a starting value. Lower → more clustering (more cluster merges,
# fewer clusters). Higher → tighter clusters (fewer merges, more clusters).
JACCARD_THRESHOLD = 0.6

# Minimum cluster size for KF-P2 to fire. Smaller than this is noise.
MIN_CLUSTER_SIZE = 3

# Minimum candidate-row count for KF-P1 to fire. A single Category-B mislabel
# is noise; recurrence is signal.
KF_P1_MIN_ROWS = 2


def compute(commits: list[dict], changes: dict, tech_debt: list[dict],
            adrs: list[dict], module_specs: list[dict],
            session_rows: list[dict], findings_dir: Path | None) -> dict:
    """Run all kernel-fit detection patterns.

    `findings_dir` may be `None` or non-existent on first run — the dedup
    cross-reference returns an empty index in that case, and the analyst
    treats every fired pattern as net-new.
    """
    existing = _load_existing_findings(findings_dir)
    return {
        "existing_open_findings_by_pattern": existing,
        "kf_p1_internal_tooling_conflates_categories": _kf_p1(changes, commits),
        "kf_p2_halt_reason_cluster_uncovered_by_enum": _kf_p2(commits, session_rows),
        "kf_p3_skill_precondition_violated_and_recoverable": _kf_p3(changes, commits),
    }


# ---------------- existing-findings index ----------------

def _load_existing_findings(findings_dir: Path | None) -> dict:
    """Read all KF-NNNN-*.md files in findings_dir and build an index of open
    findings keyed by pattern. Used by the analyst for dedup / supersession
    decisions. Tolerant of missing directory."""
    out: dict[str, list[str]] = defaultdict(list)
    if findings_dir is None or not findings_dir.is_dir():
        return dict(out)
    for path in sorted(findings_dir.glob("KF-*.md")):
        parsed = fm_parser.read_artifact(path)
        if parsed is None:
            continue
        fm, _body = parsed
        status = fm.get("status")
        pattern = fm.get("pattern")
        kid = fm.get("id") or path.stem
        if not pattern:
            continue
        # Only "open" and "acknowledged" findings count for dedup; promoted /
        # dismissed / superseded / archived are terminal and do not suppress
        # re-detection.
        if status in ("open", "acknowledged"):
            out[pattern].append(kid)
    return dict(out)


# ---------------- KF-P1 ----------------

def _classify_inscope_paths(in_scope: list) -> tuple[list[str], list[str]]:
    """Partition an in-scope list into (internal_only_paths, production_paths)."""
    internal_only: list[str] = []
    production: list[str] = []
    for entry in in_scope or []:
        if not isinstance(entry, str):
            continue
        path = entry.strip()
        if not path:
            continue
        # Normalize leading "./" and any glob suffixes for prefix checking.
        normalized = path.lstrip("./")
        if any(normalized.startswith(p) for p in INTERNAL_ONLY_PREFIXES):
            internal_only.append(path)
        else:
            production.append(path)
    return internal_only, production


def _forward_consumers(this_change_id: str, this_in_scope: list[str],
                       changes: dict, commits: list[dict]) -> list[str]:
    """Return change-ids of later changes whose in-scope OR whose commit
    file-lists overlap with this change's in-scope production paths."""
    if not this_in_scope:
        return []
    # Build set of production-path-prefixes for cheap overlap checks. We treat
    # each in-scope entry as a prefix; this is forgiving (catches edits inside
    # subdirs) and matches what `internal-tooling: true` plumbing changes
    # typically introduce (a dir of new types or a new module).
    prefixes = {p.lstrip("./").rstrip("/*") for p in this_in_scope}

    consumers: set[str] = set()

    # (1) Other change-specs whose in-scope overlaps.
    for other_id, arts in changes.items():
        if other_id == this_change_id:
            continue
        spec = arts.get("change-spec") or arts.get("spec")
        if not spec:
            continue
        other_in_scope = spec["fm"].get("in-scope") or []
        for entry in other_in_scope:
            if not isinstance(entry, str):
                continue
            normalized = entry.lstrip("./")
            if any(normalized.startswith(p) for p in prefixes):
                consumers.add(other_id)
                break

    # (2) Commits whose file-list touches our production paths AND whose
    # artifact_id is a different change-spec (avoids self-attribution).
    for c in commits:
        cid = c.get("artifact_id")
        if not cid or cid == this_change_id:
            continue
        for f in c.get("files", []):
            normalized = f.lstrip("./")
            if any(normalized.startswith(p) for p in prefixes):
                consumers.add(cid)
                break

    return sorted(consumers)


def _kf_p1(changes: dict, commits: list[dict]) -> dict:
    """KF-P1 — internal-tooling flag may conflate Category A (true internal
    tooling) and Category B (foundational prerequisite with deferred user
    value). Fires on >= KF_P1_MIN_ROWS candidate Category-B rows.
    """
    rows: list[dict] = []
    for cid, arts in changes.items():
        spec = arts.get("change-spec") or arts.get("spec")
        if not spec:
            continue
        fm = spec["fm"]
        if fm.get("status") != "shipped":
            continue
        if not fm.get("internal-tooling"):
            continue
        in_scope = fm.get("in-scope") or []
        user_stories = fm.get("user-stories") or []
        internal_paths, production_paths = _classify_inscope_paths(in_scope)
        # Classification heuristic:
        # - no production paths              → "true-internal-tooling" (Cat A)
        # - has production paths, no stories → "foundational-prerequisite" (Cat B candidate)
        # - has production paths, has stories → "ambiguous" (rare; flag for review)
        if not production_paths:
            classification = "true-internal-tooling"
        elif not user_stories:
            classification = "foundational-prerequisite"
        else:
            classification = "ambiguous"
        consumers: list[str] = []
        if classification != "true-internal-tooling":
            consumers = _forward_consumers(cid, production_paths or in_scope, changes, commits)
        rows.append({
            "change": cid,
            "internal_only_paths_count": len(internal_paths),
            "production_paths_count": len(production_paths),
            "user_stories_count": len(user_stories),
            "downstream_consumers": consumers,
            "classification_candidate": classification,
        })

    candidate_rows = [r for r in rows
                      if r["classification_candidate"] == "foundational-prerequisite"]
    fired = len(candidate_rows) >= KF_P1_MIN_ROWS
    return {
        "pattern_id": "KF-P1",
        "pattern_name": "internal-tooling-conflates-categories",
        "fired": fired,
        "evidence_row_count": len(candidate_rows),
        "min_rows_for_firing": KF_P1_MIN_ROWS,
        "all_rows": rows,
        "evidence_rows": candidate_rows,
        "note": ("Changes with internal-tooling: true whose in-scope spans production paths "
                 "and which lack a user story. Category B (foundational prerequisite) "
                 "candidates suggest the kernel's internal-tooling flag conflates two "
                 "semantically distinct cases."),
    }


# ---------------- KF-P2 ----------------

_TOKEN_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9_-]{2,}")


def _tokens(text: str) -> set[str]:
    """Lowercase token set from text; drops tokens <=3 chars and pure numbers."""
    if not text:
        return set()
    return {t.lower() for t in _TOKEN_RE.findall(text)}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def _kf_p2(commits: list[dict], session_rows: list[dict]) -> dict:
    """KF-P2 — cluster halt sentinels with reason=other. Cluster size >=
    MIN_CLUSTER_SIZE is evidence the enum is missing a case.

    Sources: commit bodies (parser already extracted halt_reasons), and
    session-row halt_reasons. For commits, we use the commit body as the
    surrounding-prose context; for session rows we use the row's halt-context
    if available, falling back to a label-only token set.
    """
    docs: list[dict] = []
    for c in commits:
        reasons = c.get("halt_reasons") or []
        if not any(r.lower() == "other" for r in reasons):
            continue
        # Use commit body as the prose context — it is what the kernel
        # contract says accompanies the sentinel.
        context = c.get("body", "") or c.get("subject", "")
        docs.append({
            "source": "commit",
            "ref": c.get("sha", "")[:8],
            "context": context,
            "tokens": _tokens(context),
        })
    for s in session_rows:
        reasons = s.get("halt_reasons") or []
        for r in reasons:
            if not isinstance(r, str):
                continue
            if r.lower() != "other":
                continue
            docs.append({
                "source": "session",
                "ref": s.get("file", "") or s.get("skill", "") or "",
                # Session parser does not capture surrounding prose in v1;
                # use the session label as a degraded token source.
                "context": s.get("skill", "") + " " + " ".join(reasons),
                "tokens": _tokens(s.get("skill", "")),
            })

    # Greedy clustering: each new doc joins the first cluster whose
    # representative has Jaccard >= threshold; else starts a new cluster.
    clusters: list[list[dict]] = []
    for d in docs:
        placed = False
        for cluster in clusters:
            rep_tokens = cluster[0]["tokens"]
            if _jaccard(d["tokens"], rep_tokens) >= JACCARD_THRESHOLD:
                cluster.append(d)
                placed = True
                break
        if not placed:
            clusters.append([d])

    evidence_clusters = [c for c in clusters if len(c) >= MIN_CLUSTER_SIZE]
    rows = []
    for i, cluster in enumerate(evidence_clusters):
        rows.append({
            "cluster_id": f"C-{i + 1}",
            "size": len(cluster),
            "representative_context": (cluster[0]["context"] or "")[:300],
            "member_refs": [d["ref"] for d in cluster],
        })

    return {
        "pattern_id": "KF-P2",
        "pattern_name": "halt-reason-cluster-uncovered-by-enum",
        "fired": len(evidence_clusters) > 0,
        "evidence_row_count": len(evidence_clusters),
        "jaccard_threshold": JACCARD_THRESHOLD,
        "min_cluster_size": MIN_CLUSTER_SIZE,
        "total_other_halts": len(docs),
        "evidence_rows": rows,
        "note": ("HSTACK-HALT sentinels with reason=other clustered by surrounding-prose "
                 f"token overlap (Jaccard >= {JACCARD_THRESHOLD}). A cluster of "
                 f">= {MIN_CLUSTER_SIZE} similar halts means the enum is missing a case."),
    }


# ---------------- KF-P3 ----------------

def _commits_by_sha_prefix(commits: list[dict]) -> dict[str, dict]:
    """Index commits by short sha (8 chars) for quick lookup. Falls back to
    full sha if entries collide (rare with realistic repo sizes)."""
    out: dict[str, dict] = {}
    for c in commits:
        sha = c.get("sha") or ""
        if not sha:
            continue
        out[sha] = c
        if len(sha) >= 8:
            out[sha[:8]] = c
    return out


def _kf_p3(changes: dict, commits: list[dict]) -> dict:
    """KF-P3 — spec-compliance adversarial findings resolved via a commit
    whose message reveals a kernel-gate keyword. This is the pattern that
    produced ADR-0002 (the missed `ready-for-review` transition).
    """
    commit_index = _commits_by_sha_prefix(commits)
    rows: list[dict] = []
    for cid, arts in changes.items():
        ar = arts.get("adversarial-review")
        if not ar:
            continue
        ar_fm = ar["fm"]
        if ar_fm.get("status") != "findings-resolved":
            continue
        # Findings array on frontmatter is authoritative; fall back to body
        # parser when the array is missing or absent.
        findings = ar_fm.get("findings") or []
        if not findings:
            sections = split_sections(ar["body"] or "")
            findings_section = sections.get("Findings", "")
            findings = parse_findings_section(findings_section)
        for f in findings:
            if not isinstance(f, dict):
                continue
            category = (f.get("category") or "").lower()
            if category != "spec-compliance":
                continue
            resolution = (f.get("resolution") or "").strip()
            if not resolution.startswith("commit:"):
                continue
            sha_token = resolution.split(":", 1)[1].strip().split()[0]
            commit = commit_index.get(sha_token) or commit_index.get(sha_token[:8])
            if not commit:
                # Still record the candidate — the analyst can decide whether
                # missing-commit-context is itself a signal.
                if KERNEL_GATE_KEYWORDS.search(resolution):
                    rows.append({
                        "change": cid,
                        "finding_id": f.get("id"),
                        "category": category,
                        "resolution": resolution,
                        "commit_subject": None,
                        "matched_keywords": [],
                        "commit_resolved": False,
                    })
                continue
            haystack = (commit.get("subject") or "") + "\n" + (commit.get("body") or "")
            matches = KERNEL_GATE_KEYWORDS.findall(haystack)
            if not matches:
                continue
            rows.append({
                "change": cid,
                "finding_id": f.get("id"),
                "category": category,
                "resolution": resolution,
                "commit_subject": commit.get("subject"),
                "matched_keywords": [m.lower() for m in matches],
                "commit_resolved": True,
            })

    return {
        "pattern_id": "KF-P3",
        "pattern_name": "skill-precondition-violated-and-recoverable",
        "fired": len(rows) >= 1,
        "evidence_row_count": len(rows),
        "evidence_rows": rows,
        "note": ("Adversarial spec-compliance findings whose resolving commit message "
                 "mentions a kernel gate or precondition. Each row is a candidate "
                 "'a Skill precondition should have halted earlier' signal — the "
                 "ADR-0002 pattern."),
    }
