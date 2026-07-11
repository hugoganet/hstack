import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@gomoso-ai/design-system/primitives'
import type { Recommendation } from '@/lib/brain'

const statusVariant: Record<Recommendation['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  proposed: 'default',
  accepted: 'secondary',
  implemented: 'outline',
  rejected: 'destructive',
  superseded: 'outline',
}

/** Renders the constrained recommendation markdown: paragraphs + `- ` bullets. */
function SectionBody({ body }: { body: string }) {
  const blocks = body.split(/\n\s*\n/)
  return (
    <div className="flex flex-col gap-2 text-sm text-muted-foreground">
      {blocks.map((block, i) => {
        const lines = block.split('\n')
        if (lines.every((l) => l.trim().startsWith('- ') || l.trim() === '' || l.startsWith('  '))) {
          // Bullet block (with possible wrapped continuation lines).
          const items: string[] = []
          for (const l of lines) {
            if (l.trim().startsWith('- ')) items.push(l.trim().slice(2))
            else if (items.length > 0) items[items.length - 1] += ' ' + l.trim()
          }
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {items.map((item, j) => (
                <li key={j}>{item.replaceAll('`', '')}</li>
              ))}
            </ul>
          )
        }
        return <p key={i}>{block.replaceAll('\n', ' ').replaceAll('`', '')}</p>
      })}
    </div>
  )
}

export function Recommendations({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) {
    return (
      <Empty className="py-10">
        <EmptyHeader>
          <EmptyTitle>No recommendations yet</EmptyTitle>
          <EmptyDescription>
            The weekly brain analysis writes them to brain/recommendations/ — see brain/ANALYSIS.md.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <Accordion type="multiple" className="w-full">
      {recommendations.map((rec) => (
        <AccordionItem key={rec.id} value={rec.id}>
          <AccordionTrigger className="gap-3 text-left">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <Badge variant={statusVariant[rec.status]}>{rec.status}</Badge>
              <span className="font-medium">{rec.title}</span>
              <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <Badge variant="outline">impact: {rec.impact}</Badge>
                <Badge variant="outline">effort: {rec.effort}</Badge>
                <Badge variant="outline">confidence: {rec.confidence}</Badge>
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-4 pb-2">
              <p className="text-xs text-muted-foreground">
                {rec.id} · {rec.category} · sources: {rec.sources.join(', ') || '–'} · updated{' '}
                {rec.updated}
              </p>
              {rec.sections.map((section) => (
                <div key={section.title} className="flex flex-col gap-1.5">
                  <h4 className="text-sm font-semibold">{section.title}</h4>
                  <SectionBody body={section.body} />
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
