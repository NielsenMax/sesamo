import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { useAuth } from '@/state/auth'
import { TopBar, useMode } from '@/components/Chrome'
import { Button, Notice, Panel, SelectField, TextAreaField, TextField } from '@/components/ui'
import { createEventSpreadsheet, initialiseExistingSpreadsheet } from '@/lib/event-sheet'
import { putEvent } from '@/lib/db'
import { toStored } from '@/lib/dates'

export function NewEvent() {
  useMode('day')
  const { t, lang } = useI18n()
  const auth = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  // Set when the user picked a spreadsheet of their own that isn't a Sésamo
  // event yet: we add the tabs to that file instead of creating a new one.
  const existingSheet = params.get('sheet')

  const [name, setName] = useState(params.get('name')?.replace(/ · Sésamo$/, '') ?? '')
  const [date, setDate] = useState('')
  const [venue, setVenue] = useState('')
  const [notes, setNotes] = useState('')
  const [tiers, setTiers] = useState('General')
  const [sheetLang, setSheetLang] = useState<'es' | 'en'>(lang)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    const input = {
      name: name.trim(),
      date: toStored(date),
      venue: venue.trim(),
      notes: notes.trim(),
      tiers: tiers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    }
    try {
      const event = existingSheet
        ? await initialiseExistingSpreadsheet(existingSheet, input, sheetLang)
        : await createEventSpreadsheet(input, sheetLang)
      await putEvent(event)
      navigate(`/e/${event.spreadsheetId}/tickets`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.generic)
      setBusy(false)
    }
  }

  if (!auth.signedIn) {
    return (
      <>
        <TopBar />
        <main className="strip">
          <Panel title={t.event.create}>
            <Notice tone="warn">{t.auth.needed}</Notice>
            <div className="row" style={{ marginTop: 'var(--sp-4)' }}>
              <Button variant="primary" loading={auth.busy} onClick={() => void auth.signIn()}>
                {t.auth.signIn}
              </Button>
            </div>
          </Panel>
        </main>
      </>
    )
  }

  return (
    <>
      <TopBar />
      <main className="strip">
        <Panel eyebrow={existingSheet ? t.landing.notSesamo : t.landing.newEventHint} title={t.event.create}>
          {existingSheet && <Notice tone="warn">{t.landing.notSesamoHelp}</Notice>}
          <form className="form" onSubmit={submit}>
            <TextField
              label={t.event.name}
              placeholder={t.event.namePlaceholder}
              value={name}
              required
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
            <div className="grid-2">
              <TextField label={t.event.date} type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
              <TextField
                label={t.event.venue}
                placeholder={t.event.venuePlaceholder}
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
              />
            </div>
            <TextField
              label={t.event.tiers}
              hint={t.event.tiersHint}
              placeholder={t.event.tiersPlaceholder}
              value={tiers}
              onChange={(e) => setTiers(e.target.value)}
            />
            <TextAreaField label={`${t.event.notes} (${t.common.optional})`} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <SelectField
              label={t.lang.switch}
              hint={lang === 'es' ? 'Idioma de los títulos dentro de la planilla.' : 'Language of the headings inside the spreadsheet.'}
              value={sheetLang}
              onChange={(e) => setSheetLang(e.target.value as 'es' | 'en')}
            >
              <option value="es">{t.lang.es}</option>
              <option value="en">{t.lang.en}</option>
            </SelectField>

            {error && <Notice tone="error">{error}</Notice>}

            <div className="row">
              <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!name.trim()}>
                {busy ? t.common.creating : existingSheet ? t.landing.prepare : t.event.createIt}
              </Button>
              <Button variant="quiet" onClick={() => navigate('/')}>
                {t.common.cancel}
              </Button>
            </div>
          </form>
        </Panel>
      </main>
    </>
  )
}
