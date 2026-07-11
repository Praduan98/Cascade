'use client'
import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getApi } from '@cascade/data'
import { Alert, Button, Card, Field, Input, useToast } from '@cascade/ui'
import { useSession } from '../../session'
import { DEMO_USERS } from '../../lib/demo-users'
import { errorMessage } from '../../lib/ui'
import styles from '../auth.module.css'

export default function SignInPage() {
  const router = useRouter()
  const { status, refresh, switchUser } = useSession()
  const { toast } = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Already signed in — skip the form.
  useEffect(() => {
    if (status === 'authenticated') router.replace('/home')
  }, [status, router])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await getApi().auth.signIn(email.trim())
      await refresh()
      router.replace('/home')
    } catch (err) {
      const message = errorMessage(err, 'Invalid email or password')
      setError(message)
      setBusy(false)
    }
  }

  async function pickDemo(userId: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await switchUser(userId)
      router.replace('/home')
    } catch (err) {
      toast(errorMessage(err, 'Could not switch account'), { variant: 'error' })
      setBusy(false)
    }
  }

  return (
    <>
      <Card className={styles.card}>
        <div className={styles.head}>
          <h1>Welcome back</h1>
          <p>Sign in to your Cascade workspace.</p>
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
          <Field label="Password" htmlFor="password" hint="Any password works in this mock.">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" size="lg" className={styles.submit} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
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
              disabled={busy}
            >
              <span className={styles.demoRole}>{u.roleLabel}</span>
              <span className={styles.demoName}>{u.name}</span>
              <span className={styles.demoEmail}>{u.email}</span>
            </button>
          ))}
        </div>
      </Card>

      <div className={styles.altLinks}>
        <Link href="/magic-link">Email me a link</Link>
        <span aria-hidden="true">·</span>
        <span>New here? <Link href="/sign-up">Create a workspace</Link></span>
      </div>
    </>
  )
}
