'use client'
import Link from 'next/link'
import { Alert, Card } from '@cascade/ui'
import styles from '../auth.module.css'

// Mock email-verification landing. A real backend would exchange a `?token=`
// query param here; in Phase 1 this simply confirms the (simulated) flow.
export default function VerifyPage() {
  return (
    <>
      <Card className={styles.card}>
        <div className={styles.iconCircle}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <div className={styles.head}>
          <h1>Email verified</h1>
          <p>Your email address is confirmed. You&rsquo;re all set to use Cascade.</p>
        </div>
        <Alert variant="info" title="This is a mock">
          No real verification token is exchanged in Phase 1 — this screen simulates the confirmation
          step a backend would complete.
        </Alert>
        <Link href="/home" className={`btn btn-primary btn-lg ${styles.submit}`}>
          Continue to your tables
        </Link>
      </Card>

      <div className={styles.altLinks}>
        <Link href="/sign-in">Back to sign in</Link>
      </div>
    </>
  )
}
