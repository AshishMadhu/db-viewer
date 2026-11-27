import { useEffect, useRef, useState } from 'react'
import type { Driver, SavedConnection } from './lib/types'
import { isUnlocked, lock } from './lib/vault'
import { delHandle, loadConnections, saveConnections } from './lib/store'
import { openConnection } from './lib/connect'
import { Gate } from './components/Gate'
import { ConnectionForm } from './components/ConnectionForm'
import { Workspace } from './components/Workspace'

export default function App() {
  const [unlocked, setUnlocked] = useState(isUnlocked())
  const [conns, setConns] = useState<SavedConnection[]>(loadConnections())
  const [sessions, setSessions] = useState<Record<string, Driver>>({})
  const [active, setActive] = useState<string | null>(null)
  const [editing, setEditing] = useState<SavedConnection | 'new' | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  useEffect(() => saveConnections(conns), [conns])

  if (!unlocked) return <Gate onUnlocked={() => setUnlocked(true)} />

  async function open(c: SavedConnection) {
    setError('')
    if (sessions[c.id]) return setActive(c.id)
    setConnecting(c.id)
    try {
      const d = await openConnection(c)
      setSessions((s) => ({ ...s, [c.id]: d }))
      setActive(c.id)
    } catch (e) {
      setError(`${c.name}: ${(e as Error).message || e}`)
    } finally {
      setConnecting(null)
    }
  }

  async function disconnect(id: string) {
    await sessions[id]?.close()
    setSessions((s) => {
      const { [id]: _, ...rest } = s
      return rest
    })
    if (active === id) setActive(null)
  }

  async function remove(c: SavedConnection) {
    if (!confirm(`Delete connection "${c.name}"?`)) return
    await disconnect(c.id)
    await delHandle(c.id).catch(() => {})
    setConns((l) => l.filter((x) => x.id !== c.id))
  }

  function upsert(c: SavedConnection) {
    setConns((l) => (l.some((x) => x.id === c.id) ? l.map((x) => (x.id === c.id ? c : x)) : [...l, c]))
    // a changed connection must reconnect
    if (sessions[c.id]) void disconnect(c.id)
    setEditing(null)
  }

  const activeConn = conns.find((c) => c.id === active)

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">▦ DB Viewer</div>
        <button className="primary add" onClick={() => setEditing('new')}>
          + New connection
        </button>
        <div className="conn-list">
          {conns.map((c) => (
            <div key={c.id} className={`conn ${active === c.id ? 'active' : ''}`} onClick={() => void open(c)}>
              <span className="dot" style={{ background: c.color, opacity: sessions[c.id] ? 1 : 0.35 }} />
              <div className="conn-info">
                <div className="conn-name">{c.name}</div>
                <div className="conn-sub">
                  {c.kind === 'postgres' ? `${c.host}:${c.port}/${c.database}` : c.fileName}
                  {c.readOnly && ' · RO'}
                </div>
              </div>
              {connecting === c.id && <span className="spin">…</span>}
              <span className="conn-actions" onClick={(e) => e.stopPropagation()}>
                {sessions[c.id] && (
                  <button title="Disconnect" onClick={() => void disconnect(c.id)}>
                    ⏏
                  </button>
                )}
                <button title="Edit" onClick={() => setEditing(c)}>
                  ✎
                </button>
                <button title="Delete" onClick={() => void remove(c)}>
                  🗑
                </button>
              </span>
            </div>
          ))}
          {!conns.length && <p className="muted pad">No saved connections yet.</p>}
        </div>
        <button
          className="lock"
          onClick={() => {
            Object.values(sessionsRef.current).forEach((d) => void d.close())
            lock()
            setSessions({})
            setActive(null)
            setUnlocked(false)
          }}
        >
          🔒 Lock
        </button>
      </nav>

      <main className="stage">
        {error && (
          <div className="error banner">
            {error} <button className="link" onClick={() => setError('')}>dismiss</button>
          </div>
        )}
        {activeConn && sessions[activeConn.id] ? (
          <Workspace key={activeConn.id} conn={activeConn} driver={sessions[activeConn.id]} />
        ) : (
          <div className="welcome">
            <h2>Select or create a connection</h2>
            <p className="muted">PostgreSQL and SQLite. Everything runs in your browser; passwords are encrypted at rest.</p>
          </div>
        )}
      </main>

      {editing && <ConnectionForm initial={editing === 'new' ? undefined : editing} onSave={upsert} onCancel={() => setEditing(null)} />}
    </div>
  )
}
