import { useState } from 'react'
import type { Kind, SavedConnection, SslMode } from '../lib/types'
import { encryptSecret } from '../lib/vault'
import { openConnection, pickSqliteFile, type PickedFile } from '../lib/connect'
import { canPickFiles, putHandle } from '../lib/store'

const COLORS = ['#6ea8fe', '#75b798', '#ffc107', '#ea868f', '#c29ffa', '#6edff6']

function parseUrl(url: string) {
  try {
    const u = new URL(url)
    if (!/^postgres(ql)?:$/.test(u.protocol)) return null
    return {
      host: u.hostname,
      port: Number(u.port || 5432),
      database: decodeURIComponent(u.pathname.slice(1)) || 'postgres',
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      ssl: (['require', 'verify-full', 'verify-ca'].includes(u.searchParams.get('sslmode') ?? '') ? (u.searchParams.get('sslmode') === 'require' ? 'require' : 'verify') : 'off') as SslMode,
    }
  } catch {
    return null
  }
}

interface Props {
  initial?: SavedConnection
  onSave: (c: SavedConnection) => void
  onCancel: () => void
}

export function ConnectionForm({ initial, onSave, onCancel }: Props) {
  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'postgres')
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? COLORS[0])
  const [readOnly, setReadOnly] = useState(initial?.readOnly ?? true)
  const [url, setUrl] = useState('')
  const [host, setHost] = useState(initial?.host ?? 'localhost')
  const [port, setPort] = useState(String(initial?.port ?? 5432))
  const [database, setDatabase] = useState(initial?.database ?? 'postgres')
  const [user, setUser] = useState(initial?.user ?? 'postgres')
  const [password, setPassword] = useState('')
  const [passwordChanged, setPasswordChanged] = useState(false)
  const [ssl, setSsl] = useState<SslMode>(initial?.ssl ?? 'off')
  const [picked, setPicked] = useState<PickedFile | null>(null)
  const [fileName, setFileName] = useState(initial?.fileName ?? '')
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [busy, setBusy] = useState(false)

  function applyUrl(v: string) {
    setUrl(v)
    const p = parseUrl(v)
    if (!p) return
    setHost(p.host)
    setPort(String(p.port))
    setDatabase(p.database)
    setUser(p.user)
    setPassword(p.password)
    setPasswordChanged(true)
    setSsl(p.ssl)
    if (!name) setName(`${p.database}@${p.host}`)
  }

  async function build(): Promise<SavedConnection> {
    const id = initial?.id ?? crypto.randomUUID()
    const base = { id, name: name.trim() || (kind === 'sqlite' ? fileName : `${database}@${host}`), kind, color, readOnly, createdAt: initial?.createdAt ?? Date.now() }
    if (kind === 'sqlite') {
      let hasHandle = initial?.hasHandle ?? false
      if (picked?.handle) {
        await putHandle(id, picked.handle)
        hasHandle = true
      }
      return { ...base, fileName, hasHandle }
    }
    const pw = passwordChanged ? (password ? await encryptSecret(password) : null) : (initial?.password ?? null)
    return { ...base, host: host.trim(), port: Number(port) || 5432, database: database.trim(), user: user.trim(), ssl, password: pw }
  }

  async function test() {
    setBusy(true)
    setStatus(null)
    try {
      const c = await build()
      // Use the typed password directly when it was edited; otherwise decrypt the stored one inside openConnection.
      const d = await openConnection(c, picked ?? undefined)
      const o = await d.overview()
      await d.close()
      setStatus({ ok: true, msg: `Connected — ${o.engine} ${o.version}` })
    } catch (e) {
      setStatus({ ok: false, msg: (e as Error).message || String(e) })
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    setBusy(true)
    try {
      onSave(await build())
    } catch (e) {
      setStatus({ ok: false, msg: (e as Error).message })
      setBusy(false)
    }
  }

  async function choose() {
    const p = await pickSqliteFile()
    if (!p) return
    setPicked(p)
    setFileName(p.file.name)
    if (!name) setName(p.file.name)
  }

  const valid = kind === 'sqlite' ? !!(picked || initial?.fileName) : !!(host && database && user)

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal">
        <h2>{initial ? 'Edit connection' : 'New connection'}</h2>

        <div className="seg">
          {(['postgres', 'sqlite'] as Kind[]).map((k) => (
            <button key={k} className={kind === k ? 'active' : ''} onClick={() => !initial && setKind(k)} disabled={!!initial && initial.kind !== k}>
              {k === 'postgres' ? 'PostgreSQL' : 'SQLite'}
            </button>
          ))}
        </div>

        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My database" />
        </label>

        {kind === 'postgres' ? (
          <>
            <label>
              Connection URL <span className="muted">(optional, paste to fill the fields)</span>
              <input value={url} onChange={(e) => applyUrl(e.target.value)} placeholder="postgresql://user:pass@host:5432/dbname?sslmode=require" />
            </label>
            <div className="row">
              <label className="grow">
                Host
                <input value={host} onChange={(e) => setHost(e.target.value)} />
              </label>
              <label style={{ width: 90 }}>
                Port
                <input value={port} onChange={(e) => setPort(e.target.value)} />
              </label>
            </div>
            <div className="row">
              <label className="grow">
                Database
                <input value={database} onChange={(e) => setDatabase(e.target.value)} />
              </label>
              <label className="grow">
                User
                <input value={user} onChange={(e) => setUser(e.target.value)} />
              </label>
            </div>
            <label>
              Password <span className="muted">(encrypted with your master password)</span>
              <input
                type="password"
                value={password}
                placeholder={initial?.password && !passwordChanged ? '•••••••• (unchanged)' : ''}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setPasswordChanged(true)
                }}
                autoComplete="off"
              />
            </label>
            <label>
              SSL
              <select value={ssl} onChange={(e) => setSsl(e.target.value as SslMode)}>
                <option value="off">Off</option>
                <option value="require">Require (don't verify certificate)</option>
                <option value="verify">Require + verify certificate</option>
              </select>
            </label>
          </>
        ) : (
          <label>
            Database file
            <div className="row">
              <input className="grow" readOnly value={fileName} placeholder="No file selected" />
              <button type="button" onClick={choose}>
                Browse…
              </button>
            </div>
            <span className="muted">
              {canPickFiles()
                ? 'The file reference is remembered so you can reopen it with one click (your browser will ask permission).'
                : 'This browser can’t remember file references; you’ll pick the file each time you open it.'}
            </span>
          </label>
        )}

        <label className="check">
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
          Read-only (blocks writes from the SQL editor)
        </label>

        <div className="colors">
          {COLORS.map((c) => (
            <button key={c} className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>

        {status && <div className={status.ok ? 'ok' : 'error'}>{status.msg}</div>}

        <div className="modal-actions">
          <button onClick={test} disabled={busy || !valid}>
            {busy ? 'Working…' : 'Test'}
          </button>
          <span className="spacer" />
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy || !valid}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
