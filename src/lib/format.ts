export function bytes(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB', 'TB', 'PB']
  let v = n
  let i = -1
  do {
    v /= 1024
    i++
  } while (v >= 1024 && i < u.length - 1)
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${u[i]}`
}

export function num(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString()
}

export function cellText(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString()
  if (v instanceof Uint8Array) {
    const hex = Array.from(v.slice(0, 32), (b) => b.toString(16).padStart(2, '0')).join('')
    return `\\x${hex}${v.length > 32 ? '…' : ''} (${v.length} bytes)`
  }
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function cellFull(v: unknown): string {
  if (v instanceof Uint8Array) return Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')
  if (v !== null && typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v, null, 2)
  return cellText(v)
}

export function toCsv(columns: string[], rows: unknown[][]): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return ''
    const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n')
}

export function download(name: string, data: BlobPart, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`
