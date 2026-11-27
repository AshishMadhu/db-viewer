// Dev/preview-only WebSocket -> TCP relay so the browser can speak the Postgres wire protocol.
// Browsers cannot open raw TCP sockets, so this is the one unavoidable piece outside the page.
// It is bound to the Vite server (localhost only), checks Origin, and stores nothing.
import type { Plugin } from 'vite'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import net from 'node:net'
import tls from 'node:tls'
import { WebSocketServer, type WebSocket } from 'ws'

const PATH = '/__pgproxy'
const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 4, 210, 22, 47])

function openUpstream(host: string, port: number, useTls: boolean, verify: boolean): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const raw = net.connect({ host, port })
    raw.setNoDelay(true)
    raw.once('error', reject)
    raw.once('connect', () => {
      if (!useTls) return resolve(raw)
      // Postgres negotiates TLS in-band: send SSLRequest, expect 'S', then upgrade.
      raw.write(SSL_REQUEST)
      raw.once('data', (b) => {
        if (b[0] !== 0x53) return reject(new Error('Server does not support SSL'))
        const secure = tls.connect({ socket: raw, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: verify })
        secure.once('error', reject)
        secure.once('secureConnect', () => resolve(secure as unknown as net.Socket))
      })
    })
  })
}

function allowedOrigin(req: IncomingMessage) {
  const origin = req.headers.origin
  if (!origin) return false
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function attach(httpServer: { on: (ev: "upgrade", cb: (req: IncomingMessage, socket: Duplex, head: Buffer) => void) => unknown } | null) {
  if (!httpServer) return
  const wss = new WebSocketServer({ noServer: true })
  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '', 'http://x')
    if (url.pathname !== PATH) return // let Vite HMR handle its own upgrades
    if (!allowedOrigin(req)) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => handle(ws, url))
  })
}

function handle(ws: WebSocket, url: URL) {
  const host = url.searchParams.get('host') ?? 'localhost'
  const port = Number(url.searchParams.get('port') ?? 5432)
  const useTls = url.searchParams.get('tls') === '1'
  const verify = url.searchParams.get('verify') === '1'
  const queue: Buffer[] = []
  let upstream: net.Socket | null = null

  ws.on('message', (data) => {
    const buf = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
    if (upstream) upstream.write(buf)
    else queue.push(buf)
  })
  ws.on('close', () => upstream?.destroy())
  ws.on('error', () => upstream?.destroy())

  openUpstream(host, port, useTls, verify)
    .then((s) => {
      upstream = s
      s.on('data', (d) => ws.readyState === ws.OPEN && ws.send(d))
      s.on('close', () => ws.close())
      s.on('error', (e) => {
        console.warn(`[pg-proxy] ${host}:${port} - ${e.message}`)
        ws.close()
      })
      for (const b of queue.splice(0)) s.write(b)
    })
    .catch((e) => {
      console.warn(`[pg-proxy] cannot reach ${host}:${port} - ${e.message}`)
      ws.close(1011, 'upstream connect failed')
    })
}

export function pgProxy(): Plugin {
  return {
    name: 'pg-proxy',
    configureServer(server) {
      attach(server.httpServer)
    },
    configurePreviewServer(server) {
      attach(server.httpServer)
    },
  }
}
