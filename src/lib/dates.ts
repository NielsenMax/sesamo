/**
 * Event dates are stored the way the spreadsheet shows them — `2026-08-15 21:00`
 * — because a human reading the Resumen tab shouldn't meet an ISO string with a
 * T in it. This parses that form, and anything else `Date` already understands.
 */
export function parseLocal(value: string | Date | undefined | null): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

/*
  Dates are edited as two separate fields — `<input type="date">` and
  `<input type="time">` — rather than one `datetime-local`. That input is the
  least consistently implemented of the three across browsers, and splitting it
  also gives a phone its two native pickers instead of one cramped combined one.
*/

/** Splits `2026-08-15 21:00` into the two form fields. */
export function splitStored(value: string): { date: string; time: string } {
  const [date = '', time = ''] = value.trim().replace('T', ' ').split(/\s+/)
  return { date: date.slice(0, 10), time: time.slice(0, 5) }
}

/** Joins the two fields back into stored form. A date with no time is valid. */
export function joinStored(date: string, time: string): string {
  const d = date.trim()
  if (!d) return ''
  const t = time.trim()
  return t ? `${d} ${t}` : d
}
