/*
  Everything one event needs, held in one place.

  The device's IndexedDB copy is the source of truth for the UI — it answers
  instantly and it answers offline. Google is written to around the edges, and
  when a write can't go out it queues rather than blocking anyone at the door.
*/
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as db from '@/lib/db'
import type { LocalTicket } from '@/lib/db'
import * as sheet from '@/lib/event-sheet'
import { pull as syncPull, push as syncPush, watchOnline } from '@/lib/sync'
import { judge, type Verdict } from '@/lib/verdict'
import { SheetsError } from '@/lib/google/sheets'
import { AuthError } from '@/lib/google/auth'
import type { Scan, ScanResult, StoredEvent, Ticket } from '@/lib/types'
import { useI18n } from '@/i18n'

export type LoadState = 'loading' | 'ready' | 'error'

type EventCtx = {
  state: LoadState
  error: string | null
  event: StoredEvent | null
  tickets: LocalTicket[]
  scans: Scan[]
  online: boolean
  pending: number
  busy: 'idle' | 'pulling' | 'pushing' | 'writing'
  admitted: number

  pull: () => Promise<void>
  push: () => Promise<void>
  issue: (spec: { count: number; tier: string; holders: string[] }) => Promise<number>
  patch: (code: string, changes: Partial<Pick<Ticket, 'holder' | 'tier' | 'status'>>) => Promise<void>
  patchMany: (codes: string[], changes: Partial<Pick<Ticket, 'holder' | 'tier' | 'status'>>) => Promise<void>
  saveDetails: (input: sheet.NewEventInput) => Promise<void>
  check: (raw: string, mode: 'camera' | 'manual') => Promise<Verdict>
  letThrough: (verdict: Verdict) => Promise<void>

  /* Shared between the ticket list and the design view: what you tick in one
     is what the other offers to print. */
  selected: string[]
  setSelected: (codes: string[]) => void
  printed: string[]
  markPrinted: (codes: string[]) => Promise<void>
}

const Ctx = createContext<EventCtx | null>(null)

