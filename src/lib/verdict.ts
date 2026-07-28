/*
  What the door decides.

  Kept as one pure function so the rule is written down in exactly one place and
  the scanner view never has to reason about it. Order matters: a forged QR is
  rejected on its signature before we ever look it up, so a stale ticket list
  can't be mistaken for a security failure.
*/
import { parseScan, verifySignature } from './codes'
import type { EventConfig, ScanResult, Ticket } from './types'

export type Verdict = {
  result: ScanResult
  code: string
  ticket: Ticket | null
  /** Machine-agnostic reason, written into the audit row. */
  detail: string
  /** True when the operator may wave them through anyway. */
  overridable: boolean
}

export async function judge(
  event: EventConfig,
  raw: string,
  lookup: (code: string) => Ticket | undefined,
): Promise<Verdict> {
  const parsed = parseScan(raw)

  if (parsed.kind === 'unreadable') {
    return { result: 'invalid', code: '', ticket: null, detail: 'unreadable', overridable: false }
  }

  if (parsed.eventCode !== event.eventCode) {
    return {
      result: 'otherEvent',
      code: parsed.code,
      ticket: null,
      detail: `event ${parsed.eventCode}`,
      overridable: true,
    }
  }

  if (parsed.kind === 'payload') {
    const ok = await verifySignature(event.secret, parsed.eventCode, parsed.serial, parsed.sig)
    if (!ok) {
      return { result: 'invalid', code: parsed.code, ticket: null, detail: 'bad signature', overridable: false }
    }
  }

  const ticket = lookup(parsed.code)
  if (!ticket) {
    return { result: 'unknown', code: parsed.code, ticket: null, detail: 'not in list', overridable: true }
  }
  if (ticket.status === 'voided') {
    return { result: 'voided', code: ticket.code, ticket, detail: 'voided', overridable: true }
  }
  if (ticket.entries.length > 0) {
    return {
      result: 'repeat',
      code: ticket.code,
      ticket,
      detail: `already in at ${ticket.entries[0]}`,
      overridable: true,
    }
  }
  return { result: 'granted', code: ticket.code, ticket, detail: '', overridable: false }
}

export function isGood(result: ScanResult): boolean {
  return result === 'granted' || result === 'override'
}
