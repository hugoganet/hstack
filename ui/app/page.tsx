import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@gomoso-ai/design-system/primitives'
import { Consolidated } from '@/components/consolidated'
import { RepoDashboard } from '@/components/repo-dashboard'
import { ReportPicker } from '@/components/report-picker'
import { listRecommendations } from '@/lib/brain'
import { latestReports, listReports, loadReport, reportSources } from '@/lib/report'

export const dynamic = 'force-dynamic'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string; report?: string }>
}) {
  const reports = listReports()
  if (reports.length === 0) {
    const sources = reportSources()
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl items-center justify-center p-8">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No telemetry reports found</EmptyTitle>
            <EmptyDescription>
              {sources.length > 0
                ? `No *.json reports in: ${sources.map((s) => s.dir).join(', ')}`
                : 'Set HSTACK_REPOS in ui/.env.local (see .env.example) or in the environment.'}
              <br />
              Generate one with: <code>python3 hstack/scripts/telemetry/report.py</code>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </main>
    )
  }

  const { repo: requestedRepo, report: requestedReport } = await searchParams
  const current = reports.find((r) => r.repo === requestedRepo && r.name === requestedReport)
  const report = current ? loadReport(current) : null

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6 md:p-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">
            hstack telemetry{' '}
            <span className="text-muted-foreground">
              — {current && report ? report.repo : 'all repos'}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {current && report
              ? `Generated ${report.generated} · ${report.window_days ? `last ${report.window_days} days` : 'all history'} · derived from frontmatter + git + transcripts (read-only)`
              : 'Consolidated view — latest report of each consuming repo, plus brain recommendations'}
          </p>
        </div>
        <ReportPicker reports={reports} current={current ?? null} />
      </header>

      {current && report ? (
        <RepoDashboard report={report} />
      ) : (
        <Consolidated entries={latestReports()} recommendations={listRecommendations()} />
      )}

      <footer className="pb-8 text-center text-xs text-muted-foreground">
        Derivative report — re-runnable from frontmatter, git, and transcripts. The artifacts are
        the source of truth.
      </footer>
    </main>
  )
}