export function EventProvider({ spreadsheetId, children }: { spreadsheetId: string; children: ReactNode }) {
  const { t } = useI18n()
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [event, setEvent] = useState<StoredEvent | null>(null)
  const [tickets, setTickets] = useState<LocalTicket[]>([])
  const [scans, setScans] = useState<Scan[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const [busy, setBusy] = useState<EventCtx['busy']>('idle')
  const [selected, setSelected] = useState<string[]>([])
  const [printed, setPrinted] = useState<string[]>([])
  const device = useRef('')

  const printedKey = `printed:${spreadsheetId}`

  useEffect(() => {
    void db.getPref<string[]>(printedKey).then((v) => setPrinted(v ?? []))
  }, [printedKey])

  const markPrinted = useCallback(
    async (codes: string[]) => {
      setPrinted((prev) => {
        const next = Array.from(new Set([...prev, ...codes]))
        void db.setPref(printedKey, next)
        return next
      })
    },
    [printedKey],
  )

  const describe = useCallback(
    (err: unknown): string => {
      if (err instanceof SheetsError) {
        if (err.kind === 'access') return t.errors.noAccess
        if (err.kind === 'notFound') return t.errors.notFound
        if (err.kind === 'quota') return t.errors.quota
        if (err.kind === 'network') return t.errors.network
        if (err.kind === 'auth') return t.auth.expired
      }
      if (err instanceof AuthError) {
        return err.kind === 'config' ? t.auth.missingConfigHelp : t.auth.expired
      }
      return err instanceof Error && err.message ? err.message : t.errors.generic
    },
    [t],
  )

  // Held in refs so switching language doesn't re-run the load effect and
  // bounce the whole view back through its loading state.
  const describeRef = useRef(describe)
  describeRef.current = describe
  const messages = useRef(t)
  messages.current = t

  const reloadLocal = useCallback(async () => {
    const [nextTickets, nextScans] = await Promise.all([db.getTickets(spreadsheetId), db.getScans(spreadsheetId)])
    setTickets(nextTickets)
    setScans(nextScans)
  }, [spreadsheetId])

  /* Load: local copy first so the door works with no signal, network second. */
  useEffect(() => {
    let cancelled = false
    setState('loading')
    setError(null)
    ;(async () => {
      device.current = await db.deviceName()
      const stored = await db.getEvent(spreadsheetId)
      if (cancelled) return
      if (stored) {
        setEvent(stored)
        await reloadLocal()
        if (cancelled) return
        setState('ready')
        if (navigator.onLine) {
          try {
            const fresh = await syncPull(stored)
            if (!cancelled) {
              setEvent(fresh)
              await reloadLocal()
            }
          } catch {
            /* the local copy stands; the sync bar shows we're behind */
          }
        }
        return
      }

      if (!navigator.onLine) {
        setError(messages.current.errors.notFound)
        setState('error')
        return
      }
      try {
        const probe = await sheet.probeSpreadsheet(spreadsheetId)
        if (cancelled) return
        if (probe.kind !== 'ready') {
          setError(probe.kind === 'uninitialised' ? messages.current.errors.badSheet : messages.current.errors.corruptConfig)
          setState('error')
          return
        }
        const fresh: StoredEvent = {
          ...probe.event,
          tabs: probe.tabs,
          lastPull: null,
          lastPush: null,
          ticketCount: 0,
          admittedCount: 0,
        }
        await db.putEvent(fresh)
        const pulled = await syncPull(fresh)
        if (cancelled) return
        setEvent(pulled)
        await reloadLocal()
        setState('ready')
      } catch (err) {
        if (cancelled) return
        setError(describeRef.current(err))
        setState('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [spreadsheetId, reloadLocal])

  useEffect(() => watchOnline(setOnline), [])

  const pending = useMemo(() => scans.filter((s) => !s.synced).length, [scans])

  const push = useCallback(async () => {
    if (!event || !navigator.onLine) return
    setBusy('pushing')
    try {
      await syncPush(event)
      await reloadLocal()
      setError(null)
    } catch (err) {
      setError(describe(err))
    } finally {
      setBusy('idle')
    }
  }, [event, reloadLocal, describe])

  const pull = useCallback(async () => {
    if (!event) return
    setBusy('pulling')
    try {
      const fresh = await syncPull(event)
      setEvent(fresh)
      await reloadLocal()
      setError(null)
    } catch (err) {
      setError(describe(err))
    } finally {
      setBusy('idle')
    }
  }, [event, reloadLocal, describe])

  /* Anything queued goes up the moment the signal comes back. */
  const pushRef = useRef(push)
  pushRef.current = push
  useEffect(() => {
    if (online && pending > 0) void pushRef.current()
  }, [online, pending])

  const issue = useCallback(
    async ({ count, tier, holders }: { count: number; tier: string; holders: string[] }) => {
      if (!event) return 0
      const names = holders.length ? holders : Array.from({ length: count }, () => '')
      if (!names.length) return 0
      setBusy('writing')
      try {
        const start = sheet.nextSerial(tickets)
        const fresh = names.map((holder, i) => sheet.buildTicket(event, start + i, holder.trim(), tier))
        await sheet.appendTickets(event, event.tabs, fresh)
        const updated = await syncPull(event)
        setEvent(updated)
        await reloadLocal()
        setError(null)
        return fresh.length
      } catch (err) {
        setError(describe(err))
        throw err
      } finally {
        setBusy('idle')
      }
    },
    [event, tickets, reloadLocal, describe],
  )

  const patchMany = useCallback(
    async (codes: string[], changes: Partial<Pick<Ticket, 'holder' | 'tier' | 'status'>>) => {
      if (!event || !codes.length) return
      const set = new Set(codes)
      const next = tickets.map((ticket) => (set.has(ticket.code) ? { ...ticket, ...changes, dirty: true } : ticket))
      setTickets(next)
      for (const ticket of next) {
        if (set.has(ticket.code)) await db.putTicket(ticket)
      }
      if (navigator.onLine) await push()
    },
    [event, tickets, push],
  )

  const patch = useCallback(
    (code: string, changes: Partial<Pick<Ticket, 'holder' | 'tier' | 'status'>>) => patchMany([code], changes),
    [patchMany],
  )

  const saveDetails = useCallback(
    async (input: sheet.NewEventInput) => {
      if (!event) return
      setBusy('writing')
      try {
        await sheet.updateEventDetails(event, event.tabs, input)
        const updated: StoredEvent = { ...event, ...input }
        await db.putEvent(updated)
        setEvent(updated)
        setError(null)
      } catch (err) {
        setError(describe(err))
        throw err
      } finally {
        setBusy('idle')
      }
    },
    [event, describe],
  )

  /* --------------------------------------------------------------- door --- */

  const record = useCallback(
    async (raw: string, mode: 'camera' | 'manual', verdict: Verdict, result: ScanResult) => {
      if (!event) return
      const scan: Scan = {
        id: crypto.randomUUID(),
        spreadsheetId: event.spreadsheetId,
        at: sheet.stamp(),
        raw,
        code: verdict.code,
        result,
        holder: verdict.ticket?.holder ?? '',
        tier: verdict.ticket?.tier ?? '',
        detail: verdict.detail,
        device: device.current,
        mode,
        synced: false,
      }
      await db.addScan(scan)
      setScans((prev) => [scan, ...prev])
    },
    [event],
  )

  const admit = useCallback(
    async (ticket: LocalTicket) => {
      const at = sheet.stamp()
      const updated: LocalTicket = {
        ...ticket,
        status: 'admitted',
        firstEntry: ticket.firstEntry || at,
        entries: [...ticket.entries, at],
        dirty: true,
      }
      await db.putTicket(updated)
      setTickets((prev) => prev.map((x) => (x.code === updated.code ? updated : x)))
      return updated
    },
    [],
  )

  /**
   * One read, one audit row — always, whatever the verdict. A granted ticket is
   * admitted locally in the same breath so the next scan of it says "repeat"
   * even with no signal.
   */
  const check = useCallback(
    async (raw: string, mode: 'camera' | 'manual'): Promise<Verdict> => {
      if (!event) throw new Error('no event')
      const index = new Map(tickets.map((x) => [x.code, x]))
      const verdict = await judge(event, raw, (code) => index.get(code))
      if (verdict.result === 'granted' && verdict.ticket) {
        const updated = await admit(index.get(verdict.ticket.code)!)
        await record(raw, mode, { ...verdict, ticket: updated }, 'granted')
        if (navigator.onLine) void push()
        return { ...verdict, ticket: updated }
      }
      await record(raw, mode, verdict, verdict.result)
      if (navigator.onLine) void push()
      return verdict
    },
    [event, tickets, admit, record, push],
  )

  /** The logged exception: they get in, and the spreadsheet says who decided so. */
  const letThrough = useCallback(
    async (verdict: Verdict) => {
      if (!event) return
      let ticket = verdict.ticket ? tickets.find((x) => x.code === verdict.ticket!.code) : undefined
      if (ticket) ticket = await admit(ticket)
      await record(verdict.code, 'manual', { ...verdict, ticket: ticket ?? verdict.ticket }, 'override')
      if (navigator.onLine) void push()
    },
    [event, tickets, admit, record, push],
  )

  const admitted = useMemo(() => tickets.filter((x) => x.entries.length > 0).length, [tickets])

  const value = useMemo<EventCtx>(
    () => ({
      state,
      error,
      event,
      tickets,
      scans,
      online,
      pending,
      busy,
      admitted,
      pull,
      push,
      issue,
      patch,
      patchMany,
      saveDetails,
      check,
      letThrough,
      selected,
      setSelected,
      printed,
      markPrinted,
    }),
    [
      state,
      error,
      event,
      tickets,
      scans,
      online,
      pending,
      busy,
      admitted,
      pull,
      push,
      issue,
      patch,
      patchMany,
      saveDetails,
      check,
      letThrough,
      selected,
      printed,
      markPrinted,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useEvent(): EventCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useEvent must be used inside EventProvider')
  return ctx
}
