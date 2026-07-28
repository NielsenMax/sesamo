import { useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { useEvent } from '@/state/event'
import { Badge, Button, Empty, Notice, Panel, SelectField, Stat, TextAreaField, TextField } from '@/components/ui'
import type { TicketStatus } from '@/lib/types'

type StatusFilter = 'all' | TicketStatus

export function Tickets() {
  const { t } = useI18n()
  const { spreadsheetId } = useParams()
  const { tickets, event, issue, patch, patchMany, busy, selected, setSelected } = useEvent()

  const [count, setCount] = useState('20')
  const [tier, setTier] = useState(event?.tiers[0] ?? 'General')
  const [names, setNames] = useState('')
  const [issuing, setIssuing] = useState(false)
  const [justIssued, setJustIssued] = useState(0)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [tierFilter, setTierFilter] = useState('all')
  const [editing, setEditing] = useState<string | null>(null)

  const tiers = event?.tiers.length ? event.tiers : ['General']

  const counts = useMemo(
    () => ({
      issued: tickets.length,
      admitted: tickets.filter((x) => x.entries.length > 0).length,
      pending: tickets.filter((x) => x.status === 'issued' && x.entries.length === 0).length,
      voided: tickets.filter((x) => x.status === 'voided').length,
    }),
    [tickets],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tickets.filter((ticket) => {
      if (status !== 'all' && ticket.status !== status) return false
      if (tierFilter !== 'all' && ticket.tier !== tierFilter) return false
      if (!q) return true
      return ticket.holder.toLowerCase().includes(q) || ticket.code.toLowerCase().includes(q)
    })
  }, [tickets, query, status, tierFilter])

  const selectedSet = useMemo(() => new Set(selected), [selected])
  const allVisibleSelected = visible.length > 0 && visible.every((x) => selectedSet.has(x.code))

  async function submitIssue(e: FormEvent) {
    e.preventDefault()
    if (issuing) return
    const holders = names
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const n = holders.length || Math.max(0, Math.min(500, Number(count) || 0))
    if (!n) return
    setIssuing(true)
    setJustIssued(0)
    try {
      const made = await issue({ count: n, tier, holders })
      setJustIssued(made)
      setNames('')
    } catch {
      /* the error surfaces through the shell's notice */
    } finally {
      setIssuing(false)
    }
  }

  function toggle(code: string) {
    setSelected(selectedSet.has(code) ? selected.filter((c) => c !== code) : [...selected, code])
  }

  return (
    <>
      <Panel eyebrow={t.event.summary} tight>
        <div className="stats">
          <Stat label={t.event.issued} value={counts.issued} />
          <Stat label={t.event.admitted} value={counts.admitted} tone="go" />
          <Stat label={t.event.pending} value={counts.pending} />
          {counts.voided > 0 && <Stat label={t.event.voided} value={counts.voided} tone="stamp" />}
        </div>
      </Panel>

      <Panel eyebrow={t.tickets.issue} title={t.tickets.issue}>
        <form className="form issue" onSubmit={submitIssue}>
          <div className="issue__grid">
            <TextField
              label={t.tickets.issueCount}
              type="number"
              min={1}
              max={500}
              value={count}
              disabled={names.trim().length > 0}
              onChange={(e) => setCount(e.target.value)}
            />
            <SelectField label={t.tickets.issueTier} value={tier} onChange={(e) => setTier(e.target.value)}>
              {tiers.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </SelectField>
          </div>
          <TextAreaField
            label={`${t.tickets.issueNames} (${t.common.optional})`}
            hint={t.tickets.issueNamesHint}
            placeholder={t.tickets.issueNamesPlaceholder}
            value={names}
            onChange={(e) => setNames(e.target.value)}
          />
          <div className="row">
            <Button type="submit" variant="primary" loading={issuing}>
              {issuing ? t.tickets.issuing : t.tickets.issueSubmit}
            </Button>
            {justIssued > 0 && (
              <span className="issue__done">
                {t.tickets.issued(justIssued)} ·{' '}
                <Link to={`/e/${spreadsheetId}/design`}>{t.design.downloadPdf}</Link>
              </span>
            )}
          </div>
        </form>
      </Panel>

      <Panel
        title={t.tickets.title}
        actions={
          selected.length > 0 ? (
            <>
              <span className="muted">{t.tickets.selected(selected.length)}</span>
              <Button size="sm" onClick={() => void patchMany(selected, { status: 'voided' })} disabled={busy !== 'idle'}>
                {t.tickets.void}
              </Button>
              <Button size="sm" onClick={() => void patchMany(selected, { status: 'issued' })} disabled={busy !== 'idle'}>
                {t.tickets.unvoid}
              </Button>
              <Link className="btn btn--accent btn--sm" to={`/e/${spreadsheetId}/design`}>
                {t.tickets.download}
              </Link>
              <Button size="sm" variant="quiet" onClick={() => setSelected([])}>
                {t.tickets.clearSelection}
              </Button>
            </>
          ) : null
        }
      >
        <div className="filters">
          <input
            className="input"
            type="search"
            placeholder={t.tickets.searchPlaceholder}
            value={query}
            aria-label={t.common.search}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="select">
            <select aria-label={t.tickets.status} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              <option value="all">{t.tickets.filterAll}</option>
              <option value="issued">{t.status.issued}</option>
              <option value="admitted">{t.status.admitted}</option>
              <option value="voided">{t.status.voided}</option>
            </select>
          </div>
          {tiers.length > 1 && (
            <div className="select">
              <select aria-label={t.tickets.tier} value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
                <option value="all">{t.common.all}</option>
                {tiers.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {tickets.length === 0 ? (
          <Empty title={t.tickets.empty} body={t.tickets.emptyCta} />
        ) : visible.length === 0 ? (
          <Notice>{t.design.nothingToPrint}</Notice>
        ) : (
          <>
            <div className="tickets__head">
              <label className="check">
                <input
                  type="checkbox"
                  aria-label={t.tickets.selectAll}
                  checked={allVisibleSelected}
                  onChange={() =>
                    setSelected(allVisibleSelected ? [] : Array.from(new Set([...selected, ...visible.map((x) => x.code)])))
                  }
                />
              </label>
              <span className="eyebrow tickets__headcode">{t.tickets.code}</span>
              <span className="eyebrow">{t.tickets.holder}</span>
              <span className="eyebrow">{t.tickets.status}</span>
            </div>

            <ul className="tickets">
              {visible.map((ticket) => (
                <li key={ticket.code} className={`tickets__row${selectedSet.has(ticket.code) ? ' is-selected' : ''}`}>
                  <label className="check">
                    <input type="checkbox" checked={selectedSet.has(ticket.code)} onChange={() => toggle(ticket.code)} />
                    <span className="sr-only">{ticket.code}</span>
                  </label>

                  <span className="tickets__code mono">{ticket.code}</span>

                  {editing === ticket.code ? (
                    <input
                      className="input input--inline"
                      autoFocus
                      defaultValue={ticket.holder}
                      aria-label={t.tickets.assignTo}
                      onBlur={(e) => {
                        setEditing(null)
                        if (e.target.value.trim() !== ticket.holder) void patch(ticket.code, { holder: e.target.value.trim() })
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                        if (e.key === 'Escape') setEditing(null)
                      }}
                    />
                  ) : (
                    <button type="button" className="tickets__holder" onClick={() => setEditing(ticket.code)}>
                      {ticket.holder || <span className="muted">{t.tickets.unassigned}</span>}
                    </button>
                  )}

                  <span className="tickets__tags">
                    {ticket.tier && <Badge>{ticket.tier}</Badge>}
                    {ticket.status === 'voided' ? (
                      <Badge tone="stamp">{t.status.voided}</Badge>
                    ) : ticket.entries.length > 0 ? (
                      // Everyone came in on the same night: the date is noise.
                      <Badge tone="go">{ticket.entries[0].slice(11) || ticket.entries[0]}</Badge>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </>
  )
}
