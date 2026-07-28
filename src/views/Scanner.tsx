import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { useEvent } from '@/state/event'
import { useMode } from '@/components/Chrome'
import { Mark } from '@/components/Logo'
import { useScanner } from '@/components/useScanner'
import { isGood } from '@/lib/verdict'
import type { Verdict } from '@/lib/verdict'
import type { ScanResult } from '@/lib/types'

/** How long a clean pass stays on screen before the door is ready again. */
const GRANTED_MS = 1800
/** The same QR sitting in frame shouldn't produce twenty audit rows. */
const REPEAT_GUARD_MS = 3000

const TONE: Record<ScanResult, 'go' | 'stamp' | 'amber'> = {
  granted: 'go',
  override: 'go',
  repeat: 'amber',
  voided: 'stamp',
  invalid: 'stamp',
  otherEvent: 'stamp',
  unknown: 'amber',
}

export function Scanner() {
  useMode('night')
  const { t } = useI18n()
  const { spreadsheetId } = useParams()
  const { event, tickets, check, letThrough, online, pending, admitted, pull, busy } = useEvent()

  const [scanning, setScanning] = useState(false)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [overridden, setOverridden] = useState(false)
  const [manual, setManual] = useState('')
  const [showManual, setShowManual] = useState(false)
  const lastRaw = useRef<{ value: string; at: number }>({ value: '', at: 0 })
  const dismissTimer = useRef<number>(0)
  const holding = useRef(false)

  const dismiss = useCallback(() => {
    window.clearTimeout(dismissTimer.current)
    setVerdict(null)
    setOverridden(false)
    holding.current = false
  }, [])

  const handle = useCallback(
    async (raw: string, mode: 'camera' | 'manual') => {
      if (holding.current) return
      const now = Date.now()
      if (mode === 'camera' && raw === lastRaw.current.value && now - lastRaw.current.at < REPEAT_GUARD_MS) return
      lastRaw.current = { value: raw, at: now }
      holding.current = true

      const result = await check(raw, mode)
      setOverridden(false)
      setVerdict(result)
      navigator.vibrate?.(isGood(result.result) ? 40 : [60, 60, 60])

      if (result.result === 'granted') {
        // A clean pass shouldn't need a tap; anything else waits for a human.
        dismissTimer.current = window.setTimeout(dismiss, GRANTED_MS)
      }
    },
    [check, dismiss],
  )

  const { videoRef, error, torchOn, torchAvailable, toggleTorch, switchCamera } = useScanner({
    active: scanning,
    onCode: (value) => void handle(value, 'camera'),
  })

  useEffect(() => () => window.clearTimeout(dismissTimer.current), [])

  async function submitManual(e: FormEvent) {
    e.preventDefault()
    if (!manual.trim()) return
    await handle(manual.trim(), 'manual')
    setManual('')
  }

  async function override() {
    if (!verdict) return
    await letThrough(verdict)
    setOverridden(true)
    navigator.vibrate?.(40)
    // Longer than a clean pass: whoever tapped it should see it was recorded.
    dismissTimer.current = window.setTimeout(dismiss, GRANTED_MS + 1200)
  }

  if (!event) return null

  const tone = verdict ? TONE[overridden ? 'override' : verdict.result] : 'go'
  const label = verdict ? t.scanner.verdict[overridden ? 'override' : verdict.result] : ''
  const why = verdict && verdict.result !== 'granted' ? t.scanner.verdictWhy[verdict.result as keyof typeof t.scanner.verdictWhy] : ''

  return (
    <div className="door">
      <header className="door__bar">
        <Link className="door__back" to={`/e/${spreadsheetId}/tickets`}>
          ← {t.nav.tickets}
        </Link>
        <span className="door__count numeral">{t.scanner.counter(admitted, tickets.length)}</span>
        <span className={`door__net${online ? '' : ' is-off'}`}>
          {online ? (pending > 0 ? t.sync.pending(pending) : t.sync.online) : t.sync.offline}
        </span>
      </header>

      <div className="door__stage">
        <video ref={videoRef} className="door__video" playsInline muted autoPlay />

        {!scanning && (
          <div className="door__idle">
            <Mark size={96} tone="amber" />
            <p className="door__ready mono">
              {tickets.length ? t.scanner.ready(tickets.length) : t.scanner.notReady}
            </p>
            <button type="button" className="btn btn--accent btn--lg" onClick={() => setScanning(true)}>
              {t.scanner.start}
            </button>
            {!tickets.length && (
              <button type="button" className="btn btn--outline" disabled={!online || busy === 'pulling'} onClick={() => void pull()}>
                {busy === 'pulling' ? t.sync.pulling : t.scanner.download}
              </button>
            )}
            {!online && <p className="door__note">{t.sync.offlineNote}</p>}
          </div>
        )}

        {scanning && !verdict && (
          <>
            {/* The logo becomes the frame you aim through. */}
            <div className="reticle" aria-hidden="true">
              <span className="reticle__corner reticle__corner--tl" />
              <span className="reticle__corner reticle__corner--tr" />
              <span className="reticle__corner reticle__corner--bl" />
              <span className="reticle__corner reticle__corner--br" />
              <span className="reticle__sweep" />
            </div>
            <p className="door__hint">{t.scanner.point}</p>
          </>
        )}

        {error && (
          <div className="door__idle">
            <p className="door__error">{error === 'denied' ? t.scanner.cameraDenied : t.scanner.cameraMissing}</p>
            <p className="door__note">{t.scanner.cameraDeniedHelp}</p>
            <button type="button" className="btn btn--outline" onClick={() => setShowManual(true)}>
              {t.scanner.manual}
            </button>
          </div>
        )}

        {verdict && (
          <div className={`stamp stamp--${tone}`} role="alert" onClick={dismiss}>
            <div className="stamp__mark">
              <Mark size={56} tone={tone === 'go' ? 'go' : tone === 'stamp' ? 'stamp' : 'amber'} lit={tone === 'go'} />
            </div>
            <p className="stamp__label display">{label}</p>
            {why && <p className="stamp__why">{why}</p>}

            <p className="stamp__code mono">{verdict.code || verdict.detail}</p>
            {verdict.ticket && (
              <>
                <p className="stamp__holder display">{verdict.ticket.holder || t.tickets.unassigned}</p>
                {verdict.ticket.tier && <p className="stamp__tier eyebrow">{verdict.ticket.tier}</p>}
              </>
            )}

            {verdict.ticket && verdict.ticket.entries.length > 0 && (
              <div className="stamp__history">
                <p className="eyebrow">{t.scanner.history}</p>
                <ul className="stamp__times">
                  {verdict.ticket.entries.map((entry, i) => (
                    <li key={`${entry}-${i}`} className="mono">
                      {entry.slice(11) || entry}
                      {i === verdict.ticket!.entries.length - 1 && isGood(overridden ? 'override' : verdict.result) ? ' ←' : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="stamp__actions" onClick={(e) => e.stopPropagation()}>
              {verdict.overridable && !overridden && (
                <button type="button" className="btn btn--outline btn--lg" onClick={() => void override()}>
                  {t.scanner.overrideCta}
                </button>
              )}
              {overridden && <p className="stamp__note">{t.scanner.overrideDone}</p>}
              <button type="button" className="btn btn--accent btn--lg" onClick={dismiss}>
                {t.scanner.next}
              </button>
            </div>
          </div>
        )}
      </div>

      <footer className="door__foot">
        {scanning && (
          <>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setScanning(false)}>
              {t.scanner.stop}
            </button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={switchCamera}>
              {t.scanner.switchCamera}
            </button>
            {torchAvailable && (
              <button type="button" className="btn btn--quiet btn--sm" aria-pressed={torchOn} onClick={() => void toggleTorch()}>
                {t.scanner.torch}
              </button>
            )}
          </>
        )}
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => setShowManual((v) => !v)}>
          {t.scanner.manual}
        </button>
      </footer>

      {showManual && (
        <form className="door__manual" onSubmit={submitManual}>
          <label className="eyebrow" htmlFor="manual-code">
            {t.scanner.manualLabel}
          </label>
          <div className="row">
            <input
              id="manual-code"
              className="input input--mono"
              autoComplete="off"
              autoCapitalize="characters"
              placeholder={t.scanner.manualPlaceholder}
              value={manual}
              onChange={(e) => setManual(e.target.value.toUpperCase())}
            />
            <button type="submit" className="btn btn--accent">
              {t.scanner.manualSubmit}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
