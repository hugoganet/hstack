"""Render the metrics dict to a markdown report."""

from __future__ import annotations

from datetime import date
from typing import Any


def render_report(metrics: dict, repo_name: str, window_days: int | None) -> str:
    lines: list[str] = []
    lines.append(f"# hstack-telemetry — {repo_name}")
    lines.append("")
    lines.append(f"_Generated {date.today().isoformat()}; window: "
                 f"{'last ' + str(window_days) + ' days' if window_days else 'all history'}._")
    lines.append("")
    lines.append("Retrospective observability for the hstack workflow. All metrics are derived "
                 "from on-disk artifacts (frontmatter + bodies), git history, and Claude Code "
                 "transcripts. This report is read-only; the artifacts are the source of truth.")
    lines.append("")

    _render_token_economics(lines, metrics.get("token_economics", {}))
    _render_workflow_shape(lines, metrics.get("workflow_shape", {}))
    _render_quality_outcomes(lines, metrics.get("quality_outcomes", {}))
    _render_overengineering(lines, metrics.get("overengineering", {}))
    _render_contract_drift(lines, metrics.get("contract_drift", {}))
    _render_kernel_fit(lines, metrics.get("kernel_fit", {}))

    _render_watch_list(lines, metrics)

    return "\n".join(lines) + "\n"


# ---------------- helpers ----------------

def _h(lines: list[str], level: int, text: str) -> None:
    lines.append("#" * level + " " + text)
    lines.append("")


def _p(lines: list[str], text: str) -> None:
    lines.append(text)
    lines.append("")


def _table(lines: list[str], headers: list[str], rows: list[list[Any]]) -> None:
    if not rows:
        lines.append("_(no data)_")
        lines.append("")
        return
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("|" + "|".join("---" for _ in headers) + "|")
    for r in rows:
        cells = ["" if v is None else str(v) for v in r]
        lines.append("| " + " | ".join(cells) + " |")
    lines.append("")


# ---------------- buckets ----------------

def _render_token_economics(lines: list[str], te: dict) -> None:
    _h(lines, 2, "Token economics")

    te1 = te.get("te_1_cost_per_change", {})
    _h(lines, 3, "TE-1 — cost-score per Skill (proxy for per-change cost)")
    _p(lines, te1.get("note", ""))
    _table(
        lines,
        ["skill", "sessions", "cost-score total", "cost-score / session"],
        [[r["skill"], r["sessions"], r["cost_score_total"], r["cost_score_mean"]]
         for r in te1.get("rows", [])],
    )

    te2 = te.get("te_2_cache_hit_per_subagent", {})
    _h(lines, 3, "TE-2 — cache-hit ratio (per Skill, v1 coarse grain)")
    _p(lines, "ratio = cache_read / (cache_read + cache_creation). Below 0.5 → context "
              "is being rebuilt rather than reused. Above 0.8 → cross-session reuse is healthy.")
    _table(
        lines,
        ["skill", "turns", "cache_read", "cache_creation", "ratio"],
        [[r["skill"], r["turns"], r["cache_read"], r["cache_creation"],
          (f"{r['ratio']:.2%}" if r["ratio"] is not None else "-")]
         for r in te2.get("rows", [])],
    )

    te3 = te.get("te_3_subagent_entry_tax", {})
    _h(lines, 3, "TE-3 — subagent entry-tax amortization")
    _p(lines, te3.get("note", ""))
    _table(
        lines,
        ["subagent", "appearances", "host cache_creation total", "/ invocation"],
        [[r["subagent"], r["appearances"], r["host_cache_creation_total"],
          r["host_cache_creation_per_invocation"]]
         for r in te3.get("rows", [])],
    )


