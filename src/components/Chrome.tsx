import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { useAuth } from '@/state/auth'
import { Wordmark } from './Logo'
import { Button } from './ui'

/**
 * Day at the desk, night at the door. The scanner is the only screen someone
 * holds up in the dark, so it is the only one that inverts.
 */
export function useMode(mode: 'day' | 'night') {
  useEffect(() => {
    const root = document.documentElement
    const previous = root.dataset.mode ?? 'day'
    root.dataset.mode = mode
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute('content', mode === 'night' ? '#12100D' : '#F0E6CF')
    return () => {
      root.dataset.mode = previous
    }
  }, [mode])
}

export function LangToggle() {
  const { lang, setLang, t } = useI18n()
  return (
    <div className="langtoggle" role="group" aria-label={t.lang.switch}>
      <button type="button" aria-pressed={lang === 'es'} onClick={() => setLang('es')}>
        ES
      </button>
      <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
        EN
      </button>
    </div>
  )
}

export function TopBar({ wide, right }: { wide?: boolean; right?: React.ReactNode }) {
  const { t } = useI18n()
  const auth = useAuth()
  return (
    <header className={`topbar${wide ? ' topbar--wide' : ''}`}>
      <div className="topbar__inner">
        <Link to="/" className="topbar__home" aria-label={t.app.name}>
          <Wordmark size="sm" />
        </Link>
        <div className="topbar__right">
          {right}
          <LangToggle />
          {auth.signedIn && (
            <span className="account">
              <span className="sr-only">{t.auth.signedInAs}</span>
              <span title={auth.email}>{auth.email.split('@')[0] || '·'}</span>
              <Button size="sm" variant="quiet" onClick={auth.signOut}>
                {t.auth.signOut}
              </Button>
            </span>
          )}
        </div>
      </div>
    </header>
  )
}
