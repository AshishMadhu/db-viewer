export type Kind = 'postgres' | 'sqlite'
export type SslMode = 'off' | 'require' | 'verify'

export interface EncBlob {
  iv: string
  ct: string
}

export interface SavedConnection {
  id: string
  name: string
  kind: Kind
  color: string
  readOnly: boolean
  // postgres
  host?: string
  port?: number
  database?: string
  user?: string
  ssl?: SslMode
  password?: EncBlob | null // encrypted with the vault key
  // sqlite
  fileName?: string
  hasHandle?: boolean
  createdAt: number
}

export interface Column {
  name: string
  type?: string
}

export interface QueryResult {
  columns: Column[]
  rows: unknown[][]
  rowCount: number | null
  durationMs: number
  command?: string
}

export interface TableRef {
  schema?: string
  name: string
}

export interface TableInfo extends TableRef {
  kind: 'table' | 'view' | 'matview' | 'foreign'
  rows: number | null // exact if rowsExact, otherwise estimate
  rowsExact: boolean
  tableBytes: number | null
  indexBytes: number | null
  totalBytes: number | null
  indexCount: number
  comment?: string | null
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  default: string | null
  primaryKey: boolean
  comment?: string | null
}

export interface ConstraintInfo {
  name: string
  type: string
  definition: string
}

export interface IndexInfo {
  name: string
  definition: string
  unique: boolean
  primary: boolean
  bytes: number | null
}

export interface TableDetail {
  columns: ColumnInfo[]
  constraints: ConstraintInfo[]
  indexes: IndexInfo[]
  ddl?: string
}

export interface DbOverview {
  engine: string
  version: string
  totalBytes: number | null
  extra: [string, string][]
}

export interface RowQuery {
  limit: number
  offset: number
  orderBy?: string
  desc?: boolean
  where?: string
}

export interface Driver {
  kind: Kind
  overview(): Promise<DbOverview>
  listTables(): Promise<TableInfo[]>
  countRows(t: TableRef): Promise<number>
  describe(t: TableRef): Promise<TableDetail>
  selectRows(t: TableRef, q: RowQuery): Promise<QueryResult>
  query(sql: string): Promise<QueryResult>
  close(): Promise<void>
  /** sqlite only */
  exportFile?(): Uint8Array
  dirty?: boolean
}
