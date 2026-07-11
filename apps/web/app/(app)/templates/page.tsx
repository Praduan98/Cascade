'use client'
// Templates gallery (Phase 4, US-4.9) — a curated recipe library. Each card is a
// ready-to-run table recipe; the credit cost is made clear up front (gold "≤ N
// cr/row" or a "Free" tag) before the user instantiates. Instantiating creates a
// real table with configured columns and navigates straight into it.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@cascade/data'
import type { Template, TableMeta, TemplateCategory } from '@cascade/core'
import { canWrite } from '@cascade/core'
import { Alert, Button, Card, EmptyState, Seg, Tag, useToast } from '@cascade/ui'
import { useSession } from '../../session'
import { errorMessage } from '../../lib/ui'
import { InstantiateDialog } from './_components/InstantiateDialog'
import styles from './templates.module.css'

type Filter = 'all' | TemplateCategory

const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  sales: 'Sales',
  recruiting: 'Recruiting',
  research: 'Research',
  operations: 'Operations',
}

const FILTER_OPTIONS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'sales', label: 'Sales' },
  { value: 'recruiting', label: 'Recruiting' },
  { value: 'research', label: 'Research' },
  { value: 'operations', label: 'Operations' },
]

/** Configured-column kinds a template sets up, with counts (waterfall/AI/agent/formula). */
function configuredKinds(t: Template): { label: string; tone: 'brand' | 'cobalt' | 'default' }[] {
  const kinds: { label: string; tone: 'brand' | 'cobalt' | 'default' }[] = []
  if (t.enrichment?.length) kinds.push({ label: `${t.enrichment.length} waterfall`, tone: 'brand' })
  if (t.ai?.length) kinds.push({ label: `${t.ai.length} AI`, tone: 'cobalt' })
  if (t.agent?.length) kinds.push({ label: `${t.agent.length} agent`, tone: 'cobalt' })
  if (t.formula?.length) kinds.push({ label: `${t.formula.length} formula`, tone: 'default' })
  return kinds
}

function ArrowRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}
function GalleryGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function TemplateCard({ template, writable, onUse }: { template: Template; writable: boolean; onUse: () => void }) {
  const kinds = configuredKinds(template)
  const isFree = template.creditsPerRow <= 0

  const inner = (
    <>
      <div className={styles.cardTop}>
        <span className={styles.glyph} style={{ background: template.accent }} aria-hidden="true">
          {template.glyph}
        </span>
        <div className={styles.cardTitle}>
          <span className={styles.name}>{template.name}</span>
          <span className={styles.category}>{CATEGORY_LABEL[template.category]}</span>
        </div>
        {isFree ? (
          <Tag tone="success">Free</Tag>
        ) : (
          <Tag tone="gold" mono>
            ≤ {template.creditsPerRow} cr/row
          </Tag>
        )}
      </div>

      <p className={styles.summary}>{template.summary}</p>

      {template.tags.length > 0 && (
        <div className={styles.tags}>
          {template.tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </div>
      )}

      <div className={styles.foot}>
        <span className={styles.colCount}>
          {template.columns.length} column{template.columns.length === 1 ? '' : 's'}
        </span>
        {kinds.length > 0 && (
          <span className={styles.kinds}>
            {kinds.map((k) => (
              <Tag key={k.label} mono tone={k.tone}>
                {k.label}
              </Tag>
            ))}
          </span>
        )}
      </div>

      {writable ? (
        <span className={styles.cta}>
          Use template <ArrowRight />
        </span>
      ) : (
        <span className={[styles.cta, styles.ctaMuted].join(' ')}>View only</span>
      )}
    </>
  )

  if (!writable) {
    return <div className={styles.card}>{inner}</div>
  }
  return (
    <button type="button" className={styles.card} onClick={onUse}>
      {inner}
    </button>
  )
}

export default function TemplatesPage() {
  const { workspace, role } = useSession()
  const router = useRouter()
  const qc = useQueryClient()
  const { toast } = useToast()
  const writable = role ? canWrite(role) : false

  const [filter, setFilter] = useState<Filter>('all')
  const [active, setActive] = useState<Template | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const templatesQuery = useQuery({
    queryKey: ['templates'],
    queryFn: () => getApi().templates.list(),
  })

  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data])
  const filtered = useMemo(
    () => (filter === 'all' ? templates : templates.filter((t) => t.category === filter)),
    [templates, filter],
  )

  function openTemplate(t: Template) {
    setActive(t)
    setDialogOpen(true)
  }

  function handleInstantiated(table: TableMeta) {
    setDialogOpen(false)
    // Refresh the persistent Sidebar's table list (it observes this key) so the
    // new table appears in the nav, matching CreateTableDialog's flow.
    if (workspace) void qc.invalidateQueries({ queryKey: ['tables', workspace.id] })
    toast(`Created “${table.name}”`, { variant: 'success' })
    router.push(`/tables/${table.id}`)
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

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headTitle}>
          <h1>Templates</h1>
          <div className={styles.count}>
            {templatesQuery.isLoading
              ? 'Loading…'
              : `${templates.length} ready-to-run recipes · start in one click`}
          </div>
        </div>
      </header>

      <div className={styles.tabs}>
        <Seg aria-label="Filter templates by category" value={filter} onChange={setFilter} options={FILTER_OPTIONS} />
      </div>

      {!writable && (
        <Alert variant="info" title="Browsing only" className={styles.state}>
          You can explore every template, but creating a table from one needs a member role or higher.
        </Alert>
      )}

      {templatesQuery.isError && (
        <Alert variant="error" title="Couldn’t load templates" className={styles.state}>
          {errorMessage(templatesQuery.error)}
        </Alert>
      )}

      {templatesQuery.isLoading ? (
        <div className={styles.grid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className={styles.skelCard}>
              <div className={styles.skelRow}>
                <div className={styles.skelBlock} style={{ width: 40, height: 40 }} />
                <div className={styles.skelBlock} style={{ height: 15, flex: 1 }} />
              </div>
              <div className={styles.skelBlock} style={{ height: 12, width: '90%' }} />
              <div className={styles.skelBlock} style={{ height: 12, width: '60%' }} />
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          className={styles.state}
          icon={<GalleryGlyph />}
          title="No templates here"
          description={
            filter === 'all'
              ? 'No templates are available yet.'
              : `No ${CATEGORY_LABEL[filter]} templates yet — try another category.`
          }
        />
      ) : (
        <div className={styles.grid}>
          {filtered.map((t) => (
            <TemplateCard key={t.id} template={t} writable={writable} onUse={() => openTemplate(t)} />
          ))}
        </div>
      )}

      <InstantiateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        workspaceId={workspace.id}
        template={active}
        onInstantiated={handleInstantiated}
      />
    </div>
  )
}
