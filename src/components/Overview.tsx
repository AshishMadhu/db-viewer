import { useEffect, useState } from 'react'
import type { DbOverview, Driver, TableInfo } from '../lib/types'
import { bytes, num } from '../lib/format'

interface Props {
  driver: Driver
  tables: TableInfo[]
  onOpen: (t: TableInfo) => void
  onCountExact: () => Promise<void>
}

export function Overview({ driver, tables, onOpen, onCountExact }: Props) {
  const [info, setInfo] = useState<DbOverview | null>(null)
  const [counting, setCounting] = useState(false)

  useEffect(() => {
    driver.overview().then(setInfo).catch(() => setInfo(null))
  }, [driver])

  const real = tables.filter((t) => t.kind === 'table')
  const totalRows = real.reduce((s, t) => s + (t.rows ?? 0), 0)
  const indexes = tables.reduce((s, t) => s + t.indexCount, 0)
  const exact = real.length > 0 && real.every((t) => t.rowsExact)
  const sizes = [...tables].filter((t) => t.totalBytes).sort((a, b) => (b.totalBytes ?? 0) - (a.totalBytes ?? 0))
  const max = sizes[0]?.totalBytes ?? 1
  const rowsSorted = [...tables].sort((a, b) => (b.totalBytes ?? b.rows ?? 0) - (a.totalBytes ?? a.rows ?? 0))

  return (
    <div className="pane">
      <div className="pane-head">
        <h2>Overview</h2>
        {info && (
          <span className="muted">
            {info.engine} {info.version}
          </span>
        )}
      </div>

      <div className="cards">
        <div className="card">
          <div className="label">Database size</div>
          <div className="value">{bytes(info?.totalBytes)}</div>
        </div>
        <div className="card">
          <div className="label">Tables</div>
          <div className="value">{num(real.length)}</div>
          <div className="sub">{tables.length - real.length} views / other</div>
        </div>
        <div className="card">
          <div className="label">Rows {exact ? '' : '(estimated)'}</div>
          <div className="value">{num(totalRows)}</div>
          {!exact && (
            <button
              className="link"
              disabled={counting}
              onClick={async () => {
                setCounting(true)
                await onCountExact()
                setCounting(false)
              }}
            >
              {counting ? 'Counting…' : 'Count exactly'}
            </button>
          )}
        </div>
        <div className="card">
          <div className="label">Indexes</div>
          <div className="value">{num(indexes)}</div>
        </div>
      </div>

      {info && (
        <div className="kv">
          {info.extra.map(([k, v]) => (
            <div key={k}>
              <span className="muted">{k}</span>
              <span className="mono">{v}</span>
            </div>
          ))}
        </div>
      )}

      {sizes.length > 0 && (
        <>
          <h3>Storage by table</h3>
          <div className="bars">
            {sizes.slice(0, 15).map((t) => (
              <div className="bar-row" key={`${t.schema}.${t.name}`} onClick={() => onOpen(t)}>
                <span className="bar-label" title={t.name}>
                  {t.schema && t.schema !== 'public' ? `${t.schema}.` : ''}
                  {t.name}
                </span>
                <span className="bar-track">
                  <span className="bar-fill table" style={{ width: `${((t.tableBytes ?? 0) / max) * 100}%` }} />
                  <span className="bar-fill index" style={{ width: `${((t.indexBytes ?? 0) / max) * 100}%` }} />
                </span>
                <span className="bar-val">{bytes(t.totalBytes)}</span>
              </div>
            ))}
          </div>
          <div className="legend">
            <span>
              <i className="dot table" /> Table data
            </span>
            <span>
              <i className="dot index" /> Indexes
            </span>
          </div>
        </>
      )}

      <h3>All tables</h3>
      <table className="plain clickable">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th className="r">Rows</th>
            <th className="r">Table</th>
            <th className="r">Indexes</th>
            <th className="r">Total</th>
          </tr>
        </thead>
        <tbody>
          {rowsSorted.map((t) => (
            <tr key={`${t.schema}.${t.name}`} onClick={() => onOpen(t)}>
              <td>
                {t.schema && <span className="muted">{t.schema}.</span>}
                {t.name}
              </td>
              <td>
                <span className={`badge ${t.kind}`}>{t.kind}</span>
              </td>
              <td className="r">
                {t.rows === null ? '—' : `${t.rowsExact ? '' : '~'}${num(t.rows)}`}
              </td>
              <td className="r">{bytes(t.tableBytes)}</td>
              <td className="r">{bytes(t.indexBytes)}</td>
              <td className="r">{bytes(t.totalBytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
