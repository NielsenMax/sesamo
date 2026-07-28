import { NavLink, Outlet, useLocation, useParams } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { EventProvider, useEvent } from '@/state/event'
import { TopBar, useMode } from '@/components/Chrome'
import { Button, Notice, Spinner } from '@/components/ui'
import { spreadsheetUrl } from '@/lib/google/sheets'

export function SyncLine() {
  const { t, fmtDateTime } = useI18n()
  const { online, pending, busy, pull, push, event } = useEvent()
  if (!event) return null
  const state = !online ? 'off' : pending > 0 ? 'pending' : 'on'
  return (
    <div className="syncline">
      <span className={`syncline__dot syncline__dot--${state}`} aria-hidden="true" />
      <span>{online ? t.sync.online : t.sync.offline}</span>
      <span aria-hidden="true">·</span>
      <span>{pending > 0 ? t.sync.pending(pending) : t.sync.allSynced}</span>
      {event.lastPull && (
        <>
          <span aria-hidden="true">·</span>
          <span>
            {t.sync.lastPull} {fmtDateTime(event.lastPull)}
          </span>
        </>
      )}
      <span className="syncline__spacer" />
      <Button size="sm" variant="quiet" loading={busy === 'pulling'} disabled={!online} onClick={() => void pull()}>
        {busy === 'pulling' ? t.sync.pulling : t.sync.pull}
      </Button>
      {pending > 0 && (
        <Button size="sm" variant="quiet" loading={busy === 'pushing'} disabled={!online} onClick={() => void push()}>
          {busy === 'pushing' ? t.sync.pushing : t.sync.push}
        </Button>
      )}
    </div>
  )
}

function EventChrome() {
  useMode('day')
  const { t } = useI18n()
  const { spreadsheetId } = useParams()
  const { state, error, event } = useEvent()
  const base = `/e/${spreadsheetId}`

  const links = [
    { to: `${base}/tickets`, label: t.nav.tickets },
    { to: `${base}/design`, label: t.nav.design },
    { to: `${base}/scan`, label: t.nav.scan },
    { to: `${base}/log`, label: t.nav.log },
    { to: `${base}/settings`, label: t.nav.event },
  ]

  return (
    <>
      <TopBar
        right={
          event && (
            <a className="topbar__sheet mono" href={spreadsheetUrl(event.spreadsheetId)} target="_blank" rel="noreferrer">
              {t.common.openInSheets} ↗
            </a>
          )
        }
      />
      <nav className="eventnav" aria-label={t.nav.event}>
        <div className="eventnav__inner">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} className="eventnav__link">
              {link.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="strip">
        {event && (
          <div className="eventhead">
            <h1 className="eventhead__name display">{event.name}</h1>
            <p className="eventhead__meta mono">
              {[event.date, event.venue].filter(Boolean).join('  ·  ')}
              {event.date || event.venue ? '  ·  ' : ''}
              {event.eventCode}
            </p>
            <SyncLine />
          </div>
        )}

        {state === 'loading' && <Spinner label={t.common.loading} />}
        {state === 'error' && <Notice tone="error">{error ?? t.errors.generic}</Notice>}
        {state === 'ready' && (
          <>
            {error && <Notice tone="error">{error}</Notice>}
            <Outlet />
          </>
        )}
      </main>
    </>
  )
}

export function EventShell() {
  const { spreadsheetId } = useParams()
  const { pathname } = useLocation()
  // The door gets the screen to itself: no day chrome, no page furniture.
  const scanning = pathname.endsWith('/scan')

  return (
    <EventProvider spreadsheetId={spreadsheetId!}>
      {scanning ? <Outlet /> : <EventChrome />}
    </EventProvider>
  )
}
