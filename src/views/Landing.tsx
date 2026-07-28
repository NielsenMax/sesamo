import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { useAuth } from '@/state/auth'
import { TopBar, useMode } from '@/components/Chrome'
import { Mark, Wordmark } from '@/components/Logo'
import { Button, Empty, Notice, Panel, Spinner } from '@/components/ui'
import { pickSpreadsheet } from '@/lib/google/picker'
import { probeSpreadsheet } from '@/lib/event-sheet'
import { forgetEvent, listEvents, putEvent } from '@/lib/db'
import type { StoredEvent } from '@/lib/types'

export function Landing() {
  useMode('day')
  const { t, lang, fmtDate } = useI18n()
  const auth = useAuth()
  const navigate = useNavigate()
  const [recent, setRecent] = useState<StoredEvent[]>([])
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    void listEvents().then(setRecent)
  }, [])

  useEffect(refresh, [refresh])

  const open = useCallback(async () => {
    setError(null)
    setOpening(true)
    try {
      const picked = await pickSpreadsheet(lang === 'es' ? 'es' : 'en')
      if (!picked) return
      const probe = await probeSpreadsheet(picked.id)
      if (probe.kind === 'ready') {
        await putEvent({
          ...probe.event,
          tabs: probe.tabs,
          lastPull: null,
          lastPush: null,
          ticketCount: 0,
          admittedCount: 0,
        })
        navigate(`/e/${picked.id}`)
        return
      }
      if (probe.kind === 'uninitialised') {
        // Not a Sésamo sheet yet — collect the event details, then set it up in
        // place rather than making a second spreadsheet.
        navigate(`/new?sheet=${picked.id}&name=${encodeURIComponent(picked.name)}`)
        return
      }
      setError(t.errors.corruptConfig)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.generic)
    } finally {
      setOpening(false)
    }
  }, [lang, navigate, t])

  const forget = useCallback(
    async (spreadsheetId: string) => {
      await forgetEvent(spreadsheetId)
      refresh()
    },
    [refresh],
  )

  return (
    <>
      <TopBar />
      <main className="strip">
        {/* Ticket N° 0001: the product introducing itself as the thing it makes. */}
        <div className="hero">
          <div className="hero__body">
            <Wordmark size="lg" tagline />
            <p className="hero__blurb">{t.app.blurb}</p>
            <p className="hero__lead eyebrow">{t.landing.lead}</p>

            {!auth.configured ? (
              <Notice tone="warn">
                <strong>{t.auth.missingConfig}</strong> — {t.auth.missingConfigHelp}
              </Notice>
            ) : !auth.signedIn ? (
              <div className="hero__actions">
                <Button variant="primary" size="lg" loading={auth.busy} onClick={() => void auth.signIn()}>
                  {auth.busy ? t.auth.signingIn : t.auth.signIn}
                </Button>
                <p className="hero__fineprint muted">{t.auth.why}</p>
              </div>
            ) : (
              <div className="hero__actions">
                <Button variant="primary" size="lg" onClick={() => navigate('/new')}>
                  {t.landing.newEvent}
                </Button>
                <Button size="lg" loading={opening} onClick={() => void open()}>
                  {t.landing.openEvent}
                </Button>
              </div>
            )}
            {auth.error && <Notice tone="error">{auth.error}</Notice>}
            {error && <Notice tone="error">{error}</Notice>}
          </div>

          <div className="hero__stub" aria-hidden="true">
            <div className="hero__arch">
              <Mark size="100%" tone="amber" />
            </div>
            <p className="hero__serial mono">N° 0001</p>
            <p className="hero__stubmark eyebrow">Sésamo</p>
          </div>
        </div>

        {auth.signedIn && (
          <Panel eyebrow={t.landing.recent} title={t.nav.event}>
            {recent.length === 0 ? (
              <Empty title={t.landing.recentEmpty} body={t.landing.newEventHint} />
            ) : (
              <ul className="ledger">
                {recent.map((event) => (
                  <li key={event.spreadsheetId} className="ledger__row">
                    <Link className="ledger__main" to={`/e/${event.spreadsheetId}`}>
                      <span className="ledger__name">{event.name}</span>
                      <span className="ledger__meta mono">
                        {event.date ? fmtDate(event.date) : ''} {event.venue ? `· ${event.venue}` : ''}
                      </span>
                    </Link>
                    <span className="ledger__code mono">{event.eventCode}</span>
                    <Button size="sm" variant="quiet" title={t.landing.forgetHint} onClick={() => void forget(event.spreadsheetId)}>
                      {t.landing.forget}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {/* A real sequence, so it earns its numbers. */}
        <Panel eyebrow={t.app.tagline} title={t.landing.how} tight>
          <ol className="steps">
            {[t.landing.steps.one, t.landing.steps.two, t.landing.steps.three].map((step, i) => (
              <li key={step} className="steps__item">
                <span className="steps__n numeral">{String(i + 1).padStart(2, '0')}</span>
                <span className="steps__text">{step}</span>
              </li>
            ))}
          </ol>
        </Panel>

        {opening && <Spinner label={t.common.loading} />}
      </main>
    </>
  )
}
