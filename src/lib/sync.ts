/*
  Sync.

  Two directions, kept deliberately separate because they fail differently.

  Pull replaces the device's ticket list from the spreadsheet. Safe to repeat.

  Push has two halves. Scan rows are *appended* to the audit tab, so running the
  same append twice would duplicate history — they get marked synced the instant
  the append returns. Ticket rows are *overwritten* in place, so they are
  idempotent and can be retried freely; they carry a `dirty` flag instead.
  Splitting them means a failure in one half never corrupts the other.
*/
import { appendScans, readTickets, writeTicketRows } from './event-sheet'
import * as db from './db'
import type { StoredEvent } from './types'

export type SyncState = {
  online: boolean
  pending: number
  busy: 'idle' | 'pulling' | 'pushing'
  error: string | null
}

export async function pull(event: StoredEvent): Promise<StoredEvent> {
  const tickets = await readTickets(event, event.tabs)
  await db.replaceTickets(event.spreadsheetId, tickets)
  const updated: StoredEvent = {
    ...event,
    lastPull: new Date().toISOString(),
    ticketCount: tickets.length,
    admittedCount: tickets.filter((t) => t.status === 'admitted').length,
  }
  await db.putEvent(updated)
  return updated
}

/*
  Pushes are serialised process-wide. Every scan fires one, so at a busy door
  two can easily overlap — and two calls that both read the pending queue before
  either marks it synced would append the same audit rows twice. Queueing costs
  nothing here and makes duplicates impossible.
*/
let chain: Promise<unknown> = Promise.resolve()

export function push(event: StoredEvent): Promise<{ scans: number; tickets: number }> {
  const next = chain.then(
    () => runPush(event),
    () => runPush(event),
  )
  chain = next.catch(() => undefined)
  return next
}

/** Returns how many scan rows made it up. Throws if Google refused. */
async function runPush(event: StoredEvent): Promise<{ scans: number; tickets: number }> {
  const scans = await db.pendingScans(event.spreadsheetId)
  if (scans.length) {
    await appendScans(event, event.tabs, scans)
    await db.markScansSynced(scans.map((s) => s.id))
  }

  const dirty = await db.dirtyTickets(event.spreadsheetId)
  // A ticket with no row number was never seen in a pull; re-reading the sheet
  // is the only way to learn where to write it.
  const placed = dirty.filter((t) => t.row > 1)
  if (placed.length) {
    await writeTicketRows(event, event.tabs, placed)
    await db.clearDirty(
      event.spreadsheetId,
      placed.map((t) => t.code),
    )
  }

  if (scans.length || placed.length) {
    await db.putEvent({ ...event, lastPush: new Date().toISOString() })
  }
  return { scans: scans.length, tickets: placed.length }
}

/** Pushes, then pulls — the order that leaves the device agreeing with the sheet. */
export async function fullSync(event: StoredEvent): Promise<StoredEvent> {
  await push(event)
  return pull(event)
}

export function watchOnline(fn: (online: boolean) => void): () => void {
  const on = () => fn(true)
  const off = () => fn(false)
  window.addEventListener('online', on)
  window.addEventListener('offline', off)
  return () => {
    window.removeEventListener('online', on)
    window.removeEventListener('offline', off)
  }
}