def _render_workflow_shape(lines: list[str], ws: dict) -> None:
    _h(lines, 2, "Workflow shape")

    ws1 = ws.get("ws_1_phase_duration", {})
    _h(lines, 3, "WS-1 — phase duration (between successive implement commits)")
    summary = ws1.get("summary")
    if summary:
        _table(
            lines,
            ["intervals counted", "median (h)", "p90 (h)", "max (h)"],
            [[summary["count"], summary["median_h"], summary["p90_h"], summary["max_h"]]],
        )
    else:
        _p(lines, "_(no implement commits in window)_")
    _table(
        lines,
        ["change", "phases", "min (h)", "mean (h)", "max (h)"],
        [[r["change"], r["phases"], r["min_h"], r["mean_h"], r["max_h"]]
         for r in ws1.get("per_change", [])[:10]],
    )

    ws2 = ws.get("ws_2_gate_findings_density", {})
    _h(lines, 3, "WS-2 — gate findings density")
    _table(
        lines,
        ["metric", "value"],
        [
            ["adversarial-review total findings (all changes)", ws2.get("adversarial_review_total_findings", 0)],
            ["changes with ≥1 adversarial finding", ws2.get("adversarial_review_changes_with_findings", 0)],
            ["security-reviews scored", ws2.get("security_review_changes_scored", 0)],
            ["security-review CONCERNS-or-FAIL items", ws2.get("security_review_concerns_or_fail_items", 0)],
            ["data-reviews scored", ws2.get("data_review_changes_scored", 0)],
            ["data-review partial/missing RLS items", ws2.get("data_review_partial_or_missing_items", 0)],
        ],
    )

    ws4 = ws.get("ws_4_scope_amendment_rate", {})
    _h(lines, 3, "WS-4 — scope-amendment rate (upper bound)")
    _p(lines, ws4.get("note", ""))
    _table(
        lines,
        ["metric", "value"],
        [
            ["total spec.md writes after ready-for-implementation", ws4.get("total_spec_writes_after_rfi", 0)],
            ["changes with ≥1 post-RFI spec write", ws4.get("changes_with_post_rfi_writes", 0)],
            ["rate (changes-with-amendment / total)", f"{ws4.get('rate', 0):.2%}"],
        ],
    )

    ws6 = ws.get("ws_6_halt_reasons", {})
    _h(lines, 3, "WS-6 — halt reasons (HSTACK-HALT sentinel)")
    _p(lines, ws6.get("note", ""))
    _table(
        lines,
        ["reason", "count"],
        [[r["reason"], r["count"]] for r in ws6.get("rows", [])],
    )


def _render_quality_outcomes(lines: list[str], qo: dict) -> None:
    _h(lines, 2, "Quality outcomes")

    qo2 = qo.get("qo_2_severity_resolution_mix", {})
    _h(lines, 3, "QO-2 — severity × resolution-type")
    res_types = ["commit", "tech-debt", "justified-in-prose", "other"]
    _table(
        lines,
        ["severity"] + res_types,
        [[r["severity"]] + [r.get(rt, 0) for rt in res_types] for r in qo2.get("rows", [])],
    )
    smells = qo2.get("high_severity_in_prose_smells", [])
    if smells:
        _p(lines, "**High/critical findings resolved as `justified-in-prose` (smell):**")
        _table(
            lines,
            ["change", "finding", "category", "severity"],
            [[s["change"], s["finding_id"], s["category"], s["severity"]] for s in smells],
        )
    else:
        _p(lines, "_No high/critical findings resolved as `justified-in-prose` — healthy._")

    qo3 = qo.get("qo_3_test_immutability_audit", {})
    _h(lines, 3, "QO-3 — test-immutability audit")
    _p(lines, qo3.get("note", ""))
    _p(lines, f"Authorized test-change commits: **{qo3.get('authorized_count', 0)}**")
    cv = qo3.get("candidate_violations", [])
    if cv:
        _p(lines, "**Non-implement commits touching test files without canonical authorization (review manually):**")
        _table(
            lines,
            ["sha", "subject", "artifact_type", "test files"],
            [[c["sha"][:8], c["subject"][:80], c["artifact_type"] or "-",
              ", ".join(c["test_files"][:3]) + ("…" if len(c["test_files"]) > 3 else "")]
             for c in cv[:20]],
        )
    else:
        _p(lines, "_No candidate violations found — healthy._")

    qo4 = qo.get("qo_4_observed_vs_promised", {})
    _h(lines, 3, "QO-4 — verifier observed-vs-promised (test-plan-coverage)")
    summary = qo4.get("summary", {})
    if summary:
        for key, buckets in summary.items():
            _p(lines, f"**{key}:** " + ", ".join(f"{v}={n}" for v, n in sorted(buckets.items())))
    _table(
        lines,
        ["change", "edge-cases", "tenant-isolation", "performance-budgets"],
        [[r.get("change"), r.get("edge-cases", "-"),
          r.get("tenant-isolation", "-"), r.get("performance-budgets", "-")]
         for r in qo4.get("per_change", [])],
    )


