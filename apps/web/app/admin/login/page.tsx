'use client'
import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Card, Field, Input } from '@cascade/ui'
import { usePlatformSession } from '../PlatformSession'
import { errorMessage } from '../../lib/ui'
import styles from '../admin.module.css'

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

const DEMO = [
  { email: 'ops@sdtcdigital.com', label: 'Platform Admin' },
  { email: 'support@sdtcdigital.com', label: 'Support' },
]

export default function PlatformLoginPage() {
  const router = useRouter()
  const { signIn } = usePlatformSession()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(value: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await signIn(value.trim())
      router.replace('/admin')
    } catch (err) {
      setError(errorMessage(err, 'Those credentials are not valid platform staff'))
      setBusy(false)
    }
  }

  return (
    <div className={styles.loginWrap}>
      <div className={styles.loginCard}>
        <div className={styles.loginHead}>
          <span className={styles.sideGlyph}><ShieldIcon /></span>
          <div>
            <h1>Platform superadmin</h1>
            <p>Restricted to SDTC staff — separate from any workspace login.</p>
          </div>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <form
          className={styles.loginForm}
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            void submit(email)
          }}
        >
          <Field label="Staff email" htmlFor="pemail" type="Email">
            <Input id="pemail" type="email" autoComplete="email" placeholder="you@sdtcdigital.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Button type="submit" variant="primary" size="lg" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in to platform'}
          </Button>
        </form>

        <div className={styles.demoRow}>
          <span className={styles.demoLabel}>Demo staff accounts</span>
          {DEMO.map((d) => (
            <button key={d.email} type="button" className={styles.demoBtn} onClick={() => void submit(d.email)} disabled={busy}>
              {d.email}
              <span>{d.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
