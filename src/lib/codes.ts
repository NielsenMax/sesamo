/*
  Signed ticket codes.

  Every event owns a random 160-bit key, stored once in its own spreadsheet's
  Config tab. A ticket's QR carries the event code, the serial, and a truncated
  HMAC of the two. That means the door can tell a forged QR from a real one
  entirely offline — before it even looks at the downloaded ticket list — and it
  means the spreadsheet never has to store a signature: the printed code plus
  the key regenerates it exactly.

    QR payload   SES1:A7QK:0042:K3F9QX
    printed code A7QK-0042
*/

// Crockford base32: no I, L, O or U, so nothing gets misread off a printed
// ticket or mistyped at the door.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const PREFIX = 'SES1'
const SIG_CHARS = 6 // 30 bits — one in a billion for a blind guess

function base32(bytes: Uint8Array, chars: number): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5 && out.length < chars) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
    if (out.length >= chars) break
  }
  return out
}

function randomBase32(chars: number): string {
  const bytes = new Uint8Array(Math.ceil((chars * 5) / 8))
  crypto.getRandomValues(bytes)
  return base32(bytes, chars)
}

/** 160-bit signing key for a new event. */
export function generateSecret(): string {
  return randomBase32(32)
}

/** Short public identifier for the event, printed on every ticket. */
export function generateEventCode(): string {
  return randomBase32(4)
}

/**
 * Normalises what a human types or a camera reads: strips whitespace, upcases,
 * and folds the characters Crockford treats as aliases (O→0, I/L→1).
 */
export function normalize(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
}

export function padSerial(serial: number): string {
  return String(serial).padStart(4, '0')
}

/** The code printed on the ticket and accepted by manual entry. */
export function humanCode(eventCode: string, serial: number): string {
  return `${eventCode}-${padSerial(serial)}`
}

export function parseHumanCode(code: string): { eventCode: string; serial: number } | null {
  const m = /^([0-9A-Z]{4})-?(\d{1,6})$/.exec(normalize(code))
  if (!m) return null
  return { eventCode: m[1], serial: Number(m[2]) }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

/** Cached per secret — signing a batch of 500 tickets shouldn't re-import 500 keys. */
const keyCache = new Map<string, Promise<CryptoKey>>()

function getKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret)
  if (!k) {
    k = hmacKey(secret)
    keyCache.set(secret, k)
  }
  return k
}

export async function sign(secret: string, eventCode: string, serial: number): Promise<string> {
  const key = await getKey(secret)
  const msg = new TextEncoder().encode(`${eventCode}:${padSerial(serial)}`)
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
  return base32(mac, SIG_CHARS)
}

/** The string that goes into the QR image. */
export async function qrPayload(secret: string, eventCode: string, serial: number): Promise<string> {
  return `${PREFIX}:${eventCode}:${padSerial(serial)}:${await sign(secret, eventCode, serial)}`
}

export type ParsedScan =
  | { kind: 'payload'; eventCode: string; serial: number; sig: string; code: string }
  | { kind: 'human'; eventCode: string; serial: number; code: string }
  | { kind: 'unreadable' }

/**
 * Understands both a scanned QR payload and a hand-typed ticket code. A hand
 * typed code carries no signature, so it can only ever be checked against the
 * downloaded list — which is the right trade for the one path that requires an
 * operator to be standing there.
 */
export function parseScan(input: string): ParsedScan {
  const raw = input.trim()
  const payload = /^SES1:([0-9A-Z]{4}):(\d{1,6}):([0-9A-Z]{4,10})$/i.exec(raw)
  if (payload) {
    const eventCode = payload[1].toUpperCase()
    const serial = Number(payload[2])
    return {
      kind: 'payload',
      eventCode,
      serial,
      sig: payload[3].toUpperCase(),
      code: humanCode(eventCode, serial),
    }
  }
  const human = parseHumanCode(raw)
  if (human) {
    return { kind: 'human', ...human, code: humanCode(human.eventCode, human.serial) }
  }
  return { kind: 'unreadable' }
}

/** Constant-time-ish comparison. The strings are short and public, but free is free. */
function equals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifySignature(
  secret: string,
  eventCode: string,
  serial: number,
  sig: string,
): Promise<boolean> {
  return equals(await sign(secret, eventCode, serial), sig.toUpperCase())
}
