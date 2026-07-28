export type TicketStatus = 'issued' | 'admitted' | 'voided'

export type Ticket = {
  /** 1-based, matches the printed serial and the row order in the sheet. */
  serial: number
  /** Human code printed on the ticket and typed in by hand: `A7QK-0042`. */
  code: string
  holder: string
  tier: string
  status: TicketStatus
  /** ISO timestamp of the first admitted entry, or ''. */
  firstEntry: string
  /** Every recorded entry, in order. The door shows all of them. */
  entries: string[]
  issuedAt: string
  /** 1-based row in the Entradas tab, so writes can target it directly. */
  row: number
}

export type ScanResult =
  | 'granted'
  | 'repeat'
  | 'invalid'
  | 'otherEvent'
  | 'voided'
  | 'unknown'
  | 'override'

/** Every read is recorded, admitted or not. This is the audit row. */
export type Scan = {
  id: string
  spreadsheetId: string
  at: string
  /** Exactly what the camera or the keyboard produced. */
  raw: string
  code: string
  result: ScanResult
  holder: string
  tier: string
  detail: string
  device: string
  mode: 'camera' | 'manual'
  synced: boolean
}

export type SheetLang = 'es' | 'en'

export type EventConfig = {
  spreadsheetId: string
  /** 4 characters, base32. Scoped so a ticket from another event is detectable. */
  eventCode: string
  /** Base32 HMAC key. Lives in the Config tab of the event's own spreadsheet. */
  secret: string
  name: string
  date: string
  venue: string
  notes: string
  tiers: string[]
  /** Language the spreadsheet was built in — drives tab names and status words. */
  sheetLang: SheetLang
  version: number
}

export type TabMap = {
  summary: string
  tickets: string
  scans: string
  config: string
}

export type StoredEvent = EventConfig & {
  tabs: TabMap
  lastPull: string | null
  lastPush: string | null
  ticketCount: number
  admittedCount: number
}

export type RecentEvent = {
  spreadsheetId: string
  name: string
  date: string
  openedAt: string
}
