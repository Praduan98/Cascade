import styles from './loading.module.css'

// Route-level Suspense fallback for the (app) segment. It renders in the content
// slot inside the persistent Topbar + Sidebar shell, so navigating to a route
// whose code/data isn't ready yet shows an instant, on-brand skeleton instead of
// a blank frame (no CLS — the header + cards approximate a typical page).
export default function AppLoading() {
  return (
    <div className={styles.wrap} aria-hidden="true">
      <div className={styles.header}>
        <div className={`${styles.sk} ${styles.title}`} />
        <div className={`${styles.sk} ${styles.sub}`} />
      </div>
      <div className={styles.cards}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`${styles.sk} ${styles.card}`} />
        ))}
      </div>
    </div>
  )
}
