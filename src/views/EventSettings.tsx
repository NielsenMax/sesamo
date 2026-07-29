import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { useEvent } from '@/state/event'
import { Button, Notice, Panel, TextAreaField, TextField } from '@/components/ui'
import { spreadsheetUrl } from '@/lib/google/sheets'
import { forgetEvent } from '@/lib/db'
import { joinStored, splitStored } from '@/lib/dates'

export function EventSettings() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { event, saveDetails, busy, pending } = useEvent()

  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [venue, setVenue] = useState('')
  const [notes, setNotes] = useState('')
  const [tiers, setTiers] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!event) return
    setName(event.name)
    const split = splitStored(event.date)
    setDate(split.date)
    setTime(split.time)
    setVenue(event.venue)
    setNotes(event.notes)
    setTiers(event.tiers.join(', '))
  }, [event])

  if (!event) return null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaved(false)
    await saveDetails({
      name: name.trim(),
      date: joinStored(date, time),
      venue: venue.trim(),
      notes: notes.trim(),
      tiers: tiers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    })
    setSaved(true)
  }

  return (
    <>
      <Panel eyebrow={t.event.settings} title={t.nav.event}>
        <form className="form" onSubmit={submit}>
          <TextField label={t.event.name} value={name} onChange={(e) => setName(e.target.value)} required />
          <div className="grid-2">
            <TextField label={t.event.date} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <TextField label={t.event.time} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <TextField label={t.event.venue} value={venue} onChange={(e) => setVenue(e.target.value)} />
          <TextField label={t.event.tiers} hint={t.event.tiersHint} value={tiers} onChange={(e) => setTiers(e.target.value)} />
          <TextAreaField label={t.event.notes} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="row">
            <Button type="submit" variant="primary" loading={busy === 'writing'}>
              {busy === 'writing' ? t.common.saving : t.common.save}
            </Button>
            {saved && <span className="muted">{t.common.saved}</span>}
          </div>
        </form>
      </Panel>

      <Panel eyebrow={t.sheet.tabConfig} title={t.common.openInSheets} tight>
        <dl className="keyvals">
          <div>
            <dt className="eyebrow">{t.tickets.code}</dt>
            <dd className="mono">{event.eventCode}</dd>
          </div>
          <div>
            <dt className="eyebrow">Spreadsheet</dt>
            <dd className="mono">
              <a href={spreadsheetUrl(event.spreadsheetId)} target="_blank" rel="noreferrer">
                {event.spreadsheetId.slice(0, 14)}… ↗
              </a>
            </dd>
          </div>
          <div>
            <dt className="eyebrow">{t.sync.lastPull}</dt>
            <dd className="mono">{event.lastPull ?? t.sync.never}</dd>
          </div>
          <div>
            <dt className="eyebrow">{t.sync.lastPush}</dt>
            <dd className="mono">{event.lastPush ?? t.sync.never}</dd>
          </div>
        </dl>
        <Notice>{t.event.danger}</Notice>
      </Panel>

      <Panel tight>
        <div className="row row--between">
          <p className="field__hint">{t.landing.forgetHint}</p>
          <Button
            variant="danger"
            disabled={pending > 0}
            title={pending > 0 ? t.sync.pending(pending) : undefined}
            onClick={async () => {
              await forgetEvent(event.spreadsheetId)
              navigate('/')
            }}
          >
            {t.landing.forget}
          </Button>
        </div>
      </Panel>
    </>
  )
}
