/*
  One description of a ticket, two renderers.

  A layout emits primitives in millimetres. The SVG renderer draws them for the
  on-screen preview; the PDF renderer draws the same list into jsPDF. That is
  the only way "preview" can honestly mean preview — including the typefaces,
  which are deliberately the two faces a PDF always has: Helvetica for words and
  Courier for codes. A serial number set in a typewriter face is what a box
  office has printed for a century; it is a choice, not a fallback.
*/
import { qrMatrix, type QrMatrix } from './qr'
import { parseLocal } from './dates'
import { fitText, measure } from './text-metrics'
import type { EventConfig, Ticket } from './types'

export type Prim =
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; lw?: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; color?: string; lw?: number }
  | { t: 'perf'; x: number; y: number; len: number; vertical?: boolean; color?: string }
  | {
      t: 'text'
      x: number
      y: number
      text: string
      /** Font size in millimetres — converted to points on the way into the PDF. */
      size: number
      font?: 'sans' | 'mono'
      weight?: 'normal' | 'bold'
      color?: string
      align?: 'left' | 'center' | 'right'
      tracking?: number
    }
  | { t: 'qr'; x: number; y: number; size: number; matrix: QrMatrix; color?: string }
  | { t: 'image'; x: number; y: number; w: number; h: number; href: string }

export type PresetId = 'stub' | 'card' | 'badge' | 'bare'

export type TicketDesign = {
  preset: PresetId
  accent: string
  logo: string | null
  /** Set when the user brings their own artwork; overrides `preset`. */
  custom: CustomLayout | null
}

export type CustomFieldId = 'qr' | 'code' | 'holder' | 'tier' | 'event' | 'date'

export type CustomField = {
  id: CustomFieldId
  /** Fractions of the ticket's width and height, so the layout survives a resize. */
  x: number
  y: number
  /** Fraction of the ticket width. */
  size: number
  visible: boolean
  color: string
}

export type CustomLayout = {
  image: string
  widthMm: number
  heightMm: number
  fields: CustomField[]
}

export const DEFAULT_DESIGN: TicketDesign = {
  preset: 'stub',
  accent: '#CF8412',
  logo: null,
  custom: null,
}

export const PRESET_SIZE: Record<PresetId, { w: number; h: number }> = {
  stub: { w: 180, h: 70 },
  card: { w: 85, h: 54 },
  badge: { w: 70, h: 100 },
  bare: { w: 42, h: 50 },
}

const INK = '#141414'
const SOFT = '#6E6E6E'

function upper(s: string) {
  return s.toLocaleUpperCase()
}

/**
 * A text primitive sized to the space it has. Long event names and long guest
 * names shrink to fit rather than getting cut, which is the whole point: the
 * name on a ticket belongs to somebody.
 */
function fitted(
  base: Omit<Extract<Prim, { t: 'text' }>, 't'>,
  maxWidth: number,
  minScale = 0.62,
): Prim {
  const face = { font: base.font, weight: base.weight, tracking: base.tracking }
  const result = fitText(base.text, maxWidth, base.size, face, base.size * minScale)
  return { t: 'text', ...base, text: result.text, size: result.size }
}

/** The event line: `15 AGO 2026 · 21:00 · CLUB X`, with whichever parts exist. */
function subtitle(event: EventConfig, locale: string): string {
  const parts: string[] = []
  if (event.date) {
    const d = parseLocal(event.date)
    // Spanish renders this as "15 de ago. de 2026"; a ticket wants "15 AGO 2026".
    const formatted = d
      ? upper(d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' }))
          .replace(/\s+DE\s+/g, ' ')
          .replace(/\./g, '')
      : event.date
    parts.push(formatted)
    // The door opens at a time, not on a date — print it whenever there is one.
    if (d && /\d{1,2}:\d{2}/.test(event.date)) {
      parts.push(d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false }))
    }
  }
  if (event.venue) parts.push(upper(event.venue))
  return parts.join('  ·  ')
}

