import type { Driver, SavedConnection } from './types'
import { connectPostgres } from './drivers/postgres'
import { openSqlite } from './drivers/sqlite'
import { decryptSecret } from './vault'
import { canPickFiles, getHandle, putHandle } from './store'

export interface PickedFile {
  file: File
  handle?: FileSystemFileHandle
}

/** Must be called from a user gesture (click). */
export async function pickSqliteFile(): Promise<PickedFile | null> {
  if (canPickFiles()) {
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [{ description: 'SQLite database', accept: { 'application/vnd.sqlite3': ['.sqlite', '.sqlite3', '.db', '.db3', '.s3db'] } }],
        excludeAcceptAllOption: false,
      })
      return { file: await handle.getFile(), handle }
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return null
      throw e
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.onchange = () => resolve(input.files?.[0] ? { file: input.files[0] } : null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

export async function openConnection(conn: SavedConnection, picked?: PickedFile): Promise<Driver> {
  if (conn.kind === 'postgres') {
    const password = conn.password ? await decryptSecret(conn.password) : ''
    return connectPostgres({
      host: conn.host ?? 'localhost',
      port: conn.port ?? 5432,
      database: conn.database ?? 'postgres',
      user: conn.user ?? 'postgres',
      password,
      ssl: conn.ssl ?? 'off',
      readOnly: conn.readOnly,
    })
  }

  let file = picked?.file
  if (!file && conn.hasHandle) {
    const handle = await getHandle(conn.id)
    if (handle) {
      const perm = await (handle as any).requestPermission({ mode: 'read' })
      if (perm === 'granted') file = await handle.getFile()
    }
  }
  if (!file) {
    const p = await pickSqliteFile()
    if (!p) throw new Error('No file selected')
    file = p.file
    if (p.handle && conn.hasHandle) await putHandle(conn.id, p.handle)
  }
  return openSqlite(new Uint8Array(await file.arrayBuffer()), conn.readOnly)
}
