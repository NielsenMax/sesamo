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

function truncate(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** The event line: `15 AGO 2026 · CLUB X`, with whichever halves exist. */
function subtitle(event: EventConfig, locale: string): string {
  const parts: string[] = []
  if (event.date) {
    const d = new Date(event.date)
    parts.push(
      Number.isNaN(d.getTime())
        ? event.date
        : upper(d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })),
    )
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

function tierBadge(x: number, y: number, label: string, accent: string, size = 3): Prim[] {
  if (!label) return []
  const padding = size * 0.9
  const w = label.length * size * 0.72 + padding * 2
  const h = size * 2.1
  return [
    { t: 'rect', x, y, w, h, fill: accent },
    {
      t: 'text',
      x: x + w / 2,
      y: y + h / 2 + size * 0.36,
      text: upper(label),
      size,
      weight: 'bold',
      color: '#FFFFFF',
      align: 'center',
      tracking: size * 0.06,
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

  p.push(
    {
      t: 'text',
      x: pad + 12,
      y: pad + 6.4,
      text: upper(truncate(event.name, 30)),
      size: 6.6,
      weight: 'bold',
      tracking: -0.05,
    },
    { t: 'text', x: pad, y: pad + 16, text: subtitle(event, locale), size: 3.1, color: SOFT, tracking: 0.28 },
    { t: 'line', x1: pad, y1: h - 27, x2: split - pad, y2: h - 27, color: '#D8D8D8', lw: 0.3 },
    { t: 'text', x: pad, y: h - 21, text: upper(labels.holder), size: 2.5, color: SOFT, tracking: 0.3 },
    {
      t: 'text',
      x: pad,
      y: h - 12,
      text: truncate(ticket.holder || labels.unassigned, 26),
      size: 7,
      weight: ticket.holder ? 'bold' : 'normal',
      color: ticket.holder ? INK : SOFT,
      tracking: -0.06,
    },
    ...tierBadge(split - pad - (ticket.tier.length * 3 * 0.72 + 5.4), h - 17, ticket.tier, accent, 3),
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
  return [
    { t: 'rect', x: 0, y: 0, w, h, fill: '#FFFFFF', stroke: INK, lw: 0.4 },
    { t: 'rect', x: 0, y: 0, w, h: 2, fill: accent },
    { t: 'qr', x: pad, y: pad + 4, size: qrSize, matrix: qrMatrix(payload) },
    { t: 'text', x: pad + qrSize / 2, y: h - 5.5, text: ticket.code, size: 3.4, font: 'mono', weight: 'bold', align: 'center' },
    {
      t: 'text',
      x: textX,
      y: pad + 9,
      text: upper(truncate(event.name, 20)),
      size: 4.6,
      weight: 'bold',
      tracking: -0.03,
    },
    { t: 'text', x: textX, y: pad + 14.5, text: truncate(subtitle(event, locale), 28), size: 2.5, color: SOFT, tracking: 0.2 },
    { t: 'line', x1: textX, y1: pad + 18, x2: w - pad, y2: pad + 18, color: '#DDDDDD', lw: 0.3 },
    { t: 'text', x: textX, y: pad + 24, text: upper(labels.holder), size: 2.2, color: SOFT, tracking: 0.3 },
    {
      t: 'text',
      x: textX,
      y: pad + 30,
      text: truncate(ticket.holder || labels.unassigned, 18),
      size: 4.4,
      weight: ticket.holder ? 'bold' : 'normal',
      color: ticket.holder ? INK : SOFT,
      tracking: -0.04,
    },
    ...tierBadge(textX, h - 14, ticket.tier, accent, 2.6),
  ]
}

function badge({ ticket, event, design, payload, locale, labels }: RenderInput): Prim[] {
  const { w, h } = PRESET_SIZE.badge
  const pad = 6
  const qrSize = 38
  const accent = design.accent
  return [
    { t: 'rect', x: 0, y: 0, w, h, fill: '#FFFFFF', stroke: INK, lw: 0.4 },
    { t: 'rect', x: 0, y: 0, w, h: 12, fill: accent },
    {
      t: 'text',
      x: w / 2,
      y: 7.8,
      text: upper(truncate(event.name, 22)),
      size: 4.4,
      weight: 'bold',
      color: '#FFFFFF',
      align: 'center',
      tracking: 0.04,
    },
    { t: 'text', x: w / 2, y: 20, text: truncate(subtitle(event, locale), 26), size: 2.5, color: SOFT, align: 'center', tracking: 0.24 },
    { t: 'text', x: w / 2, y: 30, text: upper(labels.holder), size: 2.2, color: SOFT, align: 'center', tracking: 0.3 },
    {
      t: 'text',
      x: w / 2,
      y: 38,
      text: truncate(ticket.holder || labels.unassigned, 18),
      size: 5.6,
      weight: ticket.holder ? 'bold' : 'normal',
      color: ticket.holder ? INK : SOFT,
      align: 'center',
      tracking: -0.05,
    },
    ...tierBadge(w / 2 - (ticket.tier.length * 2.8 * 0.72 + 5) / 2, 42, ticket.tier, accent, 2.8),
    { t: 'qr', x: (w - qrSize) / 2, y: h - qrSize - 16, size: qrSize, matrix: qrMatrix(payload) },
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

export const DEFAULT_CUSTOM_FIELDS: CustomField[] = [
  { id: 'qr', x: 0.72, y: 0.5, size: 0.22, visible: true, color: '#000000' },
  { id: 'code', x: 0.72, y: 0.86, size: 0.05, visible: true, color: '#000000' },
  { id: 'holder', x: 0.08, y: 0.62, size: 0.075, visible: true, color: '#000000' },
  { id: 'tier', x: 0.08, y: 0.8, size: 0.04, visible: false, color: '#000000' },
  { id: 'event', x: 0.08, y: 0.2, size: 0.07, visible: false, color: '#000000' },
  { id: 'date', x: 0.08, y: 0.32, size: 0.035, visible: false, color: '#000000' },
]

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
      prims.push({ t: 'qr', x: x - size / 2, y: y - size / 2, size, matrix: qrMatrix(payload), color: field.color })
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