def _render_overengineering(lines: list[str], oe: dict) -> None:
    _h(lines, 2, "Overengineering detection")

    oe1 = oe.get("oe_1_artifact_to_diff_ratio", {})
    _h(lines, 3, "OE-1 — artifact tokens per diff line")
    _p(lines, "Ratio above ~50 tokens/line suggests heavy spec-vs-code; ratio below ~5 "
              "suggests an under-specified change. Honest signal, not a verdict.")
    _table(
        lines,
        ["change", "artifact tokens", "diff lines (implement commits)", "tokens / line"],
        [[r["change"], r["artifact_tokens"], r["diff_lines"], r["tokens_per_diff_line"] or "-"]
         for r in oe1.get("rows", [])],
    )

    oe3 = oe.get("oe_3_subagent_context_load_amortization", {})
    _h(lines, 3, "OE-3 — subagent invocations × host cost")
    _table(
        lines,
        ["subagent", "invocations", "host cost-score total", "/ invocation"],
        [[r["subagent"], r["invocations"], r["host_cost_score_total"], r["cost_per_invocation"]]
         for r in oe3.get("rows", [])],
    )

    oe5 = oe.get("oe_5_trivial_eligible_full_gauntlet", {})
    _h(lines, 3, "OE-5 — trivial-eligible changes that ran the full gauntlet")
    _p(lines, oe5.get("note", ""))
    _table(
        lines,
        ["change", "status", "surfaces", "files touched in implement"],
        [[r["change"], r["status"], r["surfaces"], r["files_touched_in_implement_commits"]]
         for r in oe5.get("rows", [])],
    )


def _render_contract_drift(lines: list[str], cd: dict) -> None:
    _h(lines, 2, "Contract drift")

    ms = cd.get("module_spec_staleness", {})
    _h(lines, 3, "Module-spec staleness × recent activity")
    _table(
        lines,
        ["module", "spec status", "spec updated", "recent commits touching module", "drift flag"],
        [[r["module"], r["status"], r["updated"],
          r["recent_commits_touching_module"], "⚠️" if r["drift_flag"] else ""]
         for r in ms.get("rows", [])],
    )

    adr = cd.get("adr_supersession_lag", {})
    _h(lines, 3, "ADR supersession lag")
    _table(
        lines,
        ["ADR", "superseded by", "lag (days)"],
        [[r["adr"], r["superseded_by"], r["lag_days"]] for r in adr.get("rows", [])],
    )

    td = cd.get("tech_debt_half_life", {})
    _h(lines, 3, "Tech-debt half-life by exit path")
    summary = td.get("summary", {})
    _table(
        lines,
        ["exit path", "count", "median days", "max days"],
        [[k, v["count"], v["median_days"], v["max_days"]] for k, v in sorted(summary.items())],
    )


