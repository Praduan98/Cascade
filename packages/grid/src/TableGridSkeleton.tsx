import styles from './TableGridSkeleton.module.css'

// Shown while the (code-split) Glide grid bundle loads — a header strip plus
// shimmer rows so the grid area gives instant, on-brand feedback instead of a
// blank box. Purely presentational; the global reduced-motion reset freezes the
// shimmer.
export function TableGridSkeleton() {
  return (
    <div className={styles.wrap} aria-hidden="true">
      <div className={styles.header}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={styles.hcell} />
        ))}
      </div>
      <div className={styles.body}>
        {Array.from({ length: 12 }).map((_, r) => (
          <div key={r} className={styles.row}>
            {Array.from({ length: 6 }).map((_, c) => (
              <div key={c} className={styles.cell} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
