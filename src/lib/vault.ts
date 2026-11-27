// Password vault: a master password -> PBKDF2 -> non-extractable AES-GCM key held only in memory.
// Saved DB passwords are stored as AES-GCM ciphertext in localStorage; the master password is never stored.
import type { EncBlob } from './types'

const META_KEY = 'dbv.vault'
const ITERATIONS = 600_000
const enc = new TextEncoder()
const dec = new TextDecoder()

let key: CryptoKey | null = null

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

interface Meta {
  salt: string
  iter: number
  verifier: EncBlob
}

async function derive(password: string, salt: Uint8Array, iter: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encryptWith(k: CryptoKey, text: string): Promise<EncBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(text)))
  return { iv: b64(iv), ct: b64(ct) }
}

async function decryptWith(k: CryptoKey, blob: EncBlob): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) as BufferSource }, k, unb64(blob.ct) as BufferSource)
  return dec.decode(pt)
}

export const hasVault = () => localStorage.getItem(META_KEY) !== null
export const isUnlocked = () => key !== null

export async function createVault(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const k = await derive(password, salt, ITERATIONS)
  const meta: Meta = { salt: b64(salt), iter: ITERATIONS, verifier: await encryptWith(k, 'db-viewer-vault') }
  localStorage.setItem(META_KEY, JSON.stringify(meta))
  key = k
}

export async function unlock(password: string): Promise<boolean> {
  const meta: Meta | null = JSON.parse(localStorage.getItem(META_KEY) ?? 'null')
  if (!meta) return false
  try {
    const k = await derive(password, unb64(meta.salt), meta.iter)
    if ((await decryptWith(k, meta.verifier)) !== 'db-viewer-vault') return false
    key = k
    return true
  } catch {
    return false
  }
}

export function lock() {
  key = null
}

export function resetVault() {
  localStorage.removeItem(META_KEY)
  key = null
}

export async function encryptSecret(text: string): Promise<EncBlob> {
  if (!key) throw new Error('Vault is locked')
  return encryptWith(key, text)
}

export async function decryptSecret(blob: EncBlob): Promise<string> {
  if (!key) throw new Error('Vault is locked')
  return decryptWith(key, blob)
}
