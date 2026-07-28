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

/** `2026-08-15 21:00`, as stored. Accepts what `<input type="datetime-local">` gives. */
export function toStored(value: string): string {
  return value.trim().replace('T', ' ')
}

/** The `<input type="datetime-local">` form of a stored date. */
export function toInput(value: string): string {
  return value.trim().replace(' ', 'T').slice(0, 16)
}
