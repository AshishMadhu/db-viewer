import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Driver, SavedConnection, TableInfo } from '../lib/types'
import { bytes, download, num } from '../lib/format'
import { Overview } from './Overview'
import { TableView } from './TableView'
import { QueryView } from './QueryView'

type Tab = { id: string; type: 'overview' | 'query' | 'table'; table?: TableInfo }
const key = (t: TableInfo) => `${t.schema ?? ''}.${t.name}`

export function Workspace({ conn, driver }: { conn: SavedConnection; driver: Driver }) {
  const [tables, setTables] = useState<TableInfo[]>([])
  const [tabs, setTabs] = useState<Tab[]>([{ id: 'overview', type: 'overview' }])
  const [active, setActive] = useState('overview')
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setTables(await driver.listTables())
      setDirty(!!driver.dirty)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [driver])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const countExact = useCallback(async () => {
    const next = [...tables]
    for (let i = 0; i < next.length; i++) {
      if (next[i].kind === 'view' || next[i].rowsExact) continue
      try {
        next[i] = { ...next[i], rows: await driver.countRows(next[i]), rowsExact: true }
      } catch {
        /* skip unreadable */
      }
    }
    setTables(next)
  }, [driver, tables])

  const openTable = (t: TableInfo) => {
    const id = `t:${key(t)}`
    setTabs((cur) => (cur.some((x) => x.id === id) ? cur : [...cur, { id, type: 'table', table: t }]))
    setActive(id)
  }
  const openQuery = () => {
    const id = `q:${Date.now()}`
    setTabs((cur) => [...cur, { id, type: 'query' }])
    setActive(id)
  }
  const closeTab = (id: string) => {
    setTabs((cur) => {
      const next = cur.filter((t) => t.id !== id)
      if (active === id) setActive(next[next.length - 1]?.id ?? 'overview')
      return next
    })
  }

  const grouped = useMemo(() => {
    const f = filter.toLowerCase()
    const m = new Map<string, TableInfo[]>()
    for (const t of tables) {
      if (f && !t.name.toLowerCase().includes(f)) continue
      const s = t.schema ?? ''
      m.set(s, [...(m.get(s) ?? []), t])
    }
    return [...m.entries()]
  }, [tables, filter])

  async function saveFile() {
    const data = driver.exportFile!()
    download(conn.fileName ?? `${conn.name}.sqlite`, data as BlobPart, 'application/vnd.sqlite3')
    driver.dirty = false
    setDirty(false)
  }

  return (
    <div className="workspace">
      <aside className="tree">
        <div className="tree-head">
          <input placeholder="Filter tables…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button title="Reload schema" onClick={() => void refresh()}>
            ↻
          </button>
        </div>
        <div className="tree-actions">
          <button onClick={() => { setActive('overview') }}>Overview</button>
          <button onClick={openQuery}>+ SQL</button>
          {driver.exportFile && (
            <button onClick={saveFile} title="Download the database file">
              {dirty ? 'Save •' : 'Save'}
            </button>
          )}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="tree-list">
          {grouped.map(([schema, list]) => (
            <div key={schema}>
              {schema && <div className="schema-name">{schema}</div>}
              {list.map((t) => (
                <div
                  key={key(t)}
                  className={`tree-item ${active === `t:${key(t)}` ? 'active' : ''}`}
                  onClick={() => openTable(t)}
                  title={t.comment ?? ''}
                >
                  <span className={`ico ${t.kind}`}>{t.kind === 'table' ? '▦' : '◫'}</span>
                  <span className="name">{t.name}</span>
                  <span className="meta">{t.totalBytes !== null ? bytes(t.totalBytes) : num(t.rows)}</span>
                </div>
              ))}
            </div>
          ))}
          {!tables.length && !error && <div className="muted pad">No tables</div>}
        </div>
      </aside>

      <section className="main">
        <div className="tabs">
          {tabs.map((t) => (
            <div key={t.id} className={`tab ${active === t.id ? 'active' : ''}`} onClick={() => setActive(t.id)}>
              {t.type === 'overview' ? 'Overview' : t.type === 'query' ? 'SQL' : t.table!.name}
              {t.id !== 'overview' && (
                <button
                  className="x"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(t.id)
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="content">
          {tabs.map((t) => (
            <div key={t.id} hidden={t.id !== active} className="tab-body">
              {t.type === 'overview' && <Overview driver={driver} tables={tables} onOpen={openTable} onCountExact={countExact} />}
              {t.type === 'table' && <TableView driver={driver} table={t.table!} />}
              {t.type === 'query' && <QueryView driver={driver} onMutated={() => void refresh()} />}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
