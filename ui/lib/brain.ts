import fs from 'node:fs'
import path from 'node:path'

export interface Recommendation {
  id: string
  title: string
  status: 'proposed' | 'accepted' | 'rejected' | 'implemented' | 'superseded'
  confidence: 'high' | 'medium' | 'low'
  category: string
  impact: 'high' | 'medium' | 'low'
  effort: 'small' | 'medium' | 'large'
  sources: string[]
  created: string
  updated: string
  /** Section title → markdown-ish body (paragraphs and `- ` bullets only). */
  sections: { title: string; body: string }[]
}

/** brain/recommendations/ — the UI lives at <hstack-repo>/ui, brain at <hstack-repo>/brain. */
function brainDir(): string {
  return (
    process.env.HSTACK_BRAIN_DIR ?? path.resolve(process.cwd(), '..', 'brain', 'recommendations')
  )
}

/** Minimal frontmatter parser for the recommendation contract (flat keys + [a, b] arrays). */
function parseFrontmatter(raw: string): { meta: Record<string, string | string[]>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { meta: {}, body: raw }
  const meta: Record<string, string | string[]> = {}
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([a-z-]+):\s*(.*)$/)
    if (!kv) continue
    const [, key, value] = kv
    const cleaned = value.replace(/\s+#.*$/, '').trim()
    meta[key] = cleaned.startsWith('[')
      ? cleaned
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : cleaned
  }
  return { meta, body: match[2] }
}

function parseSections(body: string): { title: string; body: string }[] {
  const sections: { title: string; body: string }[] = []
  let current: { title: string; body: string } | null = null
  for (const line of body.split('\n')) {
    const heading = line.match(/^##\s+(.*)$/)
    if (heading) {
      if (current) sections.push({ ...current, body: current.body.trim() })
      current = { title: heading[1], body: '' }
    } else if (current) {
      current.body += line + '\n'
    }
  }
  if (current) sections.push({ ...current, body: current.body.trim() })
  return sections
}

export function listRecommendations(): Recommendation[] {
  const dir = brainDir()
  if (!fs.existsSync(dir)) return []
  const recs: Recommendation[] = []
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    try {
      const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(dir, file), 'utf-8'))
      if (!meta.id || !meta.title) continue
      recs.push({
        id: String(meta.id),
        title: String(meta.title),
        status: (meta.status as Recommendation['status']) ?? 'proposed',
        confidence: (meta.confidence as Recommendation['confidence']) ?? 'medium',
        category: String(meta.category ?? 'workflow'),
        impact: (meta.impact as Recommendation['impact']) ?? 'medium',
        effort: (meta.effort as Recommendation['effort']) ?? 'medium',
        sources: Array.isArray(meta.sources) ? meta.sources : [],
        created: String(meta.created ?? ''),
        updated: String(meta.updated ?? ''),
        sections: parseSections(body),
      })
    } catch {
      // Skip unreadable files; the analyst or engineer will notice in git.
    }
  }
  const statusOrder = { proposed: 0, accepted: 1, implemented: 2, rejected: 3, superseded: 4 }
  const impactOrder = { high: 0, medium: 1, low: 2 }
  return recs.sort(
    (a, b) =>
      statusOrder[a.status] - statusOrder[b.status] ||
      impactOrder[a.impact] - impactOrder[b.impact] ||
      a.id.localeCompare(b.id),
  )
}
