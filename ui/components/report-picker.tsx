'use client'

import { useRouter } from 'next/navigation'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@gomoso-ai/design-system/primitives'

export interface PickerEntry {
  repo: string
  name: string
}

const CONSOLIDATED = '::consolidated'

export function ReportPicker({
  reports,
  current,
}: {
  reports: PickerEntry[]
  current: PickerEntry | null
}) {
  const router = useRouter()
  const repos = [...new Set(reports.map((r) => r.repo))]
  return (
    <Select
      value={current ? `${current.repo}::${current.name}` : CONSOLIDATED}
      onValueChange={(v) => {
        if (v === CONSOLIDATED) {
          router.push('/')
          return
        }
        const [repo, name] = v.split('::')
        router.push(`/?repo=${encodeURIComponent(repo)}&report=${encodeURIComponent(name)}`)
      }}
    >
      <SelectTrigger className="w-72">
        <SelectValue placeholder="Report" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={CONSOLIDATED}>All repos — consolidated</SelectItem>
        {repos.map((repo) => (
          <SelectGroup key={repo}>
            <SelectLabel>{repo}</SelectLabel>
            {reports
              .filter((r) => r.repo === repo)
              .map((r) => (
                <SelectItem key={`${r.repo}::${r.name}`} value={`${r.repo}::${r.name}`}>
                  {r.name}
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
