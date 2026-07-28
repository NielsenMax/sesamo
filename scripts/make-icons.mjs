/*
  Rasterises the Sésamo mark into the PNGs the manifest needs.

  The mark is nothing but axis-aligned rectangles on a 9×9 module grid, so it
  rasterises exactly at any size — no rendering dependency required. This writes
  PNGs by hand (IHDR/IDAT/IEND, zlib from node core).

    node scripts/make-icons.mjs
*/
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const NIGHT = [0x12, 0x10, 0x0d]
const AMBER = [0xe8, 0xa3, 0x3d]

/** The mark as module rectangles on a 9×9 grid: [x, y, w, h]. */
const MODULES = [
  [0, 0, 9, 1], // outer lintel
  [0, 1, 1, 8], // outer left post
  [8, 1, 1, 8], // outer right post
  [2, 2, 5, 1], // inner lintel
  [2, 3, 1, 6], // inner left post
  [6, 3, 1, 6], // inner right post
]

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(width, height, rgb) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3)
    raw[row] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const px = rgb(x, y)
      const at = row + 1 + x * 3
      raw[at] = px[0]
      raw[at + 1] = px[1]
      raw[at + 2] = px[2]
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** @param inset fraction of the canvas left as margin around the mark. */
function icon(size, inset) {
  const pad = Math.round(size * inset)
  const box = size - pad * 2
  const module = box / 9
  return png(size, size, (x, y) => {
    const mx = (x - pad) / module
    const my = (y - pad) / module
    for (const [rx, ry, rw, rh] of MODULES) {
      if (mx >= rx && mx < rx + rw && my >= ry && my < ry + rh) return AMBER
    }
    return NIGHT
  })
}

mkdirSync(OUT, { recursive: true })
const files = [
  ['icon-192.png', icon(192, 0.16)],
  ['icon-512.png', icon(512, 0.16)],
  // Maskable icons get cropped to a circle by some launchers: keep the mark
  // inside the 80% safe zone.
  ['icon-maskable.png', icon(512, 0.26)],
  ['apple-touch-icon.png', icon(180, 0.16)],
]
for (const [name, buf] of files) {
  writeFileSync(join(OUT, name), buf)
  console.log(`wrote public/${name} (${buf.length} bytes)`)
}
