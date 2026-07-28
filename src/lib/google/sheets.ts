/*
  A thin, typed wrapper over the Sheets v4 REST API.

  Everything Sésamo needs lives here: create a spreadsheet, reshape it, read a
  range, write a range. Deliberately no Drive API — a spreadsheet's own metadata
  gives us the title, which keeps the scope list to exactly one entry.
*/
import { getToken } from './auth'

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

export class SheetsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: 'auth' | 'access' | 'notFound' | 'quota' | 'network' | 'generic',
  ) {
    super(message)
    this.name = 'SheetsError'
  }
}

function classify(status: number): SheetsError['kind'] {
  if (status === 401) return 'auth'
  if (status === 403) return 'access'
  if (status === 404) return 'notFound'
  if (status === 429 || status === 503) return 'quota'
  return 'generic'
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken()
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
  } catch (err) {
    throw new SheetsError(err instanceof Error ? err.message : 'Network error', 0, 'network')
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      detail = body.error?.message ?? detail
    } catch {
      /* non-JSON error bodies are rare but not impossible */
    }
    throw new SheetsError(detail, res.status, classify(res.status))
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/* ------------------------------------------------------------------ types --- */

export type GridProperties = { rowCount?: number; columnCount?: number; frozenRowCount?: number }
export type SheetProperties = {
  sheetId: number
  title: string
  index: number
  gridProperties?: GridProperties
}
export type Spreadsheet = {
  spreadsheetId: string
  properties: { title: string; locale?: string; timeZone?: string }
  sheets: { properties: SheetProperties }[]
  spreadsheetUrl?: string
}

export type ValueRange = { range?: string; majorDimension?: string; values?: string[][] }

/* --------------------------------------------------------------- requests --- */

export function createSpreadsheet(body: unknown): Promise<Spreadsheet> {
  return api<Spreadsheet>('', { method: 'POST', body: JSON.stringify(body) })
}

export function getSpreadsheet(id: string, fields = 'spreadsheetId,properties.title,sheets.properties,spreadsheetUrl') {
  return api<Spreadsheet>(`/${id}?fields=${encodeURIComponent(fields)}`)
}

export function batchUpdate(id: string, requests: unknown[]): Promise<unknown> {
  return api(`/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) })
}

export function getValues(id: string, range: string): Promise<ValueRange> {
  return api<ValueRange>(`/${id}/values/${encodeURIComponent(range)}`)
}

export function batchGetValues(id: string, ranges: string[]): Promise<{ valueRanges: ValueRange[] }> {
  const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&')
  return api<{ valueRanges: ValueRange[] }>(`/${id}/values:batchGet?${qs}`)
}

/*
  Ticket and scan data is always written RAW. Timestamps live in the sheet as
  `2026-08-15 22:14` strings, and USER_ENTERED would let Sheets reinterpret them
  as dates — which then read back in whatever format the viewer's locale picked.
  RAW round-trips byte for byte. USER_ENTERED is reserved for the Resumen tab,
  which genuinely wants live formulas.
*/
export type InputOption = 'RAW' | 'USER_ENTERED'

export function updateValues(
  id: string,
  range: string,
  values: unknown[][],
  valueInputOption: InputOption = 'RAW',
): Promise<unknown> {
  return api(`/${id}/values/${encodeURIComponent(range)}?valueInputOption=${valueInputOption}`, {
    method: 'PUT',
    body: JSON.stringify({ range, majorDimension: 'ROWS', values }),
  })
}

export function batchUpdateValues(
  id: string,
  data: { range: string; values: unknown[][] }[],
  valueInputOption: InputOption = 'RAW',
): Promise<unknown> {
  return api(`/${id}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption, data }),
  })
}

export function appendValues(
  id: string,
  range: string,
  values: unknown[][],
  valueInputOption: InputOption = 'RAW',
): Promise<unknown> {
  return api(
    `/${id}/values/${encodeURIComponent(range)}:append?valueInputOption=${valueInputOption}&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values }) },
  )
}

export function spreadsheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`
}

/** A1 column letter for a 0-based index. */
export function columnLetter(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/** Quotes a tab name for use in an A1 range or a formula. */
export function quoteTab(title: string): string {
  return `'${title.replace(/'/g, "''")}'`
}
