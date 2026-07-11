'use client'
// Onboarding (Phase 4, US-4.12) — a short, skippable guided path to first value:
//   1. Welcome + how credits work
//   2. Pick a starting point (a template, or start blank)
//   3. Create the table + learn how to run it, then open it
// Frontend-only on the mock API. The coordinator wires the first-run trigger and
// a "revisit onboarding" entry point elsewhere; this page is self-contained.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { Template } from '@cascade/core'
import { Alert, Button, Card, Tag, useToast } from '@cascade/ui'
import { useSession } from '../../session'
import { errorMessage } from '../../lib/ui'
import { Stepper } from './_components/Stepper'
import { TemplatePicker } from './_components/TemplatePicker'
import styles from './onboarding.module.css'

const nf = new Intl.NumberFormat('en-US')
const STEP_LABELS = ['Welcome', 'Starting point', 'Create & run']

/** Readable ink (near-black or white) for a glyph on a data-driven accent, by
 *  WCAG relative luminance — legible on light *and* dark accents, either theme. */
function onAccentInk(accent: string): string {
  const hex = accent.trim().replace(/^#/, '')
  const full = hex.length === 3 ? hex.replace(/(.)/g, '$1$1') : hex
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return '#ffffff'
  const n = Number.parseInt(full, 16)
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  return L > 0.179 ? '#0b0d12' : '#ffffff'
}

export default function OnboardingPage() {
  const { workspace } = useSession()
  const router = useRouter()
  const qc = useQueryClient()
  const { toast } = useToast()
  const workspaceId = workspace?.id

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Drives the finish button's loading/disabled state across the router.push so
  // there's no dead time between the mutation resolving and the route committing.
  const [isNavigating, startTransition] = useTransition()

  const balanceQuery = useQuery({
    queryKey: ['credits', 'balance', workspaceId],
    queryFn: () => getApi().credits.balance(workspaceId!),
    enabled: !!workspaceId,
  })
  const templatesQuery = useQuery({
    queryKey: ['templates', 'list'],
    queryFn: () => getApi().templates.list(),
  })

  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data])
  const selected: Template | null = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  )

  const instantiate = useMutation({
    mutationFn: (templateId: string) => getApi().templates.instantiate(workspaceId!, templateId),
    // Refresh the persistent Sidebar's table list so the new table appears in nav.
    onSuccess: () => {
      if (workspaceId) void qc.invalidateQueries({ queryKey: ['tables', workspaceId] })
    },
    onError: (e) => toast(errorMessage(e, 'Could not create the table'), { variant: 'error' }),
  })
  const complete = useMutation({
    mutationFn: (tableId: string) => getApi().onboarding.complete(workspaceId!, { tableId }),
    onSuccess: (_r, tableId) => startTransition(() => router.push(`/tables/${tableId}`)),
    onError: (e) => toast(errorMessage(e, 'Could not finish onboarding'), { variant: 'error' }),
  })
  const skip = useMutation({
    mutationFn: () => getApi().onboarding.skip(workspaceId!),
    onSuccess: () => router.push('/tables'),
    onError: (e) => toast(errorMessage(e, 'Could not skip onboarding'), { variant: 'error' }),
  })

  const createdTable = instantiate.data ?? null
  const busy = skip.isPending || complete.isPending

  // Move focus to the active step's heading when the step (or the step-3
  // building→ready/error sub-state) changes, so keyboard + screen-reader users
  // land on the new content instead of being stranded. Skip the initial mount.
  const headingRef = useRef<HTMLHeadingElement>(null)
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    headingRef.current?.focus()
  }, [step, instantiate.isError, instantiate.isPending, createdTable])

  function goCreate() {
    if (!selectedId || !workspaceId) return
    instantiate.mutate(selectedId)
    setStep(3)
  }

  if (!workspace) {
    return (
      <div className={styles.page}>
        <Alert variant="info" title="No workspace">
          You&rsquo;re not a member of any workspace yet.
        </Alert>
      </div>
    )
  }

  const SkipButton = (
    <button type="button" className={styles.skip} disabled={busy} onClick={() => skip.mutate()}>
      Skip for now
    </button>
  )

  return (
    <div className={styles.page}>
      <Stepper steps={STEP_LABELS} current={step} />

      {/* ---- Step 1: Welcome ---- */}
      {step === 1 && (
        <Card key={step} className={[styles.card, styles.stepBody].join(' ')}>
          <span className={styles.kicker}>Welcome to {workspace.name}</span>
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
            Turn a list into enriched, ready-to-work data
          </h1>
          <p className={styles.lede}>
            Cascade is your GTM data workspace. Build a table of companies or people, then fill it with a
            few clicks — chain providers in a <b>waterfall</b>, ask an <b>AI</b> column to classify or write,
            or send a research <b>agent</b> to the web. Results stream into each cell live.
          </p>

          <div className={styles.explainer}>
            <span className={styles.explainHead}>How credits work</span>
            <ul className={styles.exList}>
              <li className={styles.exRow}>
                <span className={[styles.exMark, styles.exSpend].join(' ')} />
                <span>
                  Running a <b>waterfall, AI or agent</b> column spends credits — usually just a few per row.
                </span>
              </li>
              <li className={styles.exRow}>
                <span className={[styles.exMark, styles.exFree].join(' ')} />
                <span>
                  <b>Cached rows are free.</b> Re-running a row that&rsquo;s already been enriched reuses the
                  stored result at no cost.
                </span>
              </li>
              <li className={styles.exRow}>
                <span className={[styles.exMark, styles.exSkip].join(' ')} />
                <span>
                  <b>Missing-input rows are free.</b> Rows without the data a provider needs are skipped and
                  never billed.
                </span>
              </li>
            </ul>
            <Link href="/usage" className={styles.link}>
              See usage &amp; budgets →
            </Link>
          </div>

          {balanceQuery.data && (
            <p className={styles.balanceLine}>
              You have {nf.format(balanceQuery.data.balance)} credits ready to spend.
            </p>
          )}

          <div className={styles.actions}>
            {SkipButton}
            <div className={styles.actionsRight}>
              <Button variant="primary" onClick={() => setStep(2)}>
                Get started
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* ---- Step 2: Pick a starting point ---- */}
      {step === 2 && (
        <Card key={step} className={[styles.card, styles.stepBody].join(' ')}>
          <span className={styles.kicker}>Step 2 of 3</span>
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
            Pick a starting point
          </h1>
          <p className={styles.lede}>
            Each template creates a table with its columns already configured — ready to run. Pick the one
            closest to your goal, or start from a blank companies table.
          </p>

          {templatesQuery.isError ? (
            <Alert variant="error" title="Couldn’t load templates">
              {errorMessage(templatesQuery.error)}
            </Alert>
          ) : templatesQuery.isLoading ? (
            <div className={styles.grid}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className={styles.skelBlock} style={{ height: 132, borderRadius: 12 }} />
              ))}
            </div>
          ) : (
            <TemplatePicker templates={templates} selectedId={selectedId} onSelect={setSelectedId} />
          )}

          <div className={styles.actions}>
            {SkipButton}
            <div className={styles.actionsRight}>
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button variant="primary" disabled={!selectedId} onClick={goCreate}>
                Continue
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* ---- Step 3: Create + run ---- */}
      {step === 3 && (
        <Card key={step} className={[styles.card, styles.stepBody].join(' ')}>
          <span className={styles.kicker}>Step 3 of 3</span>

          {instantiate.isError ? (
            <>
              <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
                We couldn’t build your table
              </h1>
              <Alert variant="error" title="Table creation failed">
                {errorMessage(instantiate.error)}
              </Alert>
              <div className={styles.actions}>
                {SkipButton}
                <div className={styles.actionsRight}>
                  <Button variant="ghost" onClick={() => setStep(2)}>
                    Back
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!selectedId || instantiate.isPending}
                    onClick={() => selectedId && instantiate.mutate(selectedId)}
                  >
                    {instantiate.isPending ? 'Retrying…' : 'Try again'}
                  </Button>
                </div>
              </div>
            </>
          ) : instantiate.isPending || !createdTable ? (
            <>
              <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
                Building your table…
              </h1>
              <p className={styles.lede}>Setting up columns and sample rows.</p>
              <div className={styles.skelBlock} style={{ height: 76, borderRadius: 12 }} />
              <div className={styles.skelBlock} style={{ height: 14, width: '70%', marginTop: 4 }} />
              <div className={styles.skelBlock} style={{ height: 14, width: '55%' }} />
            </>
          ) : (
            <>
              <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
                Your table is ready
              </h1>

              <div className={styles.created}>
                <span
                  className={styles.createdGlyph}
                  style={{
                    background: selected?.accent ?? 'var(--brand)',
                    color: selected?.accent ? onAccentInk(selected.accent) : '#ffffff',
                  }}
                  aria-hidden="true"
                >
                  {selected?.glyph ?? '＋'}
                </span>
                <div className={styles.createdMain}>
                  <div className={styles.createdKicker}>New table</div>
                  <div className={styles.createdName}>{createdTable.name}</div>
                </div>
                {selected && selected.creditsPerRow > 0 && (
                  <Tag mono tone="gold">
                    ≈ {selected.creditsPerRow} cr / row
                  </Tag>
                )}
              </div>

              <p className={styles.lede}>Here&rsquo;s how to fill it in and spend your first credits:</p>
              <ol className={styles.runList}>
                {(selected && selected.creditsPerRow > 0
                  ? [
                      <>
                        Open the table — the sample rows and <b>configured columns</b> are already in place.
                      </>,
                      <>
                        Select the rows you want, then pick a <b>waterfall, AI or agent</b> column to run.
                      </>,
                      <>
                        Confirm the credit estimate — cells fill <b>live</b> as each provider responds, and
                        cached rows cost nothing.
                      </>,
                    ]
                  : [
                      <>Open the table — a few sample rows are ready for you.</>,
                      <>
                        Add an <b>enrichment, AI or agent</b> column to pull in the data you need.
                      </>,
                      <>Run it and confirm the estimate — you&rsquo;re only billed for billable rows.</>,
                    ]
                ).map((node, i) => (
                  <li key={i} className={styles.runItem}>
                    <span className={styles.runNum}>{i + 1}</span>
                    <span>{node}</span>
                  </li>
                ))}
              </ol>

              <div className={styles.actions}>
                {SkipButton}
                <div className={styles.actionsRight}>
                  <Button
                    variant="primary"
                    disabled={complete.isPending || isNavigating}
                    onClick={() => complete.mutate(createdTable.id)}
                  >
                    {complete.isPending || isNavigating ? 'Opening…' : 'Open your table'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  )
}
