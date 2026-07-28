import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { es, type Dict } from './es'
import { en } from './en'
import { parseLocal } from '@/lib/dates'

export type Lang = 'es' | 'en'

const DICTS: Record<Lang, Dict> = { es, en }
const STORAGE_KEY = 'sesamo.lang'

function detect(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'es' || stored === 'en') return stored
  return navigator.languages?.some((l) => l.toLowerCase().startsWith('en')) &&
    !navigator.languages?.[0]?.toLowerCase().startsWith('es')
    ? 'en'
    : 'es'
}

type I18n = {
  lang: Lang
  t: Dict
  setLang: (lang: Lang) => void
  /** Locale-aware date/time formatting, so the log reads naturally in both. */
  fmtDateTime: (iso: string | Date | undefined) => string
  fmtTime: (iso: string | Date | undefined) => string
  fmtDate: (iso: string | Date | undefined) => string
}

const Ctx = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => detect())

  useEffect(() => {
    document.documentElement.lang = lang
    localStorage.setItem(STORAGE_KEY, lang)
  }, [lang])

  const setLang = useCallback((next: Lang) => setLangState(next), [])

  const value = useMemo<I18n>(() => {
    const locale = lang === 'es' ? 'es-AR' : 'en-GB'
    const asDate = (v: string | Date | undefined) => parseLocal(v)
    return {
      lang,
      t: DICTS[lang],
      setLang,
      fmtDateTime: (v) => {
        const d = asDate(v)
        return d
          ? d.toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
          : '—'
      },
      fmtTime: (v) => {
        const d = asDate(v)
        return d ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '—'
      },
      fmtDate: (v) => {
        const d = asDate(v)
        return d ? d.toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' }) : '—'
      },
    }
  }, [lang, setLang])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
