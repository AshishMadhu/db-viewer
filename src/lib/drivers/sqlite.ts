import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type { Driver, QueryResult, RowQuery, TableDetail, TableInfo, TableRef } from '../types'
import { quoteIdent } from '../format'

let sqlPromise: Promise<SqlJsStatic> | null = null
const getSql = () => (sqlPromise ??= initSqlJs({ locateFile: () => wasmUrl }))

const READ_ONLY_RE = /^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*(select|with|pragma|explain|values)\b/i

export async function openSqlite(data: Uint8Array, readOnly: boolean): Promise<Driver> {
  const SQL = await getSql()
  const db: Database = new SQL.Database(data)
  // Validate it's really a SQLite file (throws "file is not a database" otherwise)
  db.exec('select count(*) from sqlite_master')
  if (readOnly) db.exec('PRAGMA query_only = 1')

  const driver: Driver = {
    kind: 'sqlite',
    dirty: false,

    async overview() {
      const one = (sql: string) => db.exec(sql)[0]?.values[0]?.[0]
      const pageSize = Number(one('PRAGMA page_size'))
      const pages = Number(one('PRAGMA page_count'))
      const free = Number(one('PRAGMA freelist_count'))
      return {
        engine: 'SQLite',
        version: String(one('select sqlite_version()')),
        totalBytes: pageSize * pages,
        extra: [
          ['Page size', `${pageSize} B`],
          ['Pages', pages.toLocaleString()],
          ['Free pages', free.toLocaleString()],
          ['Encoding', String(one('PRAGMA encoding'))],
          ['Journal mode', String(one('PRAGMA journal_mode'))],
          ['User version', String(one('PRAGMA user_version'))],
          ['Foreign keys', Number(one('PRAGMA foreign_keys')) ? 'on' : 'off'],
        ],
      }
    },

    async listTables() {
      const master = db.exec(`select name, type, tbl_name from sqlite_master where name not like 'sqlite_%'`)[0]?.values ?? []
      // dbstat gives per-object page usage when the build includes it; fall back to "unknown" otherwise.
      const usage = new Map<string, number>()
      try {
        for (const [name, size] of db.exec('select name, sum(pgsize) from dbstat group by name')[0]?.values ?? []) {
          usage.set(String(name), Number(size))
        }
      } catch {
        /* dbstat unavailable */
      }
      const hasUsage = usage.size > 0
      const out: TableInfo[] = []
      for (const [name, type] of master) {
        if (type !== 'table' && type !== 'view') continue
        const idx = master.filter((m) => m[1] === 'index' && m[2] === name)
        const tableBytes = hasUsage && type === 'table' ? (usage.get(String(name)) ?? 0) : null
        const indexBytes = hasUsage && type === 'table' ? idx.reduce((s, i) => s + (usage.get(String(i[0])) ?? 0), 0) : null
        let rows: number | null = null
        try {
          rows = Number(db.exec(`select count(*) from ${quoteIdent(String(name))}`)[0].values[0][0])
        } catch {
          /* broken view */
        }
        out.push({
          name: String(name),
          kind: type as 'table' | 'view',
          rows,
          rowsExact: true,
          tableBytes,
          indexBytes,
          totalBytes: tableBytes === null ? null : tableBytes + (indexBytes ?? 0),
          indexCount: idx.length,
        })
      }
      return out.sort((a, b) => a.name.localeCompare(b.name))
    },

    async countRows(t) {
      return Number(db.exec(`select count(*) from ${quoteIdent(t.name)}`)[0].values[0][0])
    },

    async describe(t: TableRef): Promise<TableDetail> {
      const name = quoteIdent(t.name)
      const rows = (sql: string) => {
        const r = db.exec(sql)[0]
        return r ? r.values.map((v) => Object.fromEntries(r.columns.map((c, i) => [c, v[i]])) as Record<string, any>) : []
      }
      const cols = rows(`PRAGMA table_xinfo(${name})`)
      const fks = rows(`PRAGMA foreign_key_list(${name})`)
      const idxList = rows(`PRAGMA index_list(${name})`)
      const ddl = db.exec(`select sql from sqlite_master where name = '${t.name.replace(/'/g, "''")}'`)[0]?.values[0]?.[0]
      const usage = new Map<string, number>()
      try {
        for (const [n, s] of db.exec('select name, sum(pgsize) from dbstat group by name')[0]?.values ?? []) usage.set(String(n), Number(s))
      } catch {
        /* ignore */
      }
      const indexes = idxList.map((i) => {
        const info = rows(`PRAGMA index_info(${quoteIdent(i.name)})`)
        return {
          name: String(i.name),
          definition: `(${info.map((c) => c.name ?? '<expr>').join(', ')})${i.partial ? ' WHERE …' : ''}`,
          unique: !!i.unique,
          primary: i.origin === 'pk',
          bytes: usage.size ? (usage.get(String(i.name)) ?? 0) : null,
        }
      })
      const fkGroups = new Map<number, Record<string, any>[]>()
      for (const f of fks) fkGroups.set(f.id, [...(fkGroups.get(f.id) ?? []), f])
      return {
        columns: cols
          .filter((c) => c.hidden !== 1)
          .map((c) => ({
            name: String(c.name),
            type: String(c.type || 'ANY'),
            nullable: !c.notnull && !c.pk,
            default: c.dflt_value === null ? null : String(c.dflt_value),
            primaryKey: c.pk > 0,
          })),
        constraints: [...fkGroups.values()].map((g) => ({
          name: `fk_${t.name}_${g[0].id}`,
          type: 'FOREIGN KEY',
          definition: `(${g.map((x) => x.from).join(', ')}) REFERENCES ${g[0].table}(${g.map((x) => x.to).join(', ')}) ON UPDATE ${g[0].on_update} ON DELETE ${g[0].on_delete}`,
        })),
        indexes,
        ddl: ddl ? String(ddl) : undefined,
      }
    },

    async selectRows(t, q: RowQuery) {
      let sql = `select * from ${quoteIdent(t.name)}`
      if (q.where?.trim()) sql += ` where ${q.where}`
      if (q.orderBy) sql += ` order by ${quoteIdent(q.orderBy)} ${q.desc ? 'desc' : 'asc'}`
      sql += ` limit ${Math.floor(q.limit)} offset ${Math.floor(q.offset)}`
      return driver.query(sql)
    },

    async query(sql: string): Promise<QueryResult> {
      if (readOnly && !READ_ONLY_RE.test(sql)) throw new Error('Read-only connection: only SELECT / WITH / PRAGMA / EXPLAIN statements are allowed.')
      const t0 = performance.now()
      const res = db.exec(sql)
      const last = res[res.length - 1]
      const changes = db.getRowsModified()
      if (!READ_ONLY_RE.test(sql)) driver.dirty = true
      return {
        columns: (last?.columns ?? []).map((name) => ({ name })),
        rows: (last?.values as unknown[][]) ?? [],
        rowCount: last ? last.values.length : changes,
        command: last ? 'SELECT' : 'OK',
        durationMs: performance.now() - t0,
      }
    },

    exportFile: () => db.export(),

    async close() {
      db.close()
    },
  }
  return driver
}
