import { useState } from 'react'
import type { Driver, QueryResult } from '../lib/types'
import { loadHistory, pushHistory } from '../lib/store'
import { DataGrid } from './DataGrid'

export function QueryView({ driver, onMutated }: { driver: Driver; onMutated: () => void }) {
  const [sql, setSql] = useState('select 1;')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState(loadHistory())

  async function run() {
    const text = sql.trim()
    if (!text) return
    setRunning(true)
    setError('')
    try {
      const r = await driver.query(text)
      setResult(r)
      pushHistory(text)
      setHistory(loadHistory())
      if (!r.columns.length) onMutated()
    } catch (e) {
      setResult(null)
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="pane">
      <div className="pane-head">
        <h2>SQL query</h2>
      </div>
      <textarea
        className="editor mono"
        spellCheck={false}
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault()
            void run()
          }
        }}
      />
      <div className="toolbar">
        <button className="primary" onClick={() => void run()} disabled={running}>
          {running ? 'Running…' : 'Run (Ctrl+Enter)'}
        </button>
        <select value="" onChange={(e) => e.target.value && setSql(e.target.value)}>
          <option value="">History…</option>
          {history.map((h, i) => (
            <option key={i} value={h}>
              {h.replace(/\s+/g, ' ').slice(0, 90)}
            </option>
          ))}
        </select>
      </div>
      {error && <div className="error">{error}</div>}
      {result && <DataGrid result={result} exportName="query-result" />}
    </div>
  )
}
