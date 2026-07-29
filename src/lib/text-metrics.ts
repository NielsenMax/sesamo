/*
  How wide is this string, actually?

  Ticket layouts were cutting names at a fixed character count, which is wrong
  twice over: "Ana Pérez" and "MWWWWWWWW" are the same length and nothing like
  the same width, and chopping somebody's surname off is a poor way to hand them
  a ticket. So we measure properly and shrink the type to fit, only ellipsising
  when a name is so long that even the minimum size won't do.

  The measurements are the published Adobe AFM advance widths for the base-14
  PDF fonts, in 1/1000 em. They are exact for the PDF, and near-exact for the
  SVG preview, since Arial — what browsers substitute for Helvetica — shares
  Helvetica's metrics.
*/

// prettier-ignore
const HELVETICA = [
  278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,
  278,278,584,584,584,556,1015,
  667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
  278,278,278,469,556,333,
  556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,
  334,260,334,584,
]

// prettier-ignore
const HELVETICA_BOLD = [
  278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,
  333,333,584,584,584,611,975,
  722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
  333,278,333,584,556,333,
  556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,
  389,280,389,584,
]

/** Courier is monospaced: every glyph is 600/1000 em. */
const COURIER_WIDTH = 600

export type Face = { font?: 'sans' | 'mono'; weight?: 'normal' | 'bold'; tracking?: number }

/**
 * Accented characters carry their base letter's advance width in these fonts,
 * so folding the diacritics away lets one ASCII table measure Spanish too.
 */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/** Width of `text` at `size` millimetres, in millimetres. */
export function measure(text: string, size: number, face: Face = {}): number {
  const table = face.font === 'mono' ? null : face.weight === 'bold' ? HELVETICA_BOLD : HELVETICA
  const folded = fold(text)
  let em = 0
  for (const char of folded) {
    if (!table) {
      em += COURIER_WIDTH
      continue
    }
    const index = char.charCodeAt(0) - 32
    em += index >= 0 && index < table.length ? table[index] : 556
  }
  const tracking = (face.tracking ?? 0) * Math.max(0, folded.length - 1)
  return (em / 1000) * size + tracking
}

export type Fitted = { text: string; size: number }

/**
 * Fits `text` into `maxWidth` by shrinking from `size` down to `minSize`, then
 * ellipsising if it still won't go. Returns what to draw and at what size, so
 * the SVG preview and the PDF make the identical decision.
 */
export function fitText(
  text: string,
  maxWidth: number,
  size: number,
  face: Face = {},
  minSize = size * 0.62,
): Fitted {
  if (!text) return { text, size }
  if (measure(text, size, face) <= maxWidth) return { text, size }

  // Shrink in fine steps — a name a hair too wide shouldn't drop a whole point.
  let fitted = size
  const step = Math.max(0.05, size * 0.02)
  while (fitted > minSize) {
    fitted = Math.max(minSize, fitted - step)
    if (measure(text, fitted, face) <= maxWidth) return { text, size: fitted }
  }

  // Still too long: trim to the widest prefix that fits, with an ellipsis.
  let clipped = text
  while (clipped.length > 1 && measure(`${clipped}…`, minSize, face) > maxWidth) {
    clipped = clipped.slice(0, -1)
  }
  return { text: `${clipped.trimEnd()}…`, size: minSize }
}
