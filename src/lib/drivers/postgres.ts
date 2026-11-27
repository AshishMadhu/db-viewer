import { Client, neonConfig } from '@neondatabase/serverless'
import type { Driver, QueryResult, RowQuery, TableDetail, TableInfo, TableRef } from '../types'
import { quoteIdent } from '../format'

export interface PgConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl: 'off' | 'require' | 'verify'
  readOnly: boolean
}

const qt = (t: TableRef) => `${quoteIdent(t.schema ?? 'public')}.${quoteIdent(t.name)}`
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function connectPostgres(cfg: PgConfig): Promise<Driver> {
  // The browser cannot open TCP sockets. The Vite dev/preview server exposes a same-origin
  // WebSocket->TCP relay (tools/pg-proxy.ts) and the driver tunnels the wire protocol through it.
  neonConfig.useSecureWebSocket = location.protocol === 'https:'
  neonConfig.pipelineConnect = false
  neonConfig.pipelineTLS = false
  neonConfig.forceDisablePgSSL = true // TLS (if any) is terminated by the relay, not in the browser
  const tlsFlag = cfg.ssl === 'off' ? '0' : '1'
  const verify = cfg.ssl === 'verify' ? '1' : '0'
  neonConfig.wsProxy = (host, port) =>
    `${location.host}/__pgproxy?host=${encodeURIComponent(host)}&port=${port}&tls=${tlsFlag}&verify=${verify}`

  const open = async () => {
    const c = new Client({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      connectionTimeoutMillis: 15000,
    })
    c.on('error', () => {}) // surfaced on the next query instead of crashing
    try {
      await c.connect()
    } catch (e) {
      const m = (e as Error).message ?? ''
      if (/terminated|WebSocket|closed/i.test(m))
        throw new Error(
          `${m}. The browser could not reach the database through the local relay. Check that the app is running via "npm run dev" (or "npm run preview", not a plain static server), that ${cfg.host}:${cfg.port} is reachable from this machine, and the SSL setting. See the terminal running Vite for details.`,
        )
      throw e
    }
    if (cfg.readOnly) await c.query('SET default_transaction_read_only = on')
    return c
  }
  let client = await open()

  async function run(text: string, values?: unknown[]): Promise<QueryResult> {
    const t0 = performance.now()
    const exec = () => (client as any).query({ text, values, rowMode: 'array' })
    let res: any
    try {
      res = await exec()
    } catch (e) {
      // idle connections get dropped by servers / NATs: reconnect once and retry
      if (!/terminated|not queryable|ECONNRESET|closed/i.test((e as Error).message ?? '')) throw e
      await client.end().catch(() => {})
      client = await open()
      res = await exec()
    }
    const r = (Array.isArray(res) ? res[res.length - 1] : res) as {
      fields: { name: string; dataTypeID: number }[]
      rows: unknown[][]
      rowCount: number | null
      command: string
    }
    return {
      columns: ((r.fields ?? []) as { name: string }[]).map((f) => ({ name: f.name })),
      rows: r.rows ?? [],
      rowCount: r.rowCount,
      command: r.command,
      durationMs: performance.now() - t0,
    }
  }

  const objs = async (text: string, values?: unknown[]) => {
    const r = await run(text, values)
    return r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c.name, row[i]])) as Record<string, any>)
  }

  return {
    kind: 'postgres',

    async overview() {
      const [v] = await objs(`select version() as v, pg_database_size(current_database()) as size,
        current_database() as db, current_user as usr, pg_encoding_to_char(encoding) as enc,
        (select count(*) from pg_stat_activity where datname = current_database()) as conns,
        (select setting from pg_settings where name = 'server_version') as sv
        from pg_database where datname = current_database()`)
      const ext = await objs(`select count(*) as c from pg_extension`).catch(() => [{ c: '?' }])
      const schemas = await objs(
        `select count(*) as c from pg_namespace where nspname not in ('pg_catalog','information_schema') and nspname not like 'pg_toast%' and nspname not like 'pg_temp%'`,
      )
      return {
        engine: 'PostgreSQL',
        version: String(v.sv),
        totalBytes: n(v.size),
        extra: [
          ['Database', String(v.db)],
          ['User', String(v.usr)],
          ['Encoding', String(v.enc)],
          ['Active connections', String(v.conns)],
          ['Schemas', String(schemas[0].c)],
          ['Extensions', String(ext[0].c)],
          ['Server', String(v.v)],
        ],
      }
    },

    async listTables() {
      const rows = await objs(`
        select n.nspname as schema, c.relname as name, c.relkind as kind, c.reltuples::bigint as est,
          case when c.relkind in ('r','p','m') then pg_table_size(c.oid) end as table_bytes,
          case when c.relkind in ('r','p','m') then pg_indexes_size(c.oid) end as index_bytes,
          case when c.relkind in ('r','p','m') then pg_total_relation_size(c.oid) end as total_bytes,
          (select count(*) from pg_index i where i.indrelid = c.oid) as idx,
          obj_description(c.oid) as comment
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r','p','v','m','f')
          and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'
        order by 1, 2`)
      const kinds = { r: 'table', p: 'table', v: 'view', m: 'matview', f: 'foreign' } as const
      return rows.map<TableInfo>((r) => ({
        schema: r.schema,
        name: r.name,
        kind: kinds[r.kind as keyof typeof kinds],
        rows: r.kind === 'v' || Number(r.est) < 0 ? null : Number(r.est),
        rowsExact: false,
        tableBytes: n(r.table_bytes),
        indexBytes: n(r.index_bytes),
        totalBytes: n(r.total_bytes),
        indexCount: Number(r.idx),
        comment: r.comment,
      }))
    },

    async countRows(t) {
      const r = await run(`select count(*) from ${qt(t)}`)
      return Number(r.rows[0][0])
    },

    async describe(t): Promise<TableDetail> {
      const reg = qt(t)
      const [cols, cons, idx, pk] = await Promise.all([
        objs(
          `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, not a.attnotnull as nullable,
             pg_get_expr(d.adbin, d.adrelid) as def, col_description(a.attrelid, a.attnum) as comment
           from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
           where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`,
          [reg],
        ),
        objs(
          `select conname as name, contype as type, pg_get_constraintdef(oid) as def
           from pg_constraint where conrelid = $1::regclass order by contype, conname`,
          [reg],
        ),
        objs(
          `select i.relname as name, pg_get_indexdef(i.oid) as def, ix.indisunique as uq, ix.indisprimary as pk,
             pg_relation_size(i.oid) as bytes
           from pg_index ix join pg_class i on i.oid = ix.indexrelid where ix.indrelid = $1::regclass order by i.relname`,
          [reg],
        ),
        objs(
          `select a.attname as name from pg_index i
           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
           where i.indrelid = $1::regclass and i.indisprimary`,
          [reg],
        ),
      ])
      const pks = new Set(pk.map((r) => r.name))
      const ctype = { p: 'PRIMARY KEY', f: 'FOREIGN KEY', u: 'UNIQUE', c: 'CHECK', x: 'EXCLUDE', t: 'TRIGGER' } as Record<string, string>
      return {
        columns: cols.map((c) => ({
          name: c.name,
          type: c.type,
          nullable: !!c.nullable,
          default: c.def,
          primaryKey: pks.has(c.name),
          comment: c.comment,
        })),
        constraints: cons.map((c) => ({ name: c.name, type: ctype[c.type] ?? c.type, definition: c.def })),
        indexes: idx.map((i) => ({ name: i.name, definition: i.def, unique: !!i.uq, primary: !!i.pk, bytes: n(i.bytes) })),
      }
    },

    selectRows(t, q: RowQuery) {
      let sql = `select * from ${qt(t)}`
      if (q.where?.trim()) sql += ` where ${q.where}`
      if (q.orderBy) sql += ` order by ${quoteIdent(q.orderBy)} ${q.desc ? 'desc' : 'asc'}`
      sql += ` limit ${Math.floor(q.limit)} offset ${Math.floor(q.offset)}`
      return run(sql)
    },

    query: (sql) => run(sql),

    async close() {
      await client.end().catch(() => {})
    },
  }
}