/** The Sésamo arch, drawn from rectangles at any size. */
function markPrims(x: number, y: number, size: number, color: string): Prim[] {
  const m = size / 9
  const box = (mx: number, my: number, mw: number, mh: number): Prim => ({
    t: 'rect',
    x: x + mx * m,
    y: y + my * m,
    w: mw * m,
    h: mh * m,
    fill: color,
  })
  return [box(0, 0, 9, 1), box(0, 1, 1, 8), box(8, 1, 1, 8), box(2, 2, 5, 1), box(2, 3, 1, 6), box(6, 3, 1, 6)]
}

/*
  The tier chip is sized from its label's real width — "PRENSA ACREDITADA" is
  three times "VIP" — and clamped so a long tier name shrinks its own type
  rather than running off the ticket or shoving the guest's name aside.
*/
type Badge = { text: string; size: number; width: number; height: number }

function fitBadge(label: string, size: number, maxWidth = Infinity): Badge | null {
  if (!label) return null
  const face = (s: number) => ({ weight: 'bold' as const, tracking: s * 0.06 })
  const padding = size * 1.8
  const fit = fitText(upper(label), maxWidth - padding, size, face(size), size * 0.66)
  return {
    text: fit.text,
    size: fit.size,
    width: measure(fit.text, fit.size, face(fit.size)) + fit.size * 1.8,
    height: size * 2.1,
  }
}

function tierBadge(x: number, y: number, badge: Badge | null, accent: string): Prim[] {
  if (!badge) return []
  return [
    { t: 'rect', x, y, w: badge.width, h: badge.height, fill: accent },
    {
      t: 'text',
      x: x + badge.width / 2,
      y: y + badge.height / 2 + badge.size * 0.36,
      text: badge.text,
      size: badge.size,
      weight: 'bold',
      color: '#FFFFFF',
      align: 'center',
      tracking: badge.size * 0.06,
    },
  ]
}

export type RenderInput = {
  ticket: Ticket
  event: EventConfig
  design: TicketDesign
  payload: string
  locale: string
  labels: { holder: string; unassigned: string }
}

/* --------------------------------------------------------------- presets --- */

function stub({ ticket, event, design, payload, locale, labels }: RenderInput): Prim[] {
  const { w, h } = PRESET_SIZE.stub
  const split = w - 62
  const pad = 9
  const accent = design.accent
  const p: Prim[] = [
    { t: 'rect', x: 0, y: 0, w, h, fill: '#FFFFFF', stroke: INK, lw: 0.4 },
    { t: 'rect', x: 0, y: 0, w, h: 2.6, fill: accent },
    { t: 'perf', x: split, y: 3.4, len: h - 3.4, vertical: true },
  ]

  if (design.logo) p.push({ t: 'image', x: pad, y: pad, w: 9, h: 9, href: design.logo })
  else p.push(...markPrims(pad, pad, 8, accent))

  // The chip may take at most a third of the line; the name gets the rest.
  const badge = fitBadge(ticket.tier, 3, (split - pad * 2) / 3)
  const nameWidth = split - pad * 2 - (badge ? badge.width + 4 : 0)

  p.push(
    fitted(
      { x: pad + 12, y: pad + 6.4, text: upper(event.name), size: 6.6, weight: 'bold', tracking: -0.05 },
      split - pad - (pad + 12),
    ),
    fitted(
      { x: pad, y: pad + 16, text: subtitle(event, locale), size: 3.1, color: SOFT, tracking: 0.28 },
      split - pad * 2,
    ),
    { t: 'line', x1: pad, y1: h - 27, x2: split - pad, y2: h - 27, color: '#D8D8D8', lw: 0.3 },
    { t: 'text', x: pad, y: h - 21, text: upper(labels.holder), size: 2.5, color: SOFT, tracking: 0.3 },
    fitted(
      {
        x: pad,
        y: h - 12,
        text: ticket.holder || labels.unassigned,
        size: 7,
        weight: ticket.holder ? 'bold' : 'normal',
        color: ticket.holder ? INK : SOFT,
        tracking: -0.06,
      },
      nameWidth,
    ),
    ...tierBadge(split - pad - (badge?.width ?? 0), h - 17, badge, accent),
  )

  // Counterfoil
  const cx = split + (w - split) / 2
  const qrSize = 32
  p.push(
    { t: 'qr', x: cx - qrSize / 2, y: 8, size: qrSize, matrix: qrMatrix(payload) },
    { t: 'text', x: cx, y: h - 20, text: ticket.code, size: 4.4, font: 'mono', weight: 'bold', align: 'center' },
    {
      t: 'text',
      x: cx,
      y: h - 13.5,
      text: `N° ${String(ticket.serial).padStart(4, '0')}`,
      size: 3,
      font: 'mono',
      color: SOFT,
      align: 'center',
    },
    { t: 'text', x: cx, y: h - 6, text: 'SÉSAMO', size: 2.4, color: SOFT, align: 'center', tracking: 0.5 },
  )
  return p
}

