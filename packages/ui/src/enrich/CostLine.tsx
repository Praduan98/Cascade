import styles from './costline.module.css'

export interface CostLineProps {
  /** Left label; defaults to "Estimated maximum". */
  label?: string
  /** Right amount, e.g. "≤ 2,480 credits". */
  amount: string
  className?: string
}

// The spend-gate line — amber, credits-denominated, shown before any billable run.
export function CostLine({ label = 'Estimated maximum', amount, className = '' }: CostLineProps) {
  return (
    <div className={[styles.costLine, className].filter(Boolean).join(' ')}>
      <span className={styles.lab}>{label}</span>
      <span className={styles.amt}>{amount}</span>
    </div>
  )
}
