import { useState } from 'react'
import type { QueryResult } from '../lib/types'
import { cellFull, cellText, download, toCsv } from '../lib/format'

interface Props {
  result: QueryResult
  orderBy?: string
  desc?: boolean
  onSort?: (col: string) => void
  exportName?: string
}

export function DataGrid({ result, orderBy, desc, onSort, exportName = 'export' }: Props) {
  const [sel, setSel] = useState<{ col: string; value: unknown } | null>(null)

  if (!result.columns.length) {
    return (
      <div className="empty">
        {result.command ?? 'OK'} — {result.rowCount ?? 0} row(s) affected · {result.durationMs.toFixed(1)} ms
      </div>
    )
  }

  return (
    <div className="grid-wrap">
      <div className="grid-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th className="rownum">#</th>
              {result.columns.map((c) => (
                <th key={c.name} className={onSort ? 'sortable' : ''} onClick={() => onSort?.(c.name)}>
                  {c.name}
                  {orderBy === c.name && <span className="sort">{desc ? ' ▼' : ' ▲'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i}>
                <td className="rownum">{i + 1}</td>
                {row.map((v, j) => (
                  <td
                    key={j}
                    className={v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'bigint' ? 'numeric' : ''}
                    title={cellText(v)}
                    onClick={() => setSel({ col: result.columns[j].name, value: v })}
                  >
                    {cellText(v)}
                  </td>
                ))}
              </tr>
            ))}
            {!result.rows.length && (
              <tr>
                <td colSpan={result.columns.length + 1} className="empty">
                  No rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {sel && (
        <div className="cell-detail">
          <div className="cell-detail-head">
            <strong>{sel.col}</strong>
            <span>
              <button className="link" onClick={() => navigator.clipboard.writeText(cellFull(sel.value))}>
                Copy
              </button>
              <button className="link" onClick={() => setSel(null)}>
                Close
              </button>
            </span>
          </div>
          <pre>{cellFull(sel.value)}</pre>
        </div>
      )}
      <div className="grid-foot">
        <span>
          {result.rows.length.toLocaleString()} row(s) · {result.durationMs.toFixed(1)} ms
        </span>
        <button
          className="link"
          onClick={() =>
            download(`${exportName}.csv`, toCsv(result.columns.map((c) => c.name), result.rows))
          }
        >
          Export CSV
        </button>
      </div>
    </div>
  )
}
