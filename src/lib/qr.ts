import QRCode from 'qrcode'

export type QrMatrix = { size: number; get: (x: number, y: number) => boolean }

/**
 * The QR as a module grid rather than an image, so it can be drawn as vectors
 * into a PDF — a printed ticket should stay razor sharp at any size, and a
 * matrix of rectangles weighs almost nothing next to a bitmap.
 */
export function qrMatrix(text: string): QrMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const { size, data } = qr.modules
  return { size, get: (x, y) => data[y * size + x] === 1 }
}

/** An SVG path covering every dark module — one path, no per-module elements. */
export function qrPath(matrix: QrMatrix, scale: number): string {
  let d = ''
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (matrix.get(x, y)) d += `M${x * scale} ${y * scale}h${scale}v${scale}h${-scale}z`
    }
  }
  return d
}

/** High-resolution PNG, for the bare-QR ZIP export. */
export function qrPng(text: string, pixels = 900): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    width: pixels,
    margin: 2,
    color: { dark: '#000000', light: '#FFFFFF' },
  })
}
