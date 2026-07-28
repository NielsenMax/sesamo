/*
  Turning tickets into files people can print.

  The PDF is drawn as vectors — the QR too, as merged runs of rectangles — so a
  180 mm ticket and a 40 mm one are equally sharp and 200 tickets stay a small
  file. The alternative, rasterising each ticket, would produce a 60 MB PDF that
  prints soft.
*/
import { jsPDF } from 'jspdf'
import JSZip from 'jszip'
import { qrPayload } from './codes'
import { qrPng } from './qr'
import { renderTicket, ticketSize, type Prim, type TicketDesign } from './ticket-render'
import type { EventConfig, Ticket } from './types'

const MM_PER_PT = 25.4 / 72

export type Paper = 'a4' | 'letter'
export const PAPER_SIZE: Record<Paper, { w: number; h: number }> = {
  a4: { w: 210, h: 297 },
  letter: { w: 215.9, h: 279.4 },
}

const MARGIN = 10
const GUTTER = 4

export type ExportOptions = {
  paper: Paper
  locale: string
  labels: { holder: string; unassigned: string }
  onProgress?: (done: number, total: number) => void
}

function hex(color: string): [number, number, number] {
  const v = color.replace('#', '')
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

/**
 * Merges each row of dark QR modules into the fewest possible rectangles.
 * A 33×33 QR drops from ~550 individual rects to ~120, which is the difference
 * between a snappy PDF and one Preview chokes on.
 */
function qrRuns(prim: Extract<Prim, { t: 'qr' }>): { x: number; y: number; w: number; h: number }[] {
  const cell = prim.size / prim.matrix.size
  const runs: { x: number; y: number; w: number; h: number }[] = []
  for (let y = 0; y < prim.matrix.size; y++) {
    let start = -1
    for (let x = 0; x <= prim.matrix.size; x++) {
      const on = x < prim.matrix.size && prim.matrix.get(x, y)
      if (on && start === -1) start = x
      if (!on && start !== -1) {
        runs.push({
          x: prim.x + start * cell,
          y: prim.y + y * cell,
          // A hair of overlap keeps rasterisers from leaving white seams.
          w: (x - start) * cell + 0.02,
          h: cell + 0.02,
        })
        start = -1
      }
    }
  }
  return runs
}

function draw(doc: jsPDF, prims: Prim[], ox: number, oy: number) {
  for (const p of prims) {
    switch (p.t) {
      case 'rect': {
        if (p.fill) doc.setFillColor(...hex(p.fill))
        if (p.stroke) doc.setDrawColor(...hex(p.stroke))
        doc.setLineWidth(p.lw ?? 0.3)
        const style = p.fill && p.stroke ? 'FD' : p.fill ? 'F' : 'S'
        doc.rect(ox + p.x, oy + p.y, p.w, p.h, style)
        break
      }
      case 'line':
        doc.setDrawColor(...hex(p.color ?? '#141414'))
        doc.setLineWidth(p.lw ?? 0.3)
        doc.line(ox + p.x1, oy + p.y1, ox + p.x2, oy + p.y2)
        break
      case 'perf':
        doc.setDrawColor(...hex(p.color ?? '#B4B4B4'))
        doc.setLineWidth(0.5)
        doc.setLineCap('round')
        doc.setLineDashPattern([0.01, 2.2], 0)
        if (p.vertical) doc.line(ox + p.x, oy + p.y, ox + p.x, oy + p.y + p.len)
        else doc.line(ox + p.x, oy + p.y, ox + p.x + p.len, oy + p.y)
        doc.setLineDashPattern([], 0)
        doc.setLineCap('butt')
        break
      case 'text':
        doc.setFont(p.font === 'mono' ? 'courier' : 'helvetica', p.weight === 'bold' ? 'bold' : 'normal')
        doc.setFontSize(p.size / MM_PER_PT)
        doc.setTextColor(...hex(p.color ?? '#141414'))
        doc.text(p.text, ox + p.x, oy + p.y, {
          align: p.align ?? 'left',
          charSpace: p.tracking ?? 0,
        })
        break
      case 'qr':
        doc.setFillColor(...hex(p.color ?? '#000000'))
        for (const run of qrRuns(p)) doc.rect(ox + run.x, oy + run.y, run.w, run.h, 'F')
        break
      case 'image':
        try {
          doc.addImage(p.href, ox + p.x, oy + p.y, p.w, p.h)
        } catch {
          /* an unreadable data URL shouldn't take the whole export down */
        }
        break
    }
  }
}

/** Faint corner ticks so a layout with no printed border can still be trimmed. */
function cutMarks(doc: jsPDF, x: number, y: number, w: number, h: number) {
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.15)
  const t = 2.5
  for (const [cx, cy, dx, dy] of [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ] as const) {
    doc.line(cx, cy, cx + dx * t, cy)
    doc.line(cx, cy, cx, cy + dy * t)
  }
}