def _render_kernel_fit(lines: list[str], kf: dict) -> None:
    _h(lines, 2, "Kernel-fit candidates")
    _p(lines, "Patterns suggesting the kernel itself (CLAUDE.md, templates, validators, Skill "
              "flows) may need revision. Each fired pattern is also written as a durable finding "
              "by `/hstack:kernel-fit-scan` at `hstack/kernel-fit/findings/KF-NNNN-*.md`. The "
              "table below is a rollup; the findings are the canonical artifact. See ADR-0004.")

    existing = kf.get("existing_open_findings_by_pattern", {})
    if existing:
        total_open = sum(len(v) for v in existing.values())
        _p(lines, f"**Currently open findings:** {total_open} "
                  + "(" + ", ".join(f"{p}: {len(ids)}" for p, ids in sorted(existing.items())) + ")")

    patterns = [
        ("kf_p1_category_a_claim_spans_production_paths", "KF-P1 — category-a-claim-spans-production-paths"),
        ("kf_p2_halt_reason_cluster_uncovered_by_enum", "KF-P2 — halt-reason-cluster-uncovered-by-enum"),
        ("kf_p3_skill_precondition_violated_and_recoverable", "KF-P3 — skill-precondition-violated-and-recoverable"),
    ]
    for key, heading in patterns:
        block = kf.get(key, {})
        _h(lines, 3, heading)
        _p(lines, block.get("note", ""))
        fired = block.get("fired", False)
        rc = block.get("evidence_row_count", 0)
        if fired:
            _p(lines, f"**Fired** — {rc} evidence row(s).")
        else:
            _p(lines, f"_(not fired — {rc} evidence row(s); threshold not met)_")

        # Per-pattern row rendering.
        if key == "kf_p1_category_a_claim_spans_production_paths":
            rows = block.get("evidence_rows", [])
            _table(
                lines,
                ["change", "production paths", "enables", "downstream consumers", "classification"],
                [[r["change"], r["production_paths_count"], r["enables_count"],
                  ", ".join(r["downstream_consumers"][:3]) + ("…" if len(r["downstream_consumers"]) > 3 else ""),
                  r["classification_candidate"]]
                 for r in rows[:10]],
            )
        elif key == "kf_p2_halt_reason_cluster_uncovered_by_enum":
            rows = block.get("evidence_rows", [])
            _table(
                lines,
                ["cluster", "size", "representative context (truncated)"],
                [[r["cluster_id"], r["size"], r["representative_context"][:120]]
                 for r in rows[:10]],
            )
        elif key == "kf_p3_skill_precondition_violated_and_recoverable":
            rows = block.get("evidence_rows", [])
            _table(
                lines,
                ["change", "finding", "matched keywords", "commit subject (truncated)"],
                [[r["change"], r["finding_id"], ", ".join(r["matched_keywords"]),
                  (r["commit_subject"] or "-")[:80]]
                 for r in rows[:10]],
            )


def _render_watch_list(lines: list[str], metrics: dict) -> None:
    _h(lines, 2, "Watch list")
    items = []

    # TE-2: any Skill cache-hit below 0.5
    te2 = metrics.get("token_economics", {}).get("te_2_cache_hit_per_subagent", {})
    for r in te2.get("rows", []):
        if r.get("ratio") is not None and r["ratio"] < 0.5 and r["turns"] > 5:
            items.append(f"Low cache-hit on `{r['skill']}` ({r['ratio']:.0%}) — context is being rebuilt.")

    # QO-2 smells
    smells = metrics.get("quality_outcomes", {}).get("qo_2_severity_resolution_mix", {}).get("high_severity_in_prose_smells", [])
    if smells:
        items.append(f"{len(smells)} high/critical adversarial finding(s) resolved as `justified-in-prose` — review.")

    # QO-3 violations
    cv = metrics.get("quality_outcomes", {}).get("qo_3_test_immutability_audit", {}).get("candidate_violations", [])
    if cv:
        items.append(f"{len(cv)} candidate test-immutability violations (non-implement commits touching tests without authorization).")

    # WS-4 amendment rate above 30%
    ws4 = metrics.get("workflow_shape", {}).get("ws_4_scope_amendment_rate", {})
    rate = ws4.get("rate", 0)
    if rate > 0.3:
        items.append(f"Scope-amendment upper-bound rate at {rate:.0%}. If real (not just status flips), planner/test-strategist may be missing scope up front.")

    # Module drift
    ms = metrics.get("contract_drift", {}).get("module_spec_staleness", {}).get("rows", [])
    for r in ms:
        if r["drift_flag"]:
            items.append(f"Module-spec drift: `{r['module']}` is `needs-refresh` with {r['recent_commits_touching_module']} recent commits.")

    # Kernel-fit fired patterns
    kf = metrics.get("kernel_fit", {})
    for key, label in (
        ("kf_p1_category_a_claim_spans_production_paths", "KF-P1"),
        ("kf_p2_halt_reason_cluster_uncovered_by_enum", "KF-P2"),
        ("kf_p3_skill_precondition_violated_and_recoverable", "KF-P3"),
    ):
        block = kf.get(key, {})
        if block.get("fired"):
            rc = block.get("evidence_row_count", 0)
            items.append(f"Kernel-fit {label} fired with {rc} evidence row(s) — "
                         f"run `/hstack:kernel-fit-scan` to synthesize findings.")

    if not items:
        _p(lines, "_Nothing flagged. Either everything is healthy, or the metrics need tuning._")
        return
    for item in items:
        lines.append(f"- {item}")
    lines.append("")
