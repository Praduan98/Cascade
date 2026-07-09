import Link from 'next/link'
import styles from '../app-shell.module.css'

// Persistent reminder shown while the acting user's email is unverified. (The
// seeded viewer, Sam Okoye, is unverified — switch to them to see this.)
export function VerifyBanner({ email }: { email: string }) {
  return (
    <div className={styles.banner} role="status">
      <span className={styles.bannerIcon} aria-hidden="true">
        !
      </span>
      <span className={styles.bannerText}>
        Verify your email — a confirmation link was sent to <strong>{email}</strong>.
      </span>
      <Link href="/verify" className={styles.bannerAction}>
        Verify now
      </Link>
    </div>
  )
}
