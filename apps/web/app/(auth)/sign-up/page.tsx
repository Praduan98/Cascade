'use client'
import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getApi, PLANS } from '@cascade/data'
import { Alert, Button, Card, Field, Input, Select, useToast } from '@cascade/ui'
import { useSession } from '../../session'
import { errorMessage } from '../../lib/ui'
import styles from '../auth.module.css'

export default function SignUpPage() {
  const router = useRouter()
  const { status, refresh } = useSession()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [password, setPassword] = useState('')
  const [planId, setPlanId] = useState('plan_free')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'authenticated') router.replace('/welcome')
  }, [status, router])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await getApi().auth.signUp({
        email: email.trim(),
        name: name.trim() || undefined,
        workspaceName: workspaceName.trim() || undefined,
        password: password || undefined,
        planId,
      })
      await refresh()
      toast('Workspace created — welcome to Cascade', { variant: 'success' })
      router.replace('/welcome')
    } catch (err) {
      // The mock API returns a deliberately non-enumerating message for a
      // duplicate email ("Could not create an account with those details").
      setError(errorMessage(err, 'Could not create an account with those details'))
      setBusy(false)
    }
  }

  return (
    <>
      <Card className={styles.card}>
        <div className={styles.head}>
          <h1>Create your workspace</h1>
          <p>Spin up a fresh Cascade workspace in seconds.</p>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <form className={styles.form} onSubmit={onSubmit}>
          <Field label="Your name" htmlFor="name">
            <Input
              id="name"
              autoComplete="name"
              placeholder="Ada Lovelace"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Work email" htmlFor="email" type="Email">
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
          <Field label="Workspace name" htmlFor="workspace" hint="Leave blank to use a default.">
            <Input
              id="workspace"
              placeholder="Acme GTM"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
            />
          </Field>
          <Field label="Password" htmlFor="password" hint="Any password works in this mock.">
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Plan" htmlFor="plan" hint="Start free — change anytime in Billing.">
            <Select id="plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {PLANS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.priceUsdMonthly === 0 ? 'Free' : `$${p.priceUsdMonthly}/mo`} · {p.includedCredits.toLocaleString('en-US')} credits
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="primary" size="lg" className={styles.submit} disabled={busy}>
            {busy ? 'Creating…' : 'Create workspace'}
          </Button>
        </form>
      </Card>

      <div className={styles.altLinks}>
        <span>Already have an account? <Link href="/sign-in">Sign in</Link></span>
      </div>
    </>
  )
}
