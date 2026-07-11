import fs from 'node:fs'
import path from 'node:path'

/** Shape of the JSON twin emitted by scripts/telemetry/report.py (schema_version 1). */
export interface TelemetryReport {
  schema_version: number
  repo: string
  generated: string
  window_days: number | null
  counts: {
    changes: number
    tech_debt: number
    adrs: number
    module_specs: number
    commits: number
    sessions: number
  }
  watch_list: string[]
  metrics: {
    token_economics: {
      te_1_cost_per_change: { rows: Te1Row[]; note?: string }
      te_2_cache_hit_per_subagent: { rows: Te2Row[] }
      te_3_subagent_entry_tax: { rows: Te3Row[]; note?: string }
    }
    workflow_shape: {
      ws_1_phase_duration: {
        summary?: { count: number; median_h: number; p90_h: number; max_h: number } | null
        per_change: { change: string; phases: number; min_h: number; mean_h: number; max_h: number }[]
      }
      ws_2_gate_findings_density: Record<string, number>
      ws_4_scope_amendment_rate: {
        total_spec_writes_after_rfi: number
        changes_with_post_rfi_writes: number
        rate: number
        note?: string
      }
      ws_6_halt_reasons: { rows: { reason: string; count: number }[]; note?: string }
    }
    quality_outcomes: {
      qo_2_severity_resolution_mix: {
        rows: ({ severity: string } & Record<string, number | string>)[]
        high_severity_in_prose_smells: { change: string; finding_id: string; category: string; severity: string }[]
      }
      qo_3_test_immutability_audit: {
        authorized_count: number
        candidate_violations: { sha: string; subject: string; artifact_type: string | null; test_files: string[] }[]
        note?: string
      }
      qo_4_observed_vs_promised: {
        summary: Record<string, Record<string, number>>
        per_change: Record<string, string>[]
      }
    }
    overengineering: {
      oe_1_artifact_to_diff_ratio: {
        rows: { change: string; artifact_tokens: number; diff_lines: number; tokens_per_diff_line: number | null }[]
      }
      oe_3_subagent_context_load_amortization: {
        rows: { subagent: string; invocations: number; host_cost_score_total: number; cost_per_invocation: number }[]
      }
      oe_5_trivial_eligible_full_gauntlet: {
        rows: { change: string; status: string; surfaces: string; files_touched_in_implement_commits: number }[]
        note?: string
      }
    }
    contract_drift: {
      module_spec_staleness: {
        rows: {
          module: string
          status: string
          updated: string | null
          recent_commits_touching_module: number
          drift_flag: boolean
        }[]
      }
      adr_supersession_lag: { rows: { adr: string; superseded_by: string; lag_days: number }[] }
      tech_debt_half_life: { summary: Record<string, { count: number; median_days: number; max_days: number }> }
    }
    kernel_fit: {
      existing_open_findings_by_pattern?: Record<string, string[]>
      kf_p1_category_a_claim_spans_production_paths: KernelFitPattern
      kf_p2_halt_reason_cluster_uncovered_by_enum: KernelFitPattern
      kf_p3_skill_precondition_violated_and_recoverable: KernelFitPattern
    }
  }
}

export interface Te1Row {
  skill: string
  sessions: number
  cost_score_total: number
  cost_score_mean: number
}
export interface Te2Row {
  skill: string
  turns: number
  cache_read: number
  cache_creation: number
  ratio: number | null
}
export interface Te3Row {
  subagent: string
  appearances: number
  host_cache_creation_total: number
  host_cache_creation_per_invocation: number
}
export interface KernelFitPattern {
  fired: boolean
  evidence_row_count: number
  evidence_rows: Record<string, unknown>[]
  note?: string
}

export interface ReportSource {
  /** Display label — the consuming repo's directory name. */
  repo: string
  /** Absolute directory containing the *.json reports. */
  dir: string
}

export interface ReportRef {
  repo: string
  name: string
}

/**
 * Report sources resolution (first match wins):
 *   HSTACK_REPOS       — comma- or colon-separated consuming-repo roots;
 *                        reports live at <repo>/hstack/telemetry/reports/.
 *   HSTACK_REPO        — a single consuming-repo root.
 *   HSTACK_REPORTS_DIR — explicit directory of *.json reports.
 */
export function reportSources(): ReportSource[] {
  if (process.env.HSTACK_REPOS) {
    return process.env.HSTACK_REPOS.split(/[,:]/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((repoRoot) => ({
        repo: path.basename(repoRoot),
        dir: path.join(repoRoot, 'hstack', 'telemetry', 'reports'),
      }))
  }
  if (process.env.HSTACK_REPO) {
    return [
      {
        repo: path.basename(process.env.HSTACK_REPO),
        dir: path.join(process.env.HSTACK_REPO, 'hstack', 'telemetry', 'reports'),
      },
    ]
  }
  if (process.env.HSTACK_REPORTS_DIR) {
    return [
      {
        repo: path.basename(path.dirname(process.env.HSTACK_REPORTS_DIR)),
        dir: process.env.HSTACK_REPORTS_DIR,
      },
    ]
  }
  return []
}

/** All JSON reports across sources, newest first within each repo. */
export function listReports(): ReportRef[] {
  return reportSources().flatMap((src) => {
    if (!fs.existsSync(src.dir)) return []
    return fs
      .readdirSync(src.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort()
      .reverse()
      .map((name) => ({ repo: src.repo, name }))
  })
}

/** The most recent report of each repo, loaded. */
export function latestReports(): { ref: ReportRef; report: TelemetryReport }[] {
  const seen = new Set<string>()
  const out: { ref: ReportRef; report: TelemetryReport }[] = []
  for (const ref of listReports()) {
    if (seen.has(ref.repo)) continue
    seen.add(ref.repo)
    const report = loadReport(ref)
    if (report) out.push({ ref, report })
  }
  return out
}

export function loadReport(ref: ReportRef): TelemetryReport | null {
  const src = reportSources().find((s) => s.repo === ref.repo)
  // Guard against path traversal: the ref must be one of the listed reports.
  const listed = listReports().some((r) => r.repo === ref.repo && r.name === ref.name)
  if (!src || !listed) return null
  try {
    return JSON.parse(fs.readFileSync(path.join(src.dir, `${ref.name}.json`), 'utf-8'))
  } catch {
    return null
  }
}

/** Compact number: 12_345_678 → "12.3M". */
export function compact(n: number): string {
  return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function pct(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined) return '–'
  return `${(ratio * 100).toFixed(1)}%`
}
