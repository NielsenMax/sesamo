import { useMemo, useState } from 'react'
import { useI18n } from '@/i18n'
import { useEvent } from '@/state/event'
import { Badge, Empty, Panel, Segmented } from '@/components/ui'
import { isGood } from '@/lib/verdict'
import type { ScanResult } from '@/lib/types'

const TONE: Record<ScanResult, 'go' | 'stamp' | 'amber' | 'neutral'> = {
  granted: 'go',
  override: 'amber',
  repeat: 'amber',
  voided: 'stamp',
  invalid: 'stamp',
  otherEvent: 'stamp',
  unknown: 'amber',
}

export function Log() {
  const { t, fmtDateTime } = useI18n()
  const { scans } = useEvent()
  const [filter, setFilter] = useState<'all' | 'in' | 'turned'>('all')

  const visible = useMemo(
    () =>
      scans.filter((scan) =>
        filter === 'all' ? true : filter === 'in' ? isGood(scan.result) : !isGood(scan.result),
      ),
    [scans, filter],
  )

  return (
    <Panel
      eyebrow={t.log.lead}
      title={t.log.title}
      actions={
        <Segmented
          label={t.log.result}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t.common.all },
            { value: 'in', label: t.log.filterIn },
            { value: 'turned', label: t.log.filterTurned },
          ]}
        />
      }
    >
      {visible.length === 0 ? (
        <Empty title={t.log.empty} />
      ) : (
        <ul className="log">
          {visible.map((scan) => (
            <li key={scan.id} className="log__row">
              <span className="log__time mono">{fmtDateTime(scan.at)}</span>
              <span className="log__code mono">{scan.code || scan.raw.slice(0, 18)}</span>
              <span className="log__who">{scan.holder || <span className="muted">{t.tickets.unassigned}</span>}</span>
              <Badge tone={TONE[scan.result]}>{t.scanner.verdict[scan.result]}</Badge>
              <span className="log__device mono muted">{scan.device}</span>
              {!scan.synced && <Badge tone="amber">{t.log.pending}</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
