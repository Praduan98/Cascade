import styles from './credits.module.css'

const nf = new Intl.NumberFormat('en-US')

export interface MeterSegment {
  label: string
  value: number
  /** Segment colour (token var, e.g. 'var(--brand)'). */
  color: string
}

export interface CreditMeterProps {
  balance: number
  used: number
  total: number
  /** e.g. "renews Aug 1". */
  renewsLabel?: string
  /** Pre-formatted money, e.g. "$180" — Admin only; omit to hide. */
  estCharge?: string
  segments: MeterSegment[]
  /** Show the "Remaining" swatch in the legend (default true). */
  showRemaining?: boolean
}

export function MeterBar({ segments, total }: { segments: MeterSegment[]; total: number }) {
  const safeTotal = total > 0 ? total : 1
  return (
    <div className={styles.meterBar} role="img" aria-label="Credit consumption by category">
      {segments.map((s) => (
        <i key={s.label} style={{ width: `${Math.min(100, (s.value / safeTotal) * 100)}%`, background: s.color }} />
      ))}
    </div>
  )
}

export function MeterLegend({ segments, remaining }: { segments: MeterSegment[]; remaining?: number }) {
  return (
    <div className={styles.meterLegend}>
      {segments.map((s) => (
        <span key={s.label}>
          <span className={styles.k} style={{ background: s.color }} />
          {s.label} · {nf.format(s.value)}
        </span>
      ))}
      {remaining != null ? (
        <span>
          <span className={styles.k} style={{ background: 'var(--surface-3)' }} />
          Remaining · {nf.format(remaining)}
        </span>
      ) : null}
    </div>
  )
}

export function CreditMeter({ balance, used, total, renewsLabel, estCharge, segments, showRemaining = true }: CreditMeterProps) {
  const remaining = Math.max(0, total - used)
  return (
    <div className={styles.meterCard}>
      <div className={styles.meterTop}>
        <div>
          <div className={styles.label}>Balance</div>
          <div className={styles.bal}>
            {nf.format(balance)} <small>cr</small>
          </div>
        </div>
        <div className={styles.rightMeta}>
          <div className={styles.usedLine}>
            {nf.format(used)} / {nf.format(total)} used
          </div>
          {renewsLabel || estCharge ? (
            <div className={styles.renewsLine}>
              {renewsLabel}
              {renewsLabel && estCharge ? ' · ' : ''}
              {estCharge ? (
                <>
                  est. next charge <b className={styles.money}>{estCharge}</b>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <MeterBar segments={segments} total={total} />
      <MeterLegend segments={segments} remaining={showRemaining ? remaining : undefined} />
    </div>
  )
}
