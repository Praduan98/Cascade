'use client'
import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getApi } from '@cascade/data'
import { Alert, Button, Card, Field, Input } from '@cascade/ui'
import { useSession } from '../../session'
import { DEMO_USERS } from '../../lib/demo-users'
import { errorMessage } from '../../lib/ui'
import styles from '../auth.module.css'

// Mock SSO ("Continue with Google/Microsoft") resolves to the primary demo owner.
const OWNER_EMAIL = DEMO_USERS[0]?.email ?? 'aitools@insightstap.com'

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  )
}
function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#F25022" d="M2 2h9.4v9.4H2z" />
      <path fill="#7FBA00" d="M12.6 2H22v9.4h-9.4z" />
      <path fill="#00A4EF" d="M2 12.6h9.4V22H2z" />
      <path fill="#FFB900" d="M12.6 12.6H22V22h-9.4z" />
    </svg>
  )
}
function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  )
}

export default function SignInPage() {
  const router = useRouter()
  const { status, refresh, switchUser } = useSession()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Already signed in — skip the form.
  useEffect(() => {
    if (status === 'authenticated') router.replace('/home')
  }, [status, router])

  // Establish a mock session for the given account and enter the app.
  async function completeSignIn(addr: string, action: string) {
    if (busy) return
    setBusy(action)
    setError(null)
    try {
      await getApi().auth.signIn(addr.trim())
      await refresh()
      router.replace('/home')
    } catch (err) {
      setError(errorMessage(err, 'We couldn’t sign you in with that account.'))
      setBusy(null)
    }
  }

  async function sendMagicLink(e: FormEvent) {
    e.preventDefault()
    if (busy || !email.trim()) return
    setBusy('email')
    setError(null)
    try {
      await getApi().auth.magicLink(email.trim())
      setSent(email.trim())
    } catch (err) {
      setError(errorMessage(err, 'Could not send the link'))
    } finally {
      setBusy(null)
    }
  }

  async function pickDemo(userId: string) {
    if (busy) return
    setBusy(userId)
    setError(null)
    try {
      await switchUser(userId)
      router.replace('/home')
    } catch (err) {
      setError(errorMessage(err, 'Could not switch account'))
      setBusy(null)
    }
  }

  return (
    <>
      <Card className={styles.card}>
        {sent ? (
          <div className={styles.sent}>
            <div className={styles.iconCircle}>
              <MailIcon />
            </div>
            <div className={styles.head}>
              <h1>Check your email</h1>
              <p>
                We sent a magic sign-in link to <b>{sent}</b>.
              </p>
            </div>
            {error && <Alert variant="error">{error}</Alert>}
            <Button
              variant="primary"
              size="lg"
              className={styles.submit}
              onClick={() => completeSignIn(sent, 'link')}
              disabled={!!busy}
            >
              {busy === 'link' ? 'Signing in…' : 'Open the sign-in link'}
            </Button>
            <p className={styles.demoNote}>In this demo the link opens instantly.</p>
            <button
              type="button"
              className={styles.textBtn}
              onClick={() => {
                setSent(null)
                setError(null)
              }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <div className={styles.head}>
              <h1>Sign in to Cascade</h1>
              <p>Use your work account to continue.</p>
            </div>

            {error && <Alert variant="error">{error}</Alert>}

            <div className={styles.sso}>
              <button
                type="button"
                className={styles.ssoBtn}
                onClick={() => completeSignIn(OWNER_EMAIL, 'google')}
                disabled={!!busy}
              >
                <GoogleLogo />
                {busy === 'google' ? 'Signing in…' : 'Continue with Google'}
              </button>
              <button
                type="button"
                className={styles.ssoBtn}
                onClick={() => completeSignIn(OWNER_EMAIL, 'microsoft')}
                disabled={!!busy}
              >
                <MicrosoftLogo />
                {busy === 'microsoft' ? 'Signing in…' : 'Continue with Microsoft'}
              </button>
            </div>

            <div className={styles.divider}>or</div>

            <form className={styles.form} onSubmit={sendMagicLink}>
              <Field label="Work email" htmlFor="email" hint="No password — we’ll email you a magic sign-in link.">
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
              <Button type="submit" variant="secondary" size="lg" className={styles.submit} disabled={!!busy || !email.trim()}>
                {busy === 'email' ? 'Sending…' : 'Email me a magic link'}
              </Button>
            </form>

            <div className={styles.divider}>Demo accounts</div>
            <div className={styles.demoGrid}>
              {DEMO_USERS.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className={styles.demoBtn}
                  onClick={() => pickDemo(u.id)}
                  disabled={!!busy}
                >
                  <span className={styles.demoRole}>{u.roleLabel}</span>
                  <span className={styles.demoName}>{u.name}</span>
                  <span className={styles.demoEmail}>{u.email}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </Card>

      <div className={styles.altLinks}>
        <span>
          New here? <Link href="/sign-up">Create a workspace</Link>
        </span>
      </div>
    </>
  )
}
