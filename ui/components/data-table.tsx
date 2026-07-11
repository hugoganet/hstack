import type { ReactNode } from 'react'
import {
  Empty,
  EmptyDescription,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gomoso-ai/design-system/primitives'

export interface Column<T> {
  header: string
  cell: (row: T) => ReactNode
  align?: 'left' | 'right'
}

export function DataTable<T>({ columns, rows }: { columns: Column<T>[]; rows: T[] }) {
  if (rows.length === 0) {
    return (
      <Empty className="py-8">
        <EmptyDescription>No data in this window.</EmptyDescription>
      </Empty>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.header} className={c.align === 'right' ? 'text-right' : undefined}>
              {c.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={i}>
            {columns.map((c) => (
              <TableCell
                key={c.header}
                className={c.align === 'right' ? 'text-right tabular-nums' : undefined}
              >
                {c.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
