/*
  The event spreadsheet.

  One Google spreadsheet per event, laid out so that somebody who has never
  heard of Sésamo can open it and understand every cell: a Resumen tab with the
  event's details and live counts, an Entradas tab that reads like a guest list,
  an Escaneos tab that reads like a door log, and a Config tab holding the one
  thing a human must not touch — the signing key.

  Words in the sheet are written in the language the sheet was built in, and
  read back in either. Status values round-trip through `STATUS_WORDS`.
*/
import {
  appendValues,
  batchUpdate,
  batchUpdateValues,
  createSpreadsheet,
  getSpreadsheet,
  getValues,
  quoteTab,
  updateValues,
  type Spreadsheet,
} from './google/sheets'
import { generateEventCode, generateSecret, humanCode } from './codes'
import type { EventConfig, Scan, ScanResult, SheetLang, StoredEvent, TabMap, Ticket, TicketStatus } from './types'

export const SHEET_VERSION = 1

const TAB_NAMES: Record<SheetLang, TabMap> = {
  es: { summary: 'Resumen', tickets: 'Entradas', scans: 'Escaneos', config: 'Config' },
  en: { summary: 'Summary', tickets: 'Tickets', scans: 'Scans', config: 'Config' },
}

const HEADERS: Record<SheetLang, { tickets: string[]; scans: string[] }> = {
  es: {
    tickets: ['Código', 'N°', 'Nombre', 'Tipo', 'Estado', 'Primer ingreso', 'Ingresos', 'Todos los ingresos', 'Emitida'],
    scans: ['Fecha y hora', 'Código', 'Resultado', 'Nombre', 'Tipo', 'Detalle', 'Dispositivo', 'Origen'],
  },
  en: {
    tickets: ['Code', 'No.', 'Name', 'Type', 'Status', 'First entry', 'Entries', 'All entries', 'Issued'],
    scans: ['Date and time', 'Code', 'Result', 'Name', 'Type', 'Detail', 'Device', 'Source'],
  },
}

const STATUS_WORDS: Record<SheetLang, Record<TicketStatus, string>> = {
  es: { issued: 'Emitida', admitted: 'Ingresada', voided: 'Anulada' },
  en: { issued: 'Issued', admitted: 'Admitted', voided: 'Voided' },
}

const RESULT_WORDS: Record<SheetLang, Record<ScanResult, string>> = {
  es: {
    granted: 'Adelante',
    repeat: 'Repetida',
    invalid: 'Inválida',
    otherEvent: 'Otro evento',
    voided: 'Anulada',
    unknown: 'No está en la lista',
    override: 'Dejada pasar',
  },
  en: {
    granted: 'Come in',
    repeat: 'Already used',
    invalid: 'Invalid',
    otherEvent: 'Wrong event',
    voided: 'Voided',
    unknown: 'Not on the list',
    override: 'Let through',
  },
}

const SUMMARY_LABELS: Record<SheetLang, Record<string, string>> = {
  es: {
    title: 'SÉSAMO · CONTROL DE ACCESO',
    event: 'Evento',
    date: 'Fecha',
    venue: 'Lugar',
    notes: 'Notas',
    tiers: 'Tipos de entrada',
    counts: 'Cómo viene',
    issued: 'Emitidas',
    admitted: 'Ingresadas',
    pending: 'Sin ingresar',
    voided: 'Anuladas',
    readme:
      'Podés leer esta planilla y corregir nombres a mano. No cambies la columna Código ni la solapa Config: son lo que valida cada QR en la puerta.',
  },
  en: {
    title: 'SÉSAMO · ACCESS CONTROL',
    event: 'Event',
    date: 'Date',
    venue: 'Venue',
    notes: 'Notes',
    tiers: 'Ticket types',
    counts: 'Where it stands',
    issued: 'Issued',
    admitted: 'Admitted',
    pending: 'Not in yet',
    voided: 'Voided',
    readme:
      "You can read this spreadsheet and fix names by hand. Don't change the Code column or the Config tab: they are what validates each QR at the door.",
  },
}

const CONFIG_WARN: Record<SheetLang, string> = {
  es: '⚠️ No edites esta solapa. Acá vive la firma que valida los QR: si cambia, todas las entradas impresas dejan de servir.',
  en: '⚠️ Do not edit this tab. The signing key that validates the QRs lives here: change it and every printed ticket stops working.',
}

