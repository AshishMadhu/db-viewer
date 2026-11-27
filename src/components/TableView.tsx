import { useCallback, useEffect, useState } from 'react'
import type { Driver, QueryResult, TableDetail, TableInfo } from '../lib/types'
import { bytes, num } from '../lib/format'
import { DataGrid } from './DataGrid'

const PAGE_SIZES = [50, 100, 500, 1000]

export function TableView({ driver, table }: { driver: Driver; table: TableInfo }) {
  const [tab, setTab] = useState<'data' | 'structure'>('data')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(100)
  const [orderBy, setOrderBy] = useState<string | undefined>()
  const [desc, setDesc] = useState(false)
  const [whereDraft, setWhereDraft] = useState('')
  const [where, setWhere] = useState('')
  const [total, setTotal] = useState<number | null>(null)
  const [detail, setDetail] = useState<TableDetail | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setResult(await driver.selectRows(table, { limit: pageSize, offset: page * pageSize, orderBy, desc, where }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [driver, table, page, pageSize, orderBy, desc, where])

  useEffect(() => {
    if (tab === 'data') void load()
  }, [load, tab])

  // exact row count (also respects the WHERE filter)
  useEffect(() => {
    let live = true
    setTotal(null)
    const run = where.trim()
      ? driver.query(`select count(*) from ${table.schema ? `"${table.schema}".` : ''}"${table.name}" where ${where}`).then((r) => Number(r.rows[0][0]))
      : driver.countRows(table)
    run.then((n) => live && setTotal(n)).catch(() => live && setTotal(null))
    return () => {
      live = false
    }
  }, [driver, table, where])

  useEffect(() => {
    if (tab === 'structure' && !detail) driver.describe(table).then(setDetail).catch((e) => setError(e.message))
  }, [tab, detail, driver, table])

  const pages = total === null ? null : Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="pane">
      <div className="pane-head">
        <h2>
          {table.schema && <span className="muted">{table.schema}.</span>}
          {table.name} <span className={`badge ${table.kind}`}>{table.kind}</span>
        </h2>
        <div className="stats">
          <span>{num(total ?? table.rows)} rows</span>
          {table.totalBytes !== null && (
            <>
              <span>{bytes(table.totalBytes)} total</span>
              <span>{bytes(table.tableBytes)} table</span>
              <span>{bytes(table.indexBytes)} indexes</span>
            </>
          )}
        </div>
        <div className="tabs small">
          <button className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')}>
            Data
          </button>
          <button className={tab === 'structure' ? 'active' : ''} onClick={() => setTab('structure')}>
            Structure
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {tab === 'data' && (
        <>
          <form
            className="toolbar"
            onSubmit={(e) => {
              e.preventDefault()
              setPage(0)
              setWhere(whereDraft)
            }}
          >
            <input
              className="grow mono"
              placeholder="WHERE clause, e.g.  id > 100 and status = 'active'"
              value={whereDraft}
              onChange={(e) => setWhereDraft(e.target.value)}
            />
            <button type="submit">Filter</button>
            <button type="button" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <span className="spacer" />
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
              ‹
            </button>
            <span className="muted">
              Page {page + 1}
              {pages ? ` / ${pages}` : ''}
            </span>
            <button type="button" disabled={pages !== null ? page + 1 >= pages : (result?.rows.length ?? 0) < pageSize} onClick={() => setPage(page + 1)}>
              ›
            </button>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(0)
              }}
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} / page
                </option>
              ))}
            </select>
          </form>
          {result && (
            <DataGrid
              result={result}
              orderBy={orderBy}
              desc={desc}
              exportName={table.name}
              onSort={(c) => {
                if (orderBy === c) {
                  if (desc) setOrderBy(undefined)
                  setDesc(!desc)
                } else {
                  setOrderBy(c)
                  setDesc(false)
                }
                setPage(0)
              }}
            />
          )}
        </>
      )}

      {tab === 'structure' && detail && (
        <div className="structure">
          <h3>Columns</h3>
          <table className="plain">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Nullable</th>
                <th>Default</th>
                <th>Key</th>
              </tr>
            </thead>
            <tbody>
              {detail.columns.map((c) => (
                <tr key={c.name}>
                  <td className="mono">{c.name}</td>
                  <td className="mono">{c.type}</td>
                  <td>{c.nullable ? 'yes' : 'no'}</td>
                  <td className="mono">{c.default ?? ''}</td>
                  <td>{c.primaryKey ? <span className="badge table">PK</span> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Indexes ({detail.indexes.length})</h3>
          {detail.indexes.length ? (
            <table className="plain">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Definition</th>
                  <th>Unique</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody>
                {detail.indexes.map((i) => (
                  <tr key={i.name}>
                    <td className="mono">
                      {i.name} {i.primary && <span className="badge table">PK</span>}
                    </td>
                    <td className="mono wrap">{i.definition}</td>
                    <td>{i.unique ? 'yes' : 'no'}</td>
                    <td>{bytes(i.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">None</p>
          )}

          <h3>Constraints ({detail.constraints.length})</h3>
          {detail.constraints.length ? (
            <table className="plain">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Definition</th>
                </tr>
              </thead>
              <tbody>
                {detail.constraints.map((c) => (
                  <tr key={c.name}>
                    <td className="mono">{c.name}</td>
                    <td>{c.type}</td>
                    <td className="mono wrap">{c.definition}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">None</p>
          )}

          {detail.ddl && (
            <>
              <h3>DDL</h3>
              <pre className="ddl">{detail.ddl}</pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
