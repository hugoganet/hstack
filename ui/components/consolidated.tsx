import Link from 'next/link'
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
import { Recommendations } from '@/components/recommendations'
import { SectionCard } from '@/components/section-card'
import { StatCard } from '@/components/stat-card'
import type { Recommendation } from '@/lib/brain'
import { compact, pct, type ReportRef, type TelemetryReport } from '@/lib/report'

interface Entry {
  ref: ReportRef
  report: TelemetryReport
}

function cacheHit(report: TelemetryReport): { read: number; creation: number } {
  return report.metrics.token_economics.te_2_cache_hit_per_subagent.rows.reduce(
    (acc, r) => ({ read: acc.read + r.cache_read, creation: acc.creation + r.cache_creation }),
    { read: 0, creation: 0 },
  )
}

function mergeBy<T>(
  entries: Entry[],
  rowsOf: (r: TelemetryReport) => T[],
  keyOf: (row: T) => string,
  sums: (keyof T)[],
): (T & { _key: string })[] {
  const merged = new Map<string, T & { _key: string }>()
  for (const { report } of entries) {
    for (const row of rowsOf(report)) {
      const key = keyOf(row)
      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, { ...row, _key: key })
      } else {
        for (const field of sums) {
          ;(existing[field] as number) = (existing[field] as number) + (row[field] as number)
        }
      }
    }
  }
  return [...merged.values()]
}