function card({ ticket, event, design, payload, locale, labels }: RenderInput): Prim[] {
  const { w, h } = PRESET_SIZE.card
  const pad = 5
  const qrSize = 30
  const accent = design.accent
  const textX = pad + qrSize + 5
  const textW = w - textX - pad
  return [
    { t: 'rect', x: 0, y: 0, w, h, fill: '#FFFFFF', stroke: INK, lw: 0.4 },
    { t: 'rect', x: 0, y: 0, w, h: 2, fill: accent },
    { t: 'qr', x: pad, y: pad + 4, size: qrSize, matrix: qrMatrix(payload) },
    { t: 'text', x: pad + qrSize / 2, y: h - 5.5, text: ticket.code, size: 3.4, font: 'mono', weight: 'bold', align: 'center' },
    fitted({ x: textX, y: pad + 9, text: upper(event.name), size: 4.6, weight: 'bold', tracking: -0.03 }, textW),
    fitted({ x: textX, y: pad + 14.5, text: subtitle(event, locale), size: 2.5, color: SOFT, tracking: 0.2 }, textW),
    { t: 'line', x1: textX, y1: pad + 18, x2: w - pad, y2: pad + 18, color: '#DDDDDD', lw: 0.3 },
    { t: 'text', x: textX, y: pad + 24, text: upper(labels.holder), size: 2.2, color: SOFT, tracking: 0.3 },
    fitted(
      {
        x: textX,
        y: pad + 30,
        text: ticket.holder || labels.unassigned,
        size: 4.4,
        weight: ticket.holder ? 'bold' : 'normal',
        color: ticket.holder ? INK : SOFT,
        tracking: -0.04,
      },
      textW,
    ),
    ...tierBadge(textX, h - 14, fitBadge(ticket.tier, 2.6, textW), accent),
  ]
}