/* ------------------------------------------------------------ formatting --- */

const INK = { red: 0.102, green: 0.078, blue: 0.063 }
const PAPER = { red: 0.941, green: 0.902, blue: 0.812 }
const AMBER = { red: 0.89, green: 0.639, blue: 0.18 }
const HAIR = { red: 0.86, green: 0.81, blue: 0.71 }

/** `2026-08-15 22:14` — sortable, unambiguous, and the same in every locale. */
export function stamp(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`
}

function statusFromWord(word: string): TicketStatus {
  const w = word.trim().toLowerCase()
  for (const lang of ['es', 'en'] as const) {
    for (const [key, value] of Object.entries(STATUS_WORDS[lang])) {
      if (value.toLowerCase() === w) return key as TicketStatus
    }
  }
  return 'issued'
}

/* --------------------------------------------------------------- reading --- */

type ConfigMap = Record<string, string>

async function readConfigMap(spreadsheetId: string, configTab: string): Promise<ConfigMap> {
  const res = await getValues(spreadsheetId, `${quoteTab(configTab)}!A:B`)
  const map: ConfigMap = {}
  for (const row of res.values ?? []) {
    const key = (row[0] ?? '').trim()
    if (key) map[key] = (row[1] ?? '').trim()
  }
  return map
}

export type SheetProbe =
  | { kind: 'ready'; event: EventConfig; tabs: TabMap; title: string }
  | { kind: 'uninitialised'; title: string }
  | { kind: 'broken'; title: string; reason: 'tabs' | 'config' }

/**
 * Answers the question the landing screen asks: has this spreadsheet already
 * been through setup? The Config tab is the anchor — it is named the same in
 * both languages, and it records which language everything else was built in.
 */
export async function probeSpreadsheet(spreadsheetId: string): Promise<SheetProbe> {
  const meta = await getSpreadsheet(spreadsheetId)
  const title = meta.properties.title
  const titles = meta.sheets.map((s) => s.properties.title)
  const configTab = titles.find((t) => t.trim().toLowerCase() === 'config')
  if (!configTab) return { kind: 'uninitialised', title }

  const config = await readConfigMap(spreadsheetId, configTab)
  if (!config.signing_key || !config.event_code) return { kind: 'broken', title, reason: 'config' }

  const sheetLang: SheetLang = config.language === 'en' ? 'en' : 'es'
  const tabs = { ...TAB_NAMES[sheetLang], config: configTab }
  const missing = (['summary', 'tickets', 'scans'] as const).filter((k) => !titles.includes(tabs[k]))
  if (missing.length) return { kind: 'broken', title, reason: 'tabs' }

  return {
    kind: 'ready',
    tabs,
    title,
    event: {
      spreadsheetId,
      eventCode: config.event_code,
      secret: config.signing_key,
      name: config.event_name || title,
      date: config.event_date ?? '',
      venue: config.event_venue ?? '',
      notes: config.event_notes ?? '',
      tiers: (config.ticket_types ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      sheetLang,
      version: Number(config.version) || SHEET_VERSION,
    },
  }
}

export async function readTickets(event: EventConfig, tabs: TabMap): Promise<Ticket[]> {
  const res = await getValues(event.spreadsheetId, `${quoteTab(tabs.tickets)}!A2:I`)
  const rows = res.values ?? []
  const tickets: Ticket[] = []
  rows.forEach((row, i) => {
    const code = (row[0] ?? '').trim()
    if (!code) return
    const entries = (row[7] ?? '')
      .split('·')
      .map((s) => s.trim())
      .filter(Boolean)
    tickets.push({
      code,
      serial: Number(row[1]) || i + 1,
      holder: (row[2] ?? '').trim(),
      tier: (row[3] ?? '').trim(),
      status: statusFromWord(row[4] ?? ''),
      firstEntry: (row[5] ?? '').trim(),
      entries,
      issuedAt: (row[8] ?? '').trim(),
      row: i + 2, // A2 is the first data row
    })
  })
  return tickets
}

/* --------------------------------------------------------------- writing --- */

function ticketRow(t: Ticket, lang: SheetLang): unknown[] {
  return [
    t.code,
    t.serial,
    t.holder,
    t.tier,
    STATUS_WORDS[lang][t.status],
    t.firstEntry,
    t.entries.length,
    t.entries.join(' · '),
    t.issuedAt,
  ]
}

export async function appendTickets(event: EventConfig, tabs: TabMap, tickets: Ticket[]): Promise<void> {
  if (!tickets.length) return
  await appendValues(
    event.spreadsheetId,
    `${quoteTab(tabs.tickets)}!A:I`,
    tickets.map((t) => ticketRow(t, event.sheetLang)),
  )
}

/** Rewrites whole ticket rows in place — used by assignment, voiding and sync. */
export async function writeTicketRows(event: EventConfig, tabs: TabMap, tickets: Ticket[]): Promise<void> {
  if (!tickets.length) return
  await batchUpdateValues(
    event.spreadsheetId,
    tickets.map((t) => ({
      range: `${quoteTab(tabs.tickets)}!A${t.row}:I${t.row}`,
      values: [ticketRow(t, event.sheetLang)],
    })),
  )
}

export async function appendScans(event: EventConfig, tabs: TabMap, scans: Scan[]): Promise<void> {
  if (!scans.length) return
  await appendValues(
    event.spreadsheetId,
    `${quoteTab(tabs.scans)}!A:H`,
    scans.map((s) => [
      s.at,
      s.code || s.raw,
      RESULT_WORDS[event.sheetLang][s.result],
      s.holder,
      s.tier,
      s.detail,
      s.device,
      s.mode === 'camera' ? (event.sheetLang === 'es' ? 'Cámara' : 'Camera') : event.sheetLang === 'es' ? 'A mano' : 'Typed',
    ]),
  )
}

/* -------------------------------------------------------------- creating --- */

export type NewEventInput = {
  name: string
  date: string
  venue: string
  notes: string
  tiers: string[]
}

function summaryValues(input: NewEventInput, lang: SheetLang, tabs: TabMap) {
  const L = SUMMARY_LABELS[lang]
  const admitted = STATUS_WORDS[lang].admitted
  const issued = STATUS_WORDS[lang].issued
  const voided = STATUS_WORDS[lang].voided
  // INDIRECT keeps the range as a plain string, so nothing Sheets does to the
  // grid can move it — not an append, and not a human inserting a row in the
  // middle of the guest list, which this sheet openly invites.
  const ref = (column: string) => `INDIRECT("${quoteTab(tabs.tickets)}!${column}2:${column}")`
  return [
    [L.title],
    [],
    [L.event, input.name],
    [L.date, input.date],
    [L.venue, input.venue],
    [L.notes, input.notes],
    [L.tiers, input.tiers.join(', ')],
    [],
    [L.counts],
    [L.issued, `=COUNTA(${ref('A')})`],
    [L.admitted, `=COUNTIF(${ref('E')},"${admitted}")`],
    [L.pending, `=COUNTIF(${ref('E')},"${issued}")`],
    [L.voided, `=COUNTIF(${ref('E')},"${voided}")`],
    [],
    [L.readme],
  ]
}

function configValues(event: EventConfig, lang: SheetLang, input: NewEventInput) {
  return [
    [lang === 'es' ? 'Clave' : 'Key', lang === 'es' ? 'Valor' : 'Value'],
    ['version', String(SHEET_VERSION)],
    ['language', lang],
    ['event_code', event.eventCode],
    ['signing_key', event.secret],
    ['event_name', input.name],
    ['event_date', input.date],
    ['event_venue', input.venue],
    ['event_notes', input.notes],
    ['ticket_types', input.tiers.join(', ')],
    ['created', stamp()],
    [],
    [CONFIG_WARN[lang]],
  ]
}

/** Header bands, frozen rows, column widths — the sheet has to look deliberate. */
function formattingRequests(sheetIds: Record<keyof TabMap, number>) {
  const headerBand = (sheetId: number, columns: number) => [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columns },
        cell: {
          userEnteredFormat: {
            backgroundColor: INK,
            textFormat: { foregroundColor: PAPER, bold: true, fontSize: 10 },
            verticalAlignment: 'MIDDLE',
            padding: { top: 6, bottom: 6, left: 8, right: 8 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)',
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    {
      // Timestamps and codes are text, and must stay text: a code like
      // `A7QK-0042` should never become a formula or a date.
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: columns },
        cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
  ]

  const widths = (sheetId: number, sizes: number[]) =>
    sizes.map((pixelSize, i) => ({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize },
        fields: 'pixelSize',
      },
    }))

  return [
    ...headerBand(sheetIds.tickets, 9),
    ...widths(sheetIds.tickets, [120, 55, 190, 110, 105, 145, 85, 260, 145]),
    ...headerBand(sheetIds.scans, 8),
    ...widths(sheetIds.scans, [145, 120, 150, 190, 110, 260, 150, 90]),

    // Resumen reads like a cover page, not a table.
    ...widths(sheetIds.summary, [170, 420]),
    {
      mergeCells: {
        range: { sheetId: sheetIds.summary, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 2 },
        mergeType: 'MERGE_ALL',
      },
    },
    {
      repeatCell: {
        range: { sheetId: sheetIds.summary, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 2 },
        cell: {
          userEnteredFormat: {
            backgroundColor: INK,
            textFormat: { foregroundColor: AMBER, bold: true, fontSize: 13 },
            padding: { top: 10, bottom: 10, left: 10, right: 10 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,padding)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: sheetIds.summary, startRowIndex: 2, endRowIndex: 13, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.973, green: 0.949, blue: 0.882 } } },
        fields: 'userEnteredFormat(textFormat,backgroundColor)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: sheetIds.summary, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 0, endColumnIndex: 2 },
        cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: INK }, borders: { bottom: { style: 'SOLID', color: HAIR } } } },
        fields: 'userEnteredFormat(textFormat,borders)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: sheetIds.summary, startRowIndex: 9, endRowIndex: 13, startColumnIndex: 1, endColumnIndex: 2 },
        cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 12 }, horizontalAlignment: 'LEFT' } },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: sheetIds.summary, startRowIndex: 14, endRowIndex: 15, startColumnIndex: 0, endColumnIndex: 2 },
        cell: {
          userEnteredFormat: {
            wrapStrategy: 'WRAP',
            textFormat: { italic: true, foregroundColor: { red: 0.42, green: 0.35, blue: 0.26 } },
          },
        },
        fields: 'userEnteredFormat(wrapStrategy,textFormat)',
      },
    },

    // Config: quarantined on purpose.
    ...widths(sheetIds.config, [150, 420]),
    {
      repeatCell: {
        range: { sheetId: sheetIds.config, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 2 },
        cell: { userEnteredFormat: { backgroundColor: INK, textFormat: { foregroundColor: PAPER, bold: true } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: sheetIds.config, startRowIndex: 12, endRowIndex: 13, startColumnIndex: 0, endColumnIndex: 2 },
        cell: {
          userEnteredFormat: {
            wrapStrategy: 'WRAP',
            backgroundColor: { red: 0.949, green: 0.851, blue: 0.824 },
            textFormat: { bold: true },
          },
        },
        fields: 'userEnteredFormat(wrapStrategy,backgroundColor,textFormat)',
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId: sheetIds.config, tabColor: { red: 0.71, green: 0.2, blue: 0.15 } },
        fields: 'tabColor',
      },
    },
  ]
}

function sheetIdsOf(meta: Spreadsheet, tabs: TabMap): Record<keyof TabMap, number> {
  const byTitle = new Map(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]))
  const pick = (title: string) => {
    const id = byTitle.get(title)
    if (id === undefined) throw new Error(`Missing tab: ${title}`)
    return id
  }
  return { summary: pick(tabs.summary), tickets: pick(tabs.tickets), scans: pick(tabs.scans), config: pick(tabs.config) }
}

async function writeScaffold(
  spreadsheetId: string,
  meta: Spreadsheet,
  event: EventConfig,
  input: NewEventInput,
  lang: SheetLang,
  tabs: TabMap,
): Promise<void> {
  await batchUpdateValues(
    spreadsheetId,
    [
      { range: `${quoteTab(tabs.tickets)}!A1:I1`, values: [HEADERS[lang].tickets] },
      { range: `${quoteTab(tabs.scans)}!A1:H1`, values: [HEADERS[lang].scans] },
      { range: `${quoteTab(tabs.config)}!A1:B13`, values: configValues(event, lang, input) },
    ],
    'RAW',
  )
  // Resumen last and separately: its counters are real formulas, so they need
  // USER_ENTERED, and they reference the Entradas tab that now exists.
  await updateValues(
    spreadsheetId,
    `${quoteTab(tabs.summary)}!A1:B15`,
    summaryValues(input, lang, tabs),
    'USER_ENTERED',
  )
  await batchUpdate(spreadsheetId, formattingRequests(sheetIdsOf(meta, tabs)))
}

export async function createEventSpreadsheet(input: NewEventInput, lang: SheetLang): Promise<StoredEvent> {
  const tabs = TAB_NAMES[lang]
  const event: EventConfig = {
    spreadsheetId: '',
    eventCode: generateEventCode(),
    secret: generateSecret(),
    name: input.name,
    date: input.date,
    venue: input.venue,
    notes: input.notes,
    tiers: input.tiers,
    sheetLang: lang,
    version: SHEET_VERSION,
  }

  const meta = await createSpreadsheet({
    properties: { title: `${input.name} · Sésamo` },
    sheets: [
      { properties: { title: tabs.summary, index: 0, gridProperties: { rowCount: 40, columnCount: 4 } } },
      { properties: { title: tabs.tickets, index: 1, gridProperties: { rowCount: 1000, columnCount: 9 } } },
      { properties: { title: tabs.scans, index: 2, gridProperties: { rowCount: 2000, columnCount: 8 } } },
      { properties: { title: tabs.config, index: 3, gridProperties: { rowCount: 30, columnCount: 2 } } },
    ],
  })

  event.spreadsheetId = meta.spreadsheetId
  await writeScaffold(meta.spreadsheetId, meta, event, input, lang, tabs)

  return { ...event, tabs, lastPull: stamp(), lastPush: null, ticketCount: 0, admittedCount: 0 }
}

/** Adds Sésamo's tabs to a spreadsheet the user already had, leaving it otherwise alone. */
export async function initialiseExistingSpreadsheet(
  spreadsheetId: string,
  input: NewEventInput,
  lang: SheetLang,
): Promise<StoredEvent> {
  const tabs = TAB_NAMES[lang]
  const before = await getSpreadsheet(spreadsheetId)
  const existing = new Set(before.sheets.map((s) => s.properties.title))
  const toAdd = (['summary', 'tickets', 'scans', 'config'] as const)
    .filter((key) => !existing.has(tabs[key]))
    .map((key) => ({
      addSheet: {
        properties: {
          title: tabs[key],
          gridProperties:
            key === 'tickets'
              ? { rowCount: 1000, columnCount: 9 }
              : key === 'scans'
                ? { rowCount: 2000, columnCount: 8 }
                : { rowCount: 40, columnCount: 4 },
        },
      },
    }))
  if (toAdd.length) await batchUpdate(spreadsheetId, toAdd)

  const meta = await getSpreadsheet(spreadsheetId)
  const event: EventConfig = {
    spreadsheetId,
    eventCode: generateEventCode(),
    secret: generateSecret(),
    name: input.name,
    date: input.date,
    venue: input.venue,
    notes: input.notes,
    tiers: input.tiers,
    sheetLang: lang,
    version: SHEET_VERSION,
  }
  await writeScaffold(spreadsheetId, meta, event, input, lang, tabs)
  return { ...event, tabs, lastPull: stamp(), lastPush: null, ticketCount: 0, admittedCount: 0 }
}

/** Keeps the Resumen and Config tabs in step after the event details are edited. */
export async function updateEventDetails(event: EventConfig, tabs: TabMap, input: NewEventInput): Promise<void> {
  await updateValues(
    event.spreadsheetId,
    `${quoteTab(tabs.summary)}!A1:B15`,
    summaryValues(input, event.sheetLang, tabs),
    'USER_ENTERED',
  )
  await batchUpdateValues(
    event.spreadsheetId,
    [
      { range: `${quoteTab(tabs.config)}!B6:B10`, values: [[input.name], [input.date], [input.venue], [input.notes], [input.tiers.join(', ')]] },
    ],
    'RAW',
  )
}

export function nextSerial(tickets: Ticket[]): number {
  return tickets.reduce((max, t) => Math.max(max, t.serial), 0) + 1
}

export function buildTicket(event: EventConfig, serial: number, holder: string, tier: string): Ticket {
  return {
    serial,
    code: humanCode(event.eventCode, serial),
    holder,
    tier,
    status: 'issued',
    firstEntry: '',
    entries: [],
    issuedAt: stamp(),
    row: 0, // assigned when the append lands and the list is re-read
  }
}

export { TAB_NAMES, STATUS_WORDS, RESULT_WORDS }