export function Consolidated({
  entries,
  recommendations,
}: {
  entries: Entry[]
  recommendations: Recommendation[]
}) {
  const totals = entries.reduce(
    (acc, { report }) => {
      const c = cacheHit(report)
      return {
        changes: acc.changes + report.counts.changes,
        techDebt: acc.techDebt + report.counts.tech_debt,
        commits: acc.commits + report.counts.commits,
        sessions: acc.sessions + report.counts.sessions,
        cacheRead: acc.cacheRead + c.read,
        cacheCreation: acc.cacheCreation + c.creation,
        watch: acc.watch + report.watch_list.length,
      }
    },
    { changes: 0, techDebt: 0, commits: 0, sessions: 0, cacheRead: 0, cacheCreation: 0, watch: 0 },
  )
  const globalCacheHit =
    totals.cacheRead + totals.cacheCreation > 0
      ? totals.cacheRead / (totals.cacheRead + totals.cacheCreation)
      : null

  const skills = mergeBy(
    entries,
    (r) => r.metrics.token_economics.te_1_cost_per_change.rows,
    (row) => row.skill,
    ['sessions', 'cost_score_total'],
  ).sort((a, b) => b.cost_score_total - a.cost_score_total)

  const subagents = mergeBy(
    entries,
    (r) => r.metrics.token_economics.te_3_subagent_entry_tax.rows,
    (row) => row.subagent,
    ['appearances', 'host_cache_creation_total'],
  ).sort((a, b) => b.appearances - a.appearances)

  const halts = mergeBy(
    entries,
    (r) => r.metrics.workflow_shape.ws_6_halt_reasons.rows,
    (row) => row.reason,
    ['count'],
  ).sort((a, b) => b.count - a.count)

  const openRecs = recommendations.filter((r) => r.status === 'proposed').length

  return (
    <>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Repos" value={String(entries.length)} hint="latest report each" />
        <StatCard label="Changes" value={String(totals.changes)} />
        <StatCard label="Sessions" value={String(totals.sessions)} hint="Claude Code, in window" />
        <StatCard label="Cache-hit" value={pct(globalCacheHit)} hint="weighted, all repos" />
        <StatCard label="Watch items" value={String(totals.watch)} />
        <StatCard
          label="Recommendations"
          value={String(openRecs)}
          hint={openRecs > 0 ? 'proposed — review in Brain' : 'none proposed'}
        />
      </section>

      <SectionCard
        title="Per-repo snapshot"
        description="Latest report of each consuming repo. Click a repo for the full dashboard."
      >
        <DataTable
          rows={entries}
          columns={[
            {
              header: 'Repo',
              cell: ({ ref }) => (
                <Link
                  className="font-medium underline-offset-4 hover:underline"
                  href={`/?repo=${encodeURIComponent(ref.repo)}&report=${encodeURIComponent(ref.name)}`}
                >
                  {ref.repo}
                </Link>
              ),
            },
            { header: 'Report', cell: ({ report }) => report.generated },
            {
              header: 'Window',
              cell: ({ report }) => (report.window_days ? `${report.window_days}d` : 'all'),
            },
            { header: 'Changes', cell: ({ report }) => report.counts.changes, align: 'right' },
            { header: 'Tech-debt', cell: ({ report }) => report.counts.tech_debt, align: 'right' },
            { header: 'Commits', cell: ({ report }) => report.counts.commits, align: 'right' },
            { header: 'Sessions', cell: ({ report }) => report.counts.sessions, align: 'right' },
            {
              header: 'Cache-hit',
              align: 'right',
              cell: ({ report }) => {
                const c = cacheHit(report)
                return pct(c.read + c.creation > 0 ? c.read / (c.read + c.creation) : null)
              },
            },
            {
              header: 'Amendment rate',
              align: 'right',
              cell: ({ report }) => pct(report.metrics.workflow_shape.ws_4_scope_amendment_rate.rate),
            },
            {
              header: 'Watch',
              align: 'right',
              cell: ({ report }) =>
                report.watch_list.length > 0 ? (
                  <Badge variant="destructive">{report.watch_list.length}</Badge>
                ) : (
                  <Badge variant="outline">0</Badge>
                ),
            },
          ]}
        />
      </SectionCard>

      {totals.watch > 0 ? (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>Watch list — all repos</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {entries.flatMap(({ ref, report }) =>
                report.watch_list.map((item) => (
                  <li key={ref.repo + item}>
                    <span className="font-medium">{ref.repo}:</span> {item.replaceAll('`', '')}
                  </li>
                )),
              )}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue="brain">
        <TabsList>
          <TabsTrigger value="brain">Brain</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="subagents">Subagents</TabsTrigger>
          <TabsTrigger value="halts">Halts</TabsTrigger>
        </TabsList>

        <TabsContent value="brain" className="mt-4">
          <SectionCard
            title="Workflow recommendations"
            description="Written by the weekly brain analysis (brain/ANALYSIS.md) from cross-repo telemetry. You gate every change: flip status to accepted or rejected in the file."
          >
            <Recommendations recommendations={recommendations} />
          </SectionCard>
        </TabsContent>

        <TabsContent value="skills" className="mt-4">
          <SectionCard
            title="Cost-score per Skill — all repos"
            description="TE-1 merged across the latest report of each repo."
          >
            <DataTable
              rows={skills}
              columns={[
                { header: 'Skill', cell: (r) => <span className="font-medium">{r.skill}</span> },
                { header: 'Sessions', cell: (r) => r.sessions, align: 'right' },
                { header: 'Cost-score total', cell: (r) => compact(r.cost_score_total), align: 'right' },
                {
                  header: '/ session',
                  align: 'right',
                  cell: (r) => compact(r.sessions > 0 ? Math.round(r.cost_score_total / r.sessions) : 0),
                },
              ]}
            />
          </SectionCard>
        </TabsContent>

        <TabsContent value="subagents" className="mt-4">
          <SectionCard
            title="Subagent entry-tax — all repos"
            description="TE-3 merged across the latest report of each repo."
          >
            <DataTable
              rows={subagents}
              columns={[
                { header: 'Subagent', cell: (r) => <span className="font-medium">{r.subagent}</span> },
                { header: 'Invocations', cell: (r) => r.appearances, align: 'right' },
                { header: 'Host cache-creation', cell: (r) => compact(r.host_cache_creation_total), align: 'right' },
                {
                  header: '/ invocation',
                  align: 'right',
                  cell: (r) =>
                    compact(r.appearances > 0 ? Math.round(r.host_cache_creation_total / r.appearances) : 0),
                },
              ]}
            />
          </SectionCard>
        </TabsContent>

        <TabsContent value="halts" className="mt-4">
          <SectionCard
            title="Halt reasons — all repos"
            description="WS-6 HSTACK-HALT sentinels merged across the latest report of each repo."
          >
            <DataTable
              rows={halts}
              columns={[
                { header: 'Reason', cell: (r) => <Badge variant="secondary">{r.reason}</Badge> },
                { header: 'Count', cell: (r) => r.count, align: 'right' },
              ]}
            />
          </SectionCard>
        </TabsContent>
      </Tabs>
    </>
  )
}
