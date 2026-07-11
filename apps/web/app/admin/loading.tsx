import styles from './admin.module.css'

// Route-level Suspense fallback for the /admin segment — a page-shaped skeleton
// rendered in the main slot inside the persistent AdminShell, so navigating to a
// not-yet-loaded platform route shows instant feedback instead of a blank frame.
export default function AdminLoading() {
  return (
    <div className={styles.routeSkel} aria-hidden="true">
      <div className={styles.skelBlock} style={{ height: 30, width: 'min(280px, 55%)' }} />
      <div className={styles.skelBlock} style={{ height: 14, width: 'min(180px, 38%)', marginTop: 10 }} />
      <div className={styles.routeSkelCards}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={styles.skelBlock} style={{ height: 96 }} />
        ))}
      </div>
      <div className={styles.skelBlock} style={{ height: 220, marginTop: 20 }} />
    </div>
  )
}
