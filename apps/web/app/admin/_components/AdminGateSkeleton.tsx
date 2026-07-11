import styles from '../admin.module.css'

// Shown while the platform session resolves — a static skeleton of the AdminShell
// frame (topbar + sidebar rail + content) at the real dimensions, so the swap to
// the real shell is a same-size fade instead of a spinner-on-blank jump.
export function AdminGateSkeleton() {
  return (
    <div className={styles.gate} role="status" aria-label="Loading" aria-busy="true">
      <div className={styles.gateTopbar} />
      <div className={styles.gateBody}>
        <div className={styles.gateRail}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={styles.skelBlock} style={{ height: 30 }} />
          ))}
        </div>
        <div className={styles.gateMain}>
          <div className={styles.skelBlock} style={{ height: 30, width: 'min(280px, 50%)' }} />
          <div className={styles.gateRow}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={styles.skelBlock} style={{ height: 96 }} />
            ))}
          </div>
          <div className={styles.skelBlock} style={{ height: 240 }} />
        </div>
      </div>
    </div>
  )
}
