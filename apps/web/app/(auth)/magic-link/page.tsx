'use client'
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { getApi } from '@cascade/data'
import { Alert, Button, Card, Field, Input } from '@cascade/ui'
import { errorMessage } from '../../lib/ui'
import styles from '../auth.module.css'

export default function MagicLinkPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await getApi().auth.magicLink(email.trim())
      setSent(true)
    } catch (err) {
      setError(errorMessage(err, 'Could not send the link'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card className={styles.card}>
        {sent ? (
          <>
            <div className={styles.iconCircle}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 6h16v12H4z" />
                <path d="m4 7 8 6 8-6" />
              </svg>
            </div>
            <div className={styles.head}>
              <h1>Check your inbox</h1>
              <p>
                If an account exists for <strong>{email || 'that address'}</strong>, we&rsquo;ve sent a
                sign-in link. It expires in 15 minutes.
              </p>
            </div>
            <Alert variant="info" title="This is a mock">
              No email is actually sent. Head to sign-in and pick a demo account to continue.
            </Alert>
            <Button variant="secondary" size="lg" className={styles.submit} onClick={() => setSent(false)}>
              Use a different email
            </Button>
          </>
        ) : (
          <>
            <div className={styles.head}>
              <h1>Email me a link</h1>
              <p>We&rsquo;ll send a one-time sign-in link — no password required.</p>
            </div>

            {error && <Alert variant="error">{error}</Alert>}

            <form className={styles.form} onSubmit={onSubmit}>
              <Field label="Email" htmlFor="email" type="Email">
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </Field>
              <Button type="submit" variant="primary" size="lg" className={styles.submit} disabled={busy}>
                {busy ? 'Sending…' : 'Send link'}
              </Button>
            </form>
          </>
        )}
      </Card>

      <div className={styles.altLinks}>
        <span>Prefer a password? <Link href="/sign-in">Sign in</Link></span>
      </div>
    </>
  )
}
