import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@gomoso-ai/design-system/primitives'
import { AlertTriangle } from 'lucide-react'
import { DataTable } from '@/components/data-table'
import { SectionCard } from '@/components/section-card'
import { StatCard } from '@/components/stat-card'
import { compact, pct, type PhaseCoverage, type TelemetryReport } from '@/lib/report'

/** Coverage is printed with the totals, never after them — a subset read as a total is the failure mode. */
function coverageLine(block: PhaseCoverage): string {
  if (!block.phases_emitted) return 'No sidecars on disk yet — nothing is measurable.'
  return `${block.phases_measured} of ${block.phases_emitted} emitted sidecars measurable (${pct(block.coverage_fraction)}).`
}

export function RepoDashboard({ report }: { report: TelemetryReport }) {
  const m = report.metrics
  const te2Rows = m.token_economics.te_2_cache_hit_per_subagent.rows
  const cacheRead = te2Rows.reduce((a, r) => a + r.cache_read, 0)
  const cacheCreation = te2Rows.reduce((a, r) => a + r.cache_creation, 0)
  const globalCacheHit = cacheRead + cacheCreation > 0 ? cacheRead / (cacheRead + cacheCreation) : null

  // ADR-0009 phase instrumentation — absent from schema_version-1 reports.
  const te4 = m.token_economics.te_4_cost_per_phase
  const te5 = m.token_economics.te_5_cost_per_change

  const ws4 = m.workflow_shape.ws_4_scope_amendment_rate
  const qo3 = m.quality_outcomes.qo_3_test_immutability_audit
  const tdHalfLife = m.contract_drift.tech_debt_half_life.summary

  return (
    <>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Changes" value={String(report.counts.changes)} />
        <StatCard label="Tech-debt" value={String(report.counts.tech_debt)} />
        <StatCard label="Commits" value={String(report.counts.commits)} hint="in window" />
        <StatCard label="Sessions" value={String(report.counts.sessions)} hint="Claude Code" />
        <StatCard label="Cache-hit" value={pct(globalCacheHit)} hint="all skills" />
        <StatCard
          label="Watch items"
          value={String(report.watch_list.length)}
          hint={report.watch_list.length > 0 ? 'needs review' : 'all clear'}
        />
      </section>

      {report.watch_list.length > 0 ? (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>Watch list</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {report.watch_list.map((item) => (
                <li key={item}>{item.replaceAll('`', '')}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue="tokens">
        <TabsList>
          <TabsTrigger value="tokens">Tokens</TabsTrigger>
          <TabsTrigger value="workflow">Workflow</TabsTrigger>
          <TabsTrigger value="quality">Quality</TabsTrigger>
          <TabsTrigger value="overengineering">Overengineering</TabsTrigger>
          <TabsTrigger value="drift">Drift</TabsTrigger>
          <TabsTrigger value="kernel-fit">Kernel-fit</TabsTrigger>
        </TabsList>

        <TabsContent value="tokens" className="mt-4 flex flex-col gap-4">
          <SectionCard
            title="TE-1 — cost-score per Skill"
            description="Session-scoped: a Skill has a start marker and no end marker, so a session's whole spend lands on its first Skill. Superseded by TE-4/TE-5 wherever sidecars exist."
          >
            <DataTable
              rows={m.token_economics.te_1_cost_per_change.rows}
              columns={[
                { header: 'Skill', cell: (r) => <span className="font-medium">{r.skill}</span> },
                { header: 'Sessions', cell: (r) => r.sessions, align: 'right' },
                { header: 'Cost-score total', cell: (r) => compact(r.cost_score_total), align: 'right' },
                { header: '/ session', cell: (r) => compact(r.cost_score_mean), align: 'right' },
              ]}
            />
          </SectionCard>

          <SectionCard
            title="TE-2 — cache-hit ratio per Skill"
            description="cache_read / (cache_read + cache_creation). Below 50% the context is being rebuilt rather than reused."
          >
            <DataTable
              rows={te2Rows}
              columns={[
                { header: 'Skill', cell: (r) => <span className="font-medium">{r.skill}</span> },
                { header: 'Turns', cell: (r) => r.turns, align: 'right' },
                { header: 'Cache read', cell: (r) => compact(r.cache_read), align: 'right' },
                { header: 'Cache creation', cell: (r) => compact(r.cache_creation), align: 'right' },
                {
                  header: 'Ratio',
                  align: 'right',
                  cell: (r) =>
                    r.ratio === null ? (
                      '–'
                    ) : (
                      <Badge variant={r.ratio < 0.5 ? 'destructive' : r.ratio < 0.8 ? 'secondary' : 'outline'}>
                        {pct(r.ratio)}
                      </Badge>
                    ),
                },
              ]}
            />
          </SectionCard>

          <SectionCard
            title="TE-3 — subagent entry-tax"
            description="cache_creation paid by host sessions per subagent invocation — the ~15-25k token context load each fresh subagent pays."
          >
            <DataTable
              rows={m.token_economics.te_3_subagent_entry_tax.rows}
              columns={[
                { header: 'Subagent', cell: (r) => <span className="font-medium">{r.subagent}</span> },
                { header: 'Invocations', cell: (r) => r.appearances, align: 'right' },
                { header: 'Host cache-creation', cell: (r) => compact(r.host_cache_creation_total), align: 'right' },
                { header: '/ invocation', cell: (r) => compact(r.host_cache_creation_per_invocation), align: 'right' },
              ]}
            />
          </SectionCard>

          {te4 ? (
            <SectionCard
              title="TE-4 — cost per phase"
              description={`Tokens spent between the sidecar's phase_opened_at and phase_closed_at. ${coverageLine(te4)} Read next to QO-4 — cost without an outcome beside it can only argue for spending less.`}
            >
              <DataTable
                rows={te4.rows.filter((r) => r.measured).slice(0, 40)}
                columns={[
                  { header: 'Skill', cell: (r) => <span className="font-medium">{r.skill}</span> },
                  { header: 'Change', cell: (r) => r.change },
                  { header: 'Phase', cell: (r) => r.phase_id ?? '–' },
                  { header: 'Tokens', cell: (r) => compact(r.tokens ?? 0), align: 'right' },
                  { header: 'Turns', cell: (r) => r.turns ?? '–', align: 'right' },
                  { header: 'Wall-clock (h)', cell: (r) => r.wall_clock_h ?? '–', align: 'right' },
                ]}
              />
            </SectionCard>
          ) : null}

          {te5 ? (
            <SectionCard
              title="TE-5 — cost per change"
              description={`Sum of that change's measured phases — a subset, not a total: only five Skills emit sidecars. ${coverageLine(te5)}`}
            >
              <DataTable
                rows={te5.rows.slice(0, 20)}
                columns={[
                  { header: 'Change', cell: (r) => <span className="font-medium">{r.change}</span> },
                  { header: 'Tokens', cell: (r) => (r.tokens === null ? 'unmeasured' : compact(r.tokens)), align: 'right' },
                  { header: 'Turns', cell: (r) => r.turns ?? '–', align: 'right' },
                  { header: 'Wall-clock (h)', cell: (r) => r.wall_clock_h ?? '–', align: 'right' },
                  { header: 'Phases', cell: (r) => `${r.phases_measured} / ${r.phases_emitted}`, align: 'right' },
                  {
                    header: 'Coverage',
                    align: 'right',
                    cell: (r) =>
                      r.coverage_fraction === null ? (
                        '–'
                      ) : (
                        <Badge variant={r.coverage_fraction < 0.5 ? 'destructive' : r.coverage_fraction < 1 ? 'secondary' : 'outline'}>
                          {pct(r.coverage_fraction)}
                        </Badge>
                      ),
                  },
                ]}
              />
            </SectionCard>
          ) : null}
        </TabsContent>

        <TabsContent value="workflow" className="mt-4 flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-3">
            <StatCard
              label="Phase duration (median)"
              value={`${m.workflow_shape.ws_1_phase_duration.summary?.median_h ?? '–'} h`}
              hint={`p90 ${m.workflow_shape.ws_1_phase_duration.summary?.p90_h ?? '–'} h · max ${m.workflow_shape.ws_1_phase_duration.summary?.max_h ?? '–'} h`}
            />
            <StatCard
              label="Scope-amendment rate"
              value={pct(ws4.rate)}
              hint={`${ws4.changes_with_post_rfi_writes} changes with post-RFI spec writes (upper bound)`}
            />
            <StatCard
              label="Adversarial findings"
              value={String(m.workflow_shape.ws_2_gate_findings_density.adversarial_review_total_findings ?? 0)}
              hint={`across ${m.workflow_shape.ws_2_gate_findings_density.adversarial_review_changes_with_findings ?? 0} changes`}
            />
          </div>

          <SectionCard title="WS-1 — phase duration per change" description="Hours between successive implement commits.">
            <DataTable
              rows={m.workflow_shape.ws_1_phase_duration.per_change.slice(0, 15)}
              columns={[
                { header: 'Change', cell: (r) => <span className="font-medium">{r.change}</span> },
                { header: 'Phases', cell: (r) => r.phases, align: 'right' },
                { header: 'Min (h)', cell: (r) => r.min_h, align: 'right' },
                { header: 'Mean (h)', cell: (r) => r.mean_h, align: 'right' },
                { header: 'Max (h)', cell: (r) => r.max_h, align: 'right' },
              ]}
            />
          </SectionCard>

          <SectionCard title="WS-6 — halt reasons" description="HSTACK-HALT sentinels found in transcripts and commit bodies.">
            <DataTable
              rows={m.workflow_shape.ws_6_halt_reasons.rows}
              columns={[
                { header: 'Reason', cell: (r) => <Badge variant="secondary">{r.reason}</Badge> },
                { header: 'Count', cell: (r) => r.count, align: 'right' },
              ]}
            />
          </SectionCard>
        </TabsContent>

        <TabsContent value="quality" className="mt-4 flex flex-col gap-4">
          <SectionCard title="QO-2 — severity × resolution-type" description="How adversarial-review findings get resolved, by severity.">
            <DataTable
              rows={m.quality_outcomes.qo_2_severity_resolution_mix.rows}
              columns={[
                { header: 'Severity', cell: (r) => <Badge variant={r.severity === 'critical' || r.severity === 'high' ? 'destructive' : 'secondary'}>{r.severity}</Badge> },
                { header: 'Commit', cell: (r) => Number(r['commit'] ?? 0), align: 'right' },
                { header: 'Tech-debt', cell: (r) => Number(r['tech-debt'] ?? 0), align: 'right' },
                { header: 'Justified-in-prose', cell: (r) => Number(r['justified-in-prose'] ?? 0), align: 'right' },
              ]}
            />
          </SectionCard>

          {m.quality_outcomes.qo_2_severity_resolution_mix.high_severity_in_prose_smells.length > 0 ? (
            <SectionCard
              title="High/critical resolved as justified-in-prose (smell)"
              description="These findings closed with prose instead of a commit or a tech-debt item — review each."
            >
              <DataTable
                rows={m.quality_outcomes.qo_2_severity_resolution_mix.high_severity_in_prose_smells}
                columns={[
                  { header: 'Change', cell: (r) => <span className="font-medium">{r.change}</span> },
                  { header: 'Finding', cell: (r) => r.finding_id },
                  { header: 'Category', cell: (r) => <Badge variant="secondary">{r.category}</Badge> },
                  { header: 'Severity', cell: (r) => <Badge variant="destructive">{r.severity}</Badge> },
                ]}
              />
            </SectionCard>
          ) : null}

          <SectionCard
            title={`QO-3 — test-immutability audit (${qo3.authorized_count} authorized changes)`}
            description="Non-implement commits touching test files without a canonical authorization phrase. Candidates for manual review, not verdicts."
          >
            <DataTable
              rows={qo3.candidate_violations.slice(0, 15)}
              columns={[
                { header: 'SHA', cell: (r) => <code className="text-xs">{r.sha.slice(0, 8)}</code> },
                { header: 'Subject', cell: (r) => <span className="text-sm">{r.subject.slice(0, 80)}</span> },
                { header: 'Test files', cell: (r) => <span className="text-xs text-muted-foreground">{r.test_files.slice(0, 2).join(', ')}{r.test_files.length > 2 ? '…' : ''}</span> },
              ]}
            />
            {qo3.candidate_violations.length > 15 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing 15 of {qo3.candidate_violations.length} candidates.
              </p>
            ) : null}
          </SectionCard>
        </TabsContent>

        <TabsContent value="overengineering" className="mt-4 flex flex-col gap-4">
          <SectionCard
            title="OE-1 — artifact tokens per diff line"
            description="Above ~50 tokens/line: heavy spec-vs-code. Below ~5: under-specified. Changes with 0 diff lines shipped outside the git window."
          >
            <DataTable
              rows={m.overengineering.oe_1_artifact_to_diff_ratio.rows.filter((r) => r.diff_lines > 0)}
              columns={[
                { header: 'Change', cell: (r) => <span className="font-medium">{r.change}</span> },
                { header: 'Artifact tokens', cell: (r) => compact(r.artifact_tokens), align: 'right' },
                { header: 'Diff lines', cell: (r) => r.diff_lines, align: 'right' },
                {
                  header: 'Tokens / line',
                  align: 'right',
                  cell: (r) =>
                    r.tokens_per_diff_line === null ? (
                      '–'
                    ) : (
                      <Badge variant={r.tokens_per_diff_line > 50 ? 'destructive' : r.tokens_per_diff_line < 5 ? 'secondary' : 'outline'}>
                        {r.tokens_per_diff_line}
                      </Badge>
                    ),
                },
              ]}
            />
          </SectionCard>

          <SectionCard title="OE-3 — subagent invocations × host cost">
            <DataTable
              rows={m.overengineering.oe_3_subagent_context_load_amortization.rows}
              columns={[
                { header: 'Subagent', cell: (r) => <span className="font-medium">{r.subagent}</span> },
                { header: 'Invocations', cell: (r) => r.invocations, align: 'right' },
                { header: 'Host cost total', cell: (r) => compact(r.host_cost_score_total), align: 'right' },
                { header: '/ invocation', cell: (r) => compact(r.cost_per_invocation), align: 'right' },
              ]}
            />
          </SectionCard>

          <SectionCard
            title="OE-5 — trivial-eligible changes that ran the full gauntlet"
            description="Empty surfaces + no trivial tag: either retro-classify as trivial, or the surfaces list was under-declared."
          >
            <DataTable
              rows={m.overengineering.oe_5_trivial_eligible_full_gauntlet.rows}
              columns={[
                { header: 'Change', cell: (r) => <span className="font-medium">{r.change}</span> },
                { header: 'Status', cell: (r) => <Badge variant="outline">{r.status}</Badge> },
                { header: 'Files touched', cell: (r) => r.files_touched_in_implement_commits, align: 'right' },
              ]}
            />
          </SectionCard>
        </TabsContent>

        <TabsContent value="drift" className="mt-4 flex flex-col gap-4">
          <SectionCard
            title="Module-spec staleness × recent activity"
            description="A stale spec on a hot module is where contract drift starts."
          >
            <DataTable
              rows={m.contract_drift.module_spec_staleness.rows}
              columns={[
                { header: 'Module', cell: (r) => <span className="font-medium">{r.module}</span> },
                { header: 'Spec status', cell: (r) => <Badge variant={r.drift_flag ? 'destructive' : 'outline'}>{r.status}</Badge> },
                { header: 'Updated', cell: (r) => r.updated ?? '–' },
                { header: 'Recent commits', cell: (r) => r.recent_commits_touching_module, align: 'right' },
              ]}
            />
          </SectionCard>

          <div className="grid gap-4 md:grid-cols-2">
            <SectionCard title="ADR supersession lag">
              <DataTable
                rows={m.contract_drift.adr_supersession_lag.rows}
                columns={[
                  { header: 'ADR', cell: (r) => <span className="font-medium">{r.adr}</span> },
                  { header: 'Superseded by', cell: (r) => r.superseded_by },
                  { header: 'Lag (days)', cell: (r) => r.lag_days, align: 'right' },
                ]}
              />
            </SectionCard>

            <SectionCard title="Tech-debt half-life by exit path">
              <DataTable
                rows={Object.entries(tdHalfLife).map(([path, v]) => ({ path, ...v }))}
                columns={[
                  { header: 'Exit path', cell: (r) => <Badge variant="secondary">{r.path}</Badge> },
                  { header: 'Count', cell: (r) => r.count, align: 'right' },
                  { header: 'Median days', cell: (r) => r.median_days, align: 'right' },
                  { header: 'Max days', cell: (r) => r.max_days, align: 'right' },
                ]}
              />
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="kernel-fit" className="mt-4 flex flex-col gap-4">
          {(
            [
              ['KF-P1 — Category-A claim spans production paths', m.kernel_fit.kf_p1_category_a_claim_spans_production_paths],
              ['KF-P2 — halt-reason cluster uncovered by enum', m.kernel_fit.kf_p2_halt_reason_cluster_uncovered_by_enum],
              ['KF-P3 — Skill precondition violated and recoverable', m.kernel_fit.kf_p3_skill_precondition_violated_and_recoverable],
            ] as const
          ).map(([title, pattern]) => (
            <SectionCard key={title} title={title} description={pattern.note}>
              <div className="flex items-center gap-2">
                <Badge variant={pattern.fired ? 'destructive' : 'outline'}>
                  {pattern.fired ? 'Fired' : 'Not fired'}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {pattern.evidence_row_count} evidence row(s)
                  {pattern.fired ? ' — run /hstack:kernel-fit-scan to synthesize findings' : ''}
                </span>
              </div>
            </SectionCard>
          ))}
        </TabsContent>
      </Tabs>
    </>
  )
}