function badge({ ticket, event, design, payload, locale, labels }: RenderInput): Prim[] {
  const { w, h } = PRESET_SIZE.badge
  const pad = 6
  // Vertical stack, top to bottom: header band, event line, name, tier chip,
  // QR, code. The chip ends at 47 and the QR starts at 50 — they used to
  // overlap by 2 mm, which put a coloured block over the QR's quiet zone.
  const chipY = 41
  const qrSize = 35
  const qrY = 50
  const accent = design.accent
  const chip = fitBadge(ticket.tier, 2.8, w - pad * 2)
  return [
    { t: 'rect', x: 0, y: 0, w, h, fill: '#FFFFFF', stroke: INK, lw: 0.4 },
    { t: 'rect', x: 0, y: 0, w, h: 12, fill: accent },
    fitted(
      {
        x: w / 2,
        y: 7.8,
        text: upper(event.name),
        size: 4.4,
        weight: 'bold',
        color: '#FFFFFF',
        align: 'center',
        tracking: 0.04,
      },
      w - pad * 2,
    ),
    fitted(
      { x: w / 2, y: 20, text: subtitle(event, locale), size: 2.5, color: SOFT, align: 'center', tracking: 0.24 },
      w - pad * 2,
    ),
    { t: 'text', x: w / 2, y: 30, text: upper(labels.holder), size: 2.2, color: SOFT, align: 'center', tracking: 0.3 },
    fitted(
      {
        x: w / 2,
        y: 38,
        text: ticket.holder || labels.unassigned,
        size: 5.6,
        weight: ticket.holder ? 'bold' : 'normal',
        color: ticket.holder ? INK : SOFT,
        align: 'center',
        tracking: -0.05,
      },
      w - pad * 2,
    ),
    ...tierBadge(w / 2 - (chip?.width ?? 0) / 2, chipY, chip, accent),
    { t: 'qr', x: (w - qrSize) / 2, y: qrY, size: qrSize, matrix: qrMatrix(payload) },
    { t: 'text', x: w / 2, y: h - 9, text: ticket.code, size: 4, font: 'mono', weight: 'bold', align: 'center' },
    { t: 'text', x: w / 2, y: h - 4, text: 'SÉSAMO', size: 2.2, color: SOFT, align: 'center', tracking: 0.5 },
    { t: 'line', x1: pad, y1: h - 12.5, x2: w - pad, y2: h - 12.5, color: '#DDDDDD', lw: 0.3 },
  ]
}

function bare({ ticket, payload }: RenderInput): Prim[] {
  const { w, h } = PRESET_SIZE.bare
  const qrSize = w - 8
  return [
    { t: 'qr', x: 4, y: 4, size: qrSize, matrix: qrMatrix(payload) },
    { t: 'text', x: w / 2, y: h - 3.5, text: ticket.code, size: 4, font: 'mono', weight: 'bold', align: 'center' },
  ]
}

/* ---------------------------------------------------------------- custom --- */

/**
 * Every custom field is centre-anchored, so the defaults keep well clear of the
 * edges — a name dropped at x=0.08 would hang half of itself off the ticket.
 */
export function defaultCustomFields(ink = '#111111'): CustomField[] {
  return [
    { id: 'qr', x: 0.76, y: 0.44, size: 0.24, visible: true, color: '#000000' },
    { id: 'code', x: 0.76, y: 0.76, size: 0.05, visible: true, color: ink },
    { id: 'holder', x: 0.34, y: 0.62, size: 0.075, visible: true, color: ink },
    { id: 'tier', x: 0.34, y: 0.78, size: 0.04, visible: false, color: ink },
    { id: 'event', x: 0.34, y: 0.24, size: 0.07, visible: false, color: ink },
    { id: 'date', x: 0.34, y: 0.36, size: 0.035, visible: false, color: ink },
  ]
}

export const DEFAULT_CUSTOM_FIELDS: CustomField[] = defaultCustomFields()

/**
 * Picks a legible default text colour for uploaded artwork by averaging the
 * image down to a handful of pixels. Dark poster, light type — and the user can
 * still override every field.
 */
export function inkForImage(image: HTMLImageElement): string {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 16
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return '#111111'
  ctx.drawImage(image, 0, 0, 16, 16)
  const { data } = ctx.getImageData(0, 0, 16, 16)
  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
  }
  return sum / (data.length / 4) < 130 ? '#FFFFFF' : '#111111'
}

