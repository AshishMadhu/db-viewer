import { useState } from 'react'
import { createVault, hasVault, resetVault, unlock } from '../lib/vault'

export function Gate({ onUnlocked }: { onUnlocked: () => void }) {
  const exists = hasVault()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!exists) {
      if (pw.length < 8) return setError('Use at least 8 characters.')
      if (pw !== pw2) return setError('Passwords do not match.')
    }
    setBusy(true)
    try {
      if (!exists) {
        await createVault(pw)
        onUnlocked()
      } else if (await unlock(pw)) {
        onUnlocked()
      } else {
        setError('Wrong master password.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="logo">▦</div>
        <h1>DB Viewer</h1>
        <p className="muted">
          {exists
            ? 'Enter your master password to unlock saved connections.'
            : 'Choose a master password. It encrypts the database passwords saved in this browser and is never stored — if you forget it, saved passwords cannot be recovered.'}
        </p>
        <input type="password" autoFocus placeholder="Master password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {!exists && <input type="password" placeholder="Confirm master password" value={pw2} onChange={(e) => setPw2(e.target.value)} />}
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy || !pw}>
          {busy ? 'Working…' : exists ? 'Unlock' : 'Create vault'}
        </button>
        {exists && (
          <button
            type="button"
            className="link danger"
            onClick={() => {
              if (confirm('This deletes the vault and ALL saved connections on this browser. Continue?')) {
                resetVault()
                localStorage.removeItem('dbv.connections')
                location.reload()
              }
            }}
          >
            Forgot password? Reset vault
          </button>
        )}
      </form>
    </div>
  )
}
