/*
  The Sésamo mark.

  It is a QR finder pattern — the square-in-square that sits in three corners of
  every QR code — with its floor cut away. Two nested arches: a doorway that is
  already open. The same mark is the favicon, the wordmark, and (scaled up) the
  frame you point at a ticket in the scanner.

  `lit` floods the opening with light. That is the whole product in one state
  change: the door opens for you.
*/

type Tone = 'ink' | 'amber' | 'go' | 'stamp' | 'current'

const TONE_VAR: Record<Tone, string> = {
  ink: 'var(--ink)',
  amber: 'var(--amber)',
  go: 'var(--go)',
  stamp: 'var(--stamp)',
  current: 'currentColor',
}

// Outer arch: lintel + two posts, one module thick, open at the bottom.
const OUTER = 'M0 0 H9 V9 H8 V1 H1 V9 H0 Z'
// Inner arch: the same shape again, two modules in.
const INNER = 'M2 2 H7 V9 H6 V3 H3 V9 H2 Z'

export function Mark({
  size = 24,
  tone = 'current',
  lit = false,
  className,
}: {
  size?: number | string
  tone?: Tone
  lit?: boolean
  className?: string
}) {
  const fill = TONE_VAR[tone]
  return (
    <svg
      viewBox="0 0 9 9"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      style={{ overflow: 'visible' }}
    >
      {lit && (
        <rect
          x="3"
          y="3"
          width="3"
          height="6"
          fill={fill}
          opacity="0.28"
          style={{ transformOrigin: '4.5px 9px' }}
        >
          <animate attributeName="opacity" values="0;0.34;0.2" dur="0.5s" fill="freeze" />
        </rect>
      )}
      <path d={OUTER} fill={fill} />
      <path d={INNER} fill={fill} opacity={lit ? 0.55 : 1} />
    </svg>
  )
}

export function Wordmark({
  size = 'md',
  tagline = false,
  lit = false,
}: {
  size?: 'sm' | 'md' | 'lg'
  tagline?: boolean
  lit?: boolean
}) {
  return (
    <span className={`wordmark wordmark--${size}`}>
      {/* The mark sits inline so its open floor lands on the type's baseline. */}
      <span className="wordmark__name display">
        <Mark size="0.78em" tone="current" lit={lit} />
        Sésamo
      </span>
      {tagline && <span className="wordmark__tag eyebrow">ábrete · open up</span>}
    </span>
  )
}