export async function buildPdf(
  event: EventConfig,
  tickets: Ticket[],
  design: TicketDesign,
  options: ExportOptions,
): Promise<Blob> {
  const size = ticketSize(design)
  const page = PAPER_SIZE[options.paper]
  // Turn the page if the tickets simply fit better sideways.
  const portraitCols = Math.max(1, Math.floor((page.w - 2 * MARGIN + GUTTER) / (size.w + GUTTER)))
  const portraitRows = Math.max(1, Math.floor((page.h - 2 * MARGIN + GUTTER) / (size.h + GUTTER)))
  const landscapeCols = Math.max(1, Math.floor((page.h - 2 * MARGIN + GUTTER) / (size.w + GUTTER)))
  const landscapeRows = Math.max(1, Math.floor((page.w - 2 * MARGIN + GUTTER) / (size.h + GUTTER)))
  const landscape = landscapeCols * landscapeRows > portraitCols * portraitRows

  const doc = new jsPDF({
    unit: 'mm',
    format: options.paper,
    orientation: landscape ? 'landscape' : 'portrait',
    // A vector QR is thousands of tiny rectangles; deflating the content
    // streams turns a 600 kB sheet of tickets into well under a tenth of that.
    compress: true,
  })
  const pageW = landscape ? page.h : page.w
  const cols = landscape ? landscapeCols : portraitCols
  const rows = landscape ? landscapeRows : portraitRows
  const perPage = cols * rows
  const offsetX = (pageW - (cols * size.w + (cols - 1) * GUTTER)) / 2

  for (let i = 0; i < tickets.length; i++) {
    const slot = i % perPage
    if (i > 0 && slot === 0) doc.addPage()
    const col = slot % cols
    const row = Math.floor(slot / cols)
    const x = offsetX + col * (size.w + GUTTER)
    const y = MARGIN + row * (size.h + GUTTER)

    const payload = await qrPayload(event.secret, event.eventCode, tickets[i].serial)
    const prims = renderTicket({
      ticket: tickets[i],
      event,
      design,
      payload,
      locale: options.locale,
      labels: options.labels,
    })
    if (design.preset === 'bare' && !design.custom) cutMarks(doc, x, y, size.w, size.h)
    draw(doc, prims, x, y)

    if (i % 10 === 0) {
      options.onProgress?.(i, tickets.length)
      // Yield so the progress readout actually paints during a long export.
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  options.onProgress?.(tickets.length, tickets.length)
  return doc.output('blob')
}

export async function buildQrZip(
  event: EventConfig,
  tickets: Ticket[],
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const zip = new JSZip()
  const folder = zip.folder(event.name.replace(/[^\w\s-]/g, '').trim() || 'sesamo')!
  const index: string[] = ['code,serial,name,type']

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i]
    const payload = await qrPayload(event.secret, event.eventCode, ticket.serial)
    const dataUrl = await qrPng(payload)
    folder.file(`${ticket.code}.png`, dataUrl.split(',')[1], { base64: true })
    index.push([ticket.code, ticket.serial, ticket.holder, ticket.tier].map(csv).join(','))
    if (i % 10 === 0) {
      onProgress?.(i, tickets.length)
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  // Without this, a folder of 200 PNGs named by code is unusable.
  folder.file('index.csv', index.join('\n'))
  onProgress?.(tickets.length, tickets.length)
  return zip.generateAsync({ type: 'blob' })
}

function csv(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoked on the next tick: Safari cancels the download if the URL dies first.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function slug(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'sesamo'
  )
}
