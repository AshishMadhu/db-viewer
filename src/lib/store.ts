import type { SavedConnection } from './types'

const KEY = 'dbv.connections'
const HISTORY_KEY = 'dbv.history'

export function loadConnections(): SavedConnection[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}

export function saveConnections(list: SavedConnection[]) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

export function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function pushHistory(sql: string) {
  const list = [sql, ...loadHistory().filter((s) => s !== sql)].slice(0, 50)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list))
}

// ---- IndexedDB for SQLite file handles (File System Access API) ----
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dbv', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('handles')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction('handles', mode).objectStore('handles'))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const putHandle = (id: string, h: FileSystemFileHandle) => tx('readwrite', (s) => s.put(h, id))
export const getHandle = (id: string) => tx<FileSystemFileHandle | undefined>('readonly', (s) => s.get(id))
export const delHandle = (id: string) => tx('readwrite', (s) => s.delete(id))

export const canPickFiles = () => 'showOpenFilePicker' in window
