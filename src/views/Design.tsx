import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/i18n'
import { useEvent } from '@/state/event'
import { Button, Notice, Panel, SelectField, Segmented } from '@/components/ui'
import { getPref, setPref } from '@/lib/db'
import { qrPayload } from '@/lib/codes'
import { buildPdf, buildQrZip, buildTicketPdfZip, download, slug, type Paper } from '@/lib/export'
import {
  DEFAULT_DESIGN,
  PRESET_SIZE,
  defaultCustomFields,
  inkForImage,
  renderTicket,
  ticketSize,
  toSvg,
  type CustomFieldId,
  type PresetId,
  type TicketDesign,
} from '@/lib/ticket-render'
import type { Ticket } from '@/lib/types'

type Scope = 'all' | 'selected' | 'unprinted'

const SAMPLE: Ticket = {
  serial: 42,
  code: 'XXXX-0042',
  holder: 'Ana Pérez',
  tier: 'General',
  status: 'issued',
  firstEntry: '',
  entries: [],
  issuedAt: '',
  row: 0,
}

export function Design() {
  const { t, lang } = useI18n()
  const { event, tickets, selected, printed, markPrinted } = useEvent()

  const [design, setDesign] = useState<TicketDesign>(DEFAULT_DESIGN)
  const [paper, setPaper] = useState<Paper>('a4')
  const [scope, setScope] = useState<Scope>('all')
  const [svg, setSvg] = useState('')
  const [previewIndex, setPreviewIndex] = useState(0)
  const [working, setWorking] = useState<null | { done: number; total: number }>(null)
  const [error, setError] = useState<string | null>(null)
  const dragging = useRef<CustomFieldId | null>(null)
  const stage = useRef<HTMLDivElement>(null)

  const key = event ? `design:${event.spreadsheetId}` : null

  useEffect(() => {
    if (!key) return
    void getPref<TicketDesign>(key).then((stored) => stored && setDesign({ ...DEFAULT_DESIGN, ...stored }))
  }, [key])

  const update = useCallback(
    (patch: Partial<TicketDesign>) => {
      setDesign((prev) => {
        const next = { ...prev, ...patch }
        if (key) void setPref(key, next)
        return next
      })
    },
    [key],
  )

  const scoped = useMemo(() => {
    const live = tickets.filter((x) => x.status !== 'voided')
    if (scope === 'selected') return live.filter((x) => selected.includes(x.code))
    if (scope === 'unprinted') return live.filter((x) => !printed.includes(x.code))
    return live
  }, [tickets, scope, selected, printed])

  // The previewed ticket is also the one "download this one" produces, so it
  // has to be pickable rather than always the first in the list.
  const previewTicket = scoped[Math.min(previewIndex, scoped.length - 1)] ?? tickets[0] ?? SAMPLE
  const size = ticketSize(design)

  /* The preview is drawn from the same primitives as the PDF, so what is on
     screen is what comes out of the printer — fonts included. */
  useEffect(() => {
    if (!event) return
    let cancelled = false
    void (async () => {
      const payload =
        previewTicket === SAMPLE
          ? 'SES1:XXXX:0042:PREVEW'
          : await qrPayload(event.secret, event.eventCode, previewTicket.serial)
      if (cancelled) return
      const prims = renderTicket({
        ticket: previewTicket,
        event,
        design,
        payload,
        locale: lang === 'es' ? 'es-AR' : 'en-GB',
        labels: { holder: t.tickets.holder, unassigned: t.tickets.unassigned },
      })
      setSvg(toSvg(prims, size.w, size.h))
    })()
    return () => {
      cancelled = true
    }
  }, [event, previewTicket, design, lang, t, size.w, size.h])

  async function onBackground(file: File) {
    const reader = new FileReader()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('read failed'))
      reader.readAsDataURL(file)
    })
    const image = new Image()
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = reject
      image.src = dataUrl
    })
    const widthMm = 90
    update({
      custom: {
        image: dataUrl,
        widthMm,
        heightMm: Math.round((widthMm * image.naturalHeight) / image.naturalWidth),
        // Keep placements when swapping artwork; start legible when it's new.
        fields: design.custom?.fields ?? defaultCustomFields(inkForImage(image)),
      },
    })
  }

  async function onLogo(file: File) {
    const reader = new FileReader()
    reader.onload = () => update({ logo: String(reader.result) })
    reader.readAsDataURL(file)
  }

  function moveField(id: CustomFieldId, clientX: number, clientY: number) {
    const box = stage.current?.getBoundingClientRect()
    if (!box || !design.custom) return
    const x = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
    const y = Math.min(1, Math.max(0, (clientY - box.top) / box.height))
    update({
      custom: {
        ...design.custom,
        fields: design.custom.fields.map((f) => (f.id === id ? { ...f, x, y } : f)),
      },
    })
  }

  async function exportPdf() {
    if (!event || !scoped.length) return
    setError(null)
    setWorking({ done: 0, total: scoped.length })
    try {
      const blob = await buildPdf(event, scoped, design, {
        paper,
        locale: lang === 'es' ? 'es-AR' : 'en-GB',
        labels: { holder: t.tickets.holder, unassigned: t.tickets.unassigned },
        onProgress: (done, total) => setWorking({ done, total }),
      })
      download(blob, `${slug(event.name)}-entradas.pdf`)
      await markPrinted(scoped.map((x) => x.code))
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.generic)
    } finally {
      setWorking(null)
    }
  }

  function labels() {
    return { holder: t.tickets.holder, unassigned: t.tickets.unassigned }
  }

  /** One file for one guest, on a page trimmed to the ticket. */
  async function exportOne() {
    if (!event || previewTicket === SAMPLE) return
    setError(null)
    setWorking({ done: 0, total: 1 })
    try {
      const blob = await buildPdf(event, [previewTicket], design, {
        paper: 'fit',
        locale: lang === 'es' ? 'es-AR' : 'en-GB',
        labels: labels(),
      })
      download(blob, `${slug(event.name)}-${previewTicket.code}.pdf`)
      await markPrinted([previewTicket.code])
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.generic)
    } finally {
      setWorking(null)
    }
  }

  /** A ZIP holding one PDF per ticket — one ticket per page, ready to send out. */
  async function exportEach() {
    if (!event || !scoped.length) return
    setError(null)
    setWorking({ done: 0, total: scoped.length })
    try {
      const blob = await buildTicketPdfZip(event, scoped, design, {
        // Always trimmed to the ticket: a file meant for one guest shouldn't be
        // a mostly-empty A4 regardless of what the sheet layout is set to.
        paper: 'fit',
        locale: lang === 'es' ? 'es-AR' : 'en-GB',
        labels: labels(),
        onProgress: (done, total) => setWorking({ done, total }),
      })
      download(blob, `${slug(event.name)}-entradas-pdf.zip`)
      await markPrinted(scoped.map((x) => x.code))
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.generic)
    } finally {
      setWorking(null)
    }
  }

  async function exportZip() {
    if (!event || !scoped.length) return
    setError(null)
    setWorking({ done: 0, total: scoped.length })
    try {
      const blob = await buildQrZip(event, scoped, (done, total) => setWorking({ done, total }))
      download(blob, `${slug(event.name)}-qr.zip`)
      await markPrinted(scoped.map((x) => x.code))
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.generic)
    } finally {
      setWorking(null)
    }
  }

  if (!event) return null

  const presets: { value: PresetId; label: string; hint: string }[] = [
    { value: 'stub', label: t.design.presets.stub, hint: t.design.presets.stubHint },
    { value: 'card', label: t.design.presets.card, hint: t.design.presets.cardHint },
    { value: 'badge', label: t.design.presets.badge, hint: t.design.presets.badgeHint },
    { value: 'bare', label: t.design.presets.bare, hint: t.design.presets.bareHint },
  ]
  const activePreset = presets.find((p) => p.value === design.preset)

  return (
    <>
      <Panel eyebrow={t.design.lead} title={t.design.title}>
        <div className="design">
          <div className="design__controls">
            {!design.custom && (
              <>
                <fieldset className="chooser">
                  <legend className="eyebrow">{t.design.preset}</legend>
                  <div className="chooser__grid">
                    {presets.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        className="chooser__item"
                        aria-pressed={design.preset === preset.value}
                        onClick={() => update({ preset: preset.value })}
                      >
                        <span className="chooser__name">{preset.label}</span>
                        <span className="chooser__dims mono">
                          {PRESET_SIZE[preset.value].w}×{PRESET_SIZE[preset.value].h} mm
                        </span>
                      </button>
                    ))}
                  </div>
                  {activePreset && <p className="field__hint">{activePreset.hint}</p>}
                </fieldset>

                <div className="grid-2">
                  <div className="field">
                    <label className="field__label eyebrow" htmlFor="accent">
                      {t.design.accent}
                    </label>
                    <input
                      id="accent"
                      type="color"
                      className="colorwell"
                      value={design.accent}
                      onChange={(e) => update({ accent: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <span className="field__label eyebrow">{t.design.logo}</span>
                    <label className="filebtn">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml"
                        onChange={(e) => e.target.files?.[0] && void onLogo(e.target.files[0])}
                      />
                      <span>{design.logo ? t.design.logoReplace : t.design.logoUpload}</span>
                    </label>
                    <p className="field__hint">{t.design.logoHint}</p>
                    {design.logo && (
                      <Button size="sm" variant="quiet" onClick={() => update({ logo: null })}>
                        {t.common.delete}
                      </Button>
                    )}
                  </div>
                </div>
              </>
            )}

            <fieldset className="chooser">
              <legend className="eyebrow">{t.design.custom}</legend>
              <p className="field__hint">{t.design.customHint}</p>
              <div className="row">
                <label className="filebtn">
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) => e.target.files?.[0] && void onBackground(e.target.files[0])}
                  />
                  <span>{design.custom ? t.design.customReplace : t.design.customUpload}</span>
                </label>
                {design.custom && (
                  <Button size="sm" variant="quiet" onClick={() => update({ custom: null })}>
                    {t.common.delete}
                  </Button>
                )}
              </div>

              {design.custom && (
                <>
                  <p className="field__hint">{t.design.customDragHint}</p>
                  <ul className="layers">
                    {design.custom.fields.map((field) => (
                      <li key={field.id} className="layers__row">
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={field.visible}
                            onChange={() =>
                              update({
                                custom: {
                                  ...design.custom!,
                                  fields: design.custom!.fields.map((f) =>
                                    f.id === field.id ? { ...f, visible: !f.visible } : f,
                                  ),
                                },
                              })
                            }
                          />
                          <span>{t.design.layer[field.id]}</span>
                        </label>
                        <input
                          type="range"
                          min={0.02}
                          max={field.id === 'qr' ? 0.6 : 0.16}
                          step={0.005}
                          value={field.size}
                          aria-label={`${t.design.layer[field.id]} — ${t.design.size}`}
                          onChange={(e) =>
                            update({
                              custom: {
                                ...design.custom!,
                                fields: design.custom!.fields.map((f) =>
                                  f.id === field.id ? { ...f, size: Number(e.target.value) } : f,
                                ),
                              },
                            })
                          }
                        />
                        {/* The QR gets no colour control: it always prints black
                            on its own white plate so it actually scans. */}
                        {field.id === 'qr' ? (
                          <span aria-hidden="true" />
                        ) : (
                          <input
                            type="color"
                            className="colorwell colorwell--sm"
                            value={field.color}
                            aria-label={`${t.design.layer[field.id]} — ${t.design.accent}`}
                            onChange={(e) =>
                              update({
                                custom: {
                                  ...design.custom!,
                                  fields: design.custom!.fields.map((f) =>
                                    f.id === field.id ? { ...f, color: e.target.value } : f,
                                  ),
                                },
                              })
                            }
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </fieldset>

            <div className="grid-2">
              <SelectField label={t.design.paper} value={paper} onChange={(e) => setPaper(e.target.value as Paper)}>
                <option value="a4">A4</option>
                <option value="letter">Letter</option>
                <option value="fit">{t.design.paperFit}</option>
              </SelectField>
              <div className="field">
                <span className="field__label eyebrow">{t.design.scope}</span>
                <Segmented
                  label={t.design.scope}
                  value={scope}
                  onChange={setScope}
                  options={[
                    { value: 'all', label: t.design.scopeAll },
                    { value: 'selected', label: t.design.scopeSelected },
                    { value: 'unprinted', label: t.design.scopeUnprinted },
                  ]}
                />
              </div>
            </div>

            {scoped.length === 0 ? (
              <Notice tone="warn">{t.design.nothingToPrint}</Notice>
            ) : (
              <p className="muted mono">{t.design.willPrint(scoped.length)}</p>
            )}
            {error && <Notice tone="error">{error}</Notice>}

            <div className="row">
              <Button
                variant="primary"
                size="lg"
                loading={Boolean(working)}
                disabled={!scoped.length || Boolean(working)}
                onClick={() => void exportPdf()}
              >
                {working ? `${t.design.building} ${working.done}/${working.total}` : t.design.downloadPdf}
              </Button>
              <Button disabled={!scoped.length || Boolean(working)} onClick={() => void exportEach()}>
                {t.design.downloadEach}
              </Button>
              <Button disabled={!scoped.length || Boolean(working)} onClick={() => void exportZip()}>
                {t.design.downloadPng}
              </Button>
            </div>
          </div>

          <div className="design__preview">
            <div className="row row--between">
              <p className="eyebrow">{t.design.previewOf(previewTicket.serial)}</p>
              {scoped.length > 1 && (
                <div className="select select--slim">
                  <select
                    aria-label={t.design.which}
                    value={Math.min(previewIndex, scoped.length - 1)}
                    onChange={(e) => setPreviewIndex(Number(e.target.value))}
                  >
                    {scoped.map((ticket, i) => (
                      <option key={ticket.code} value={i}>
                        {ticket.code}
                        {ticket.holder ? ` · ${ticket.holder}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="stage__wrap">
              <div
                className="stage"
                ref={stage}
                style={{ aspectRatio: `${size.w} / ${size.h}` }}
                onPointerMove={(e) => dragging.current && moveField(dragging.current, e.clientX, e.clientY)}
                onPointerUp={() => (dragging.current = null)}
                onPointerLeave={() => (dragging.current = null)}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
              {design.custom && (
                <div className="stage__handles">
                  {design.custom.fields
                  .filter((f) => f.visible)
                  .map((field) => (
                    <button
                      key={field.id}
                      type="button"
                      className="handle"
                      style={{ left: `${field.x * 100}%`, top: `${field.y * 100}%` }}
                      onPointerDown={(e) => {
                        dragging.current = field.id
                        e.currentTarget.setPointerCapture(e.pointerId)
                      }}
                      onPointerMove={(e) => dragging.current === field.id && moveField(field.id, e.clientX, e.clientY)}
                      onPointerUp={() => (dragging.current = null)}
                      onKeyDown={(e) => {
                        const step = e.shiftKey ? 0.05 : 0.01
                        const delta =
                          e.key === 'ArrowLeft'
                            ? [-step, 0]
                            : e.key === 'ArrowRight'
                              ? [step, 0]
                              : e.key === 'ArrowUp'
                                ? [0, -step]
                                : e.key === 'ArrowDown'
                                  ? [0, step]
                                  : null
                        if (!delta || !design.custom) return
                        e.preventDefault()
                        update({
                          custom: {
                            ...design.custom,
                            fields: design.custom.fields.map((f) =>
                              f.id === field.id
                                ? {
                                    ...f,
                                    x: Math.min(1, Math.max(0, f.x + delta[0])),
                                    y: Math.min(1, Math.max(0, f.y + delta[1])),
                                  }
                                : f,
                            ),
                          },
                        })
                      }}
                    >
                        <span className="sr-only">{t.design.layer[field.id]}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
            <div className="row row--between">
              <Button
                size="sm"
                disabled={previewTicket === SAMPLE || Boolean(working)}
                onClick={() => void exportOne()}
              >
                {t.design.downloadOne}
              </Button>
              <p className="stage__dims mono">
                {size.w} × {size.h} mm
              </p>
            </div>
          </div>
        </div>
      </Panel>
    </>
  )
}