function customLayout(input: RenderInput, layout: CustomLayout): Prim[] {
  const { ticket, event, payload, locale, labels } = input
  const w = layout.widthMm
  const h = layout.heightMm
  const prims: Prim[] = [{ t: 'image', x: 0, y: 0, w, h, href: layout.image }]

  for (const field of layout.fields) {
    if (!field.visible) continue
    const x = field.x * w
    const y = field.y * h
    if (field.id === 'qr') {
      const size = field.size * w
      // A QR needs dark modules on a light field with a quiet zone around it.
      // Artwork is often dark, and our own fallback decoder never tries an
      // inverted read — so the code always gets its own white plate, and its
      // modules stay black. That is a scanning requirement, not a style.
      const quiet = size * 0.14
      prims.push({
        t: 'rect',
        x: x - size / 2 - quiet,
        y: y - size / 2 - quiet,
        w: size + quiet * 2,
        h: size + quiet * 2,
        fill: '#FFFFFF',
      })
      prims.push({ t: 'qr', x: x - size / 2, y: y - size / 2, size, matrix: qrMatrix(payload) })
      continue
    }
    const size = field.size * w
    const text =
      field.id === 'code'
        ? ticket.code
        : field.id === 'holder'
          ? ticket.holder || labels.unassigned
          : field.id === 'tier'
            ? upper(ticket.tier)
            : field.id === 'event'
              ? upper(event.name)
              : subtitle(event, locale)
    prims.push({
      t: 'text',
      x,
      y: y + size * 0.36,
      text,
      size,
      font: field.id === 'code' ? 'mono' : 'sans',
      weight: field.id === 'holder' || field.id === 'event' || field.id === 'code' ? 'bold' : 'normal',
      color: field.color,
      align: 'center',
    })
  }
  return prims
}

/* ---------------------------------------------------------------- public --- */

export function ticketSize(design: TicketDesign): { w: number; h: number } {
  if (design.custom) return { w: design.custom.widthMm, h: design.custom.heightMm }
  return PRESET_SIZE[design.preset]
}

export function renderTicket(input: RenderInput): Prim[] {
  if (input.design.custom) return customLayout(input, input.design.custom)
  switch (input.design.preset) {
    case 'card':
      return card(input)
    case 'badge':
      return badge(input)
    case 'bare':
      return bare(input)
    default:
      return stub(input)
  }
}

/* ------------------------------------------------------------------- svg --- */

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)

/** Draws the same primitives as the PDF, with the same two font families. */
export function toSvg(prims: Prim[], w: number, h: number): string {
  const out: string[] = []
  for (const p of prims) {
    switch (p.t) {
      case 'rect':
        out.push(
          `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${p.fill ?? 'none'}"` +
            (p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.lw ?? 0.3}"` : '') +
            ' />',
        )
        break
      case 'line':
        out.push(
          `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="${p.color ?? INK}" stroke-width="${p.lw ?? 0.3}" />`,
        )
        break
      case 'perf': {
        const [x2, y2] = p.vertical ? [p.x, p.y + p.len] : [p.x + p.len, p.y]
        out.push(
          `<line x1="${p.x}" y1="${p.y}" x2="${x2}" y2="${y2}" stroke="${p.color ?? '#B4B4B4'}" stroke-width="0.5" stroke-linecap="round" stroke-dasharray="0.01 2.2" />`,
        )
        break
      }
      case 'text':
        out.push(
          `<text x="${p.x}" y="${p.y}" font-size="${p.size}" fill="${p.color ?? INK}"` +
            ` font-family="${p.font === 'mono' ? 'Courier New, Courier, monospace' : 'Helvetica, Arial, sans-serif'}"` +
            ` font-weight="${p.weight === 'bold' ? '700' : '400'}"` +
            ` text-anchor="${p.align === 'center' ? 'middle' : p.align === 'right' ? 'end' : 'start'}"` +
            (p.tracking ? ` letter-spacing="${p.tracking}"` : '') +
            `>${escapeXml(p.text)}</text>`,
        )
        break
      case 'qr': {
        const cell = p.size / p.matrix.size
        let d = ''
        for (let y = 0; y < p.matrix.size; y++) {
          for (let x = 0; x < p.matrix.size; x++) {
            if (p.matrix.get(x, y)) d += `M${(p.x + x * cell).toFixed(3)} ${(p.y + y * cell).toFixed(3)}h${cell.toFixed(3)}v${cell.toFixed(3)}h-${cell.toFixed(3)}z`
          }
        }
        out.push(`<path d="${d}" fill="${p.color ?? '#000000'}" shape-rendering="crispEdges" />`)
        break
      }
      case 'image':
        out.push(`<image x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" href="${p.href}" preserveAspectRatio="none" />`)
        break
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%">${out.join('')}</svg>`
}
