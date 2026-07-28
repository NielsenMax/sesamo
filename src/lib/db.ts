/*
  The device's own copy.

  At the door there is no internet and no time. Everything the scanner needs —
  the event, its signing key, every ticket, every scan taken so far — lives in
  IndexedDB and is answered locally in a millisecond. Google is a place we push
  to afterwards, never something the door waits on.
*/
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Scan, StoredEvent, Ticket } from './types'

export type LocalTicket = Ticket & {
  spreadsheetId: string
  /** Row changed locally and hasn't made it back to the spreadsheet yet. */
  dirty?: boolean
}

interface SesamoDB extends DBSchema {
  events: { key: string; value: StoredEvent }
  tickets: { key: [string, string]; value: LocalTicket; indexes: { bySheet: string } }
  scans: { key: string; value: Scan; indexes: { bySheet: string } }
  prefs: { key: string; value: unknown }
}

let dbPromise: Promise<IDBPDatabase<SesamoDB>> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB<SesamoDB>('sesamo', 1, {
      upgrade(database) {
        database.createObjectStore('events', { keyPath: 'spreadsheetId' })
        const tickets = database.createObjectStore('tickets', { keyPath: ['spreadsheetId', 'code'] })
        tickets.createIndex('bySheet', 'spreadsheetId')
        const scans = database.createObjectStore('scans', { keyPath: 'id' })
        scans.createIndex('bySheet', 'spreadsheetId')
        database.createObjectStore('prefs')
      },
    })
  }
  return dbPromise
}

/* ---------------------------------------------------------------- events --- */

export async function listEvents(): Promise<StoredEvent[]> {
  const all = await (await db()).getAll('events')
  return all.sort((a, b) => (b.lastPull ?? '').localeCompare(a.lastPull ?? ''))
}

export async function getEvent(spreadsheetId: string): Promise<StoredEvent | undefined> {
  return (await db()).get('events', spreadsheetId)
}

export async function putEvent(event: StoredEvent): Promise<void> {
  await (await db()).put('events', event)
}

/** Forgets an event on this device only. The spreadsheet is untouched. */
export async function forgetEvent(spreadsheetId: string): Promise<void> {
  const database = await db()
  const tx = database.transaction(['events', 'tickets', 'scans'], 'readwrite')
  await tx.objectStore('events').delete(spreadsheetId)
  for (const key of await tx.objectStore('tickets').index('bySheet').getAllKeys(spreadsheetId)) {
    await tx.objectStore('tickets').delete(key)
  }
  for (const scan of await tx.objectStore('scans').index('bySheet').getAll(spreadsheetId)) {
    await tx.objectStore('scans').delete(scan.id)
  }
  await tx.done
}

/* --------------------------------------------------------------- tickets --- */

export async function getTickets(spreadsheetId: string): Promise<LocalTicket[]> {
  const all = await (await db()).getAllFromIndex('tickets', 'bySheet', spreadsheetId)
  return all.sort((a, b) => a.serial - b.serial)
}

export async function getTicket(spreadsheetId: string, code: string): Promise<LocalTicket | undefined> {
  return (await db()).get('tickets', [spreadsheetId, code])
}

export async function putTicket(ticket: LocalTicket): Promise<void> {
  await (await db()).put('tickets', ticket)
}

/**
 * Replaces the device's ticket list with what the spreadsheet says — except for
 * rows still carrying unsynced local changes, which would otherwise be silently
 * reverted by a pull mid-event.
 */
export async function replaceTickets(spreadsheetId: string, tickets: Ticket[]): Promise<void> {
  const database = await db()
  const tx = database.transaction('tickets', 'readwrite')
  const store = tx.objectStore('tickets')
  const dirty = new Map<string, LocalTicket>()
  for (const existing of await store.index('bySheet').getAll(spreadsheetId)) {
    if (existing.dirty) dirty.set(existing.code, existing)
    else await store.delete([spreadsheetId, existing.code])
  }
  for (const ticket of tickets) {
    const held = dirty.get(ticket.code)
    // Keep the local entry log, but take the row number from the server: a
    // human may have inserted rows in the sheet since the last pull.
    await store.put(held ? { ...held, row: ticket.row } : { ...ticket, spreadsheetId })
  }
  await tx.done
}

export async function dirtyTickets(spreadsheetId: string): Promise<LocalTicket[]> {
  return (await getTickets(spreadsheetId)).filter((t) => t.dirty)
}

export async function clearDirty(spreadsheetId: string, codes: string[]): Promise<void> {
  const database = await db()
  const tx = database.transaction('tickets', 'readwrite')
  for (const code of codes) {
    const ticket = await tx.store.get([spreadsheetId, code])
    if (ticket) await tx.store.put({ ...ticket, dirty: false })
  }
  await tx.done
}

/* ----------------------------------------------------------------- scans --- */

export async function addScan(scan: Scan): Promise<void> {
  await (await db()).put('scans', scan)
}

export async function getScans(spreadsheetId: string): Promise<Scan[]> {
  const all = await (await db()).getAllFromIndex('scans', 'bySheet', spreadsheetId)
  return all.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
}

export async function pendingScans(spreadsheetId: string): Promise<Scan[]> {
  const all = await (await db()).getAllFromIndex('scans', 'bySheet', spreadsheetId)
  return all.filter((s) => !s.synced).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
}

export async function markScansSynced(ids: string[]): Promise<void> {
  const database = await db()
  const tx = database.transaction('scans', 'readwrite')
  for (const id of ids) {
    const scan = await tx.store.get(id)
    if (scan) await tx.store.put({ ...scan, synced: true })
  }
  await tx.done
}

/* ----------------------------------------------------------------- prefs --- */

export async function getPref<T>(key: string): Promise<T | undefined> {
  return (await db()).get('prefs', key) as Promise<T | undefined>
}

export async function setPref(key: string, value: unknown): Promise<void> {
  await (await db()).put('prefs', value, key)
}

/**
 * A name for this device, so the log can say which phone let someone in.
 * Derived once from the browser, then kept.
 */
export async function deviceName(): Promise<string> {
  const stored = await getPref<string>('device')
  if (stored) return stored
  const ua = navigator.userAgent
  const platform =
    /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Web'
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase()
  const name = `${platform}-${suffix}`
  await setPref('device', name)
  return name
}
