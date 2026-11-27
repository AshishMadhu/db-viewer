# DB Viewer

Browser-based viewer for PostgreSQL and SQLite. React + Vite, no backend service.

    npm install
    npm run dev      # http://localhost:5173

- **Saved connections** live in `localStorage`. Passwords are encrypted with AES-GCM using a key derived
  (PBKDF2-SHA256, 600k iterations) from a master password that is never stored. "Lock" wipes the key from memory.
- **SQLite**: open a `.sqlite/.db` file; Chromium remembers the file handle so reopening is one click.
  The file is loaded into memory (sql.js/WASM), so very large files are limited by browser memory.
- **PostgreSQL**: browsers cannot open TCP sockets, so `npm run dev` / `npm run preview` also runs a tiny
  same-origin WebSocket→TCP relay (`tools/pg-proxy.ts`, localhost only, Origin-checked, stores nothing).
  TLS to the database is handled by that relay (SSL: require / verify).
- Connections are **read-only by default** (Postgres `default_transaction_read_only`, SQLite `query_only`).
