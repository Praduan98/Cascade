'use client'
import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import {
  Alert,
  AppShell,
  Avatar,
  Breakdown,
  BreakdownRow,
  Button,
  Card,
  Chip,
  CostLine,
  CreditMeter,
  Dialog,
  DialogClose,
  EnrichCell,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  Kbd,
  Member,
  NavGroup,
  NavItem,
  Panel,
  Pill,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ProvChip,
  ProvenanceCard,
  RoleBadge,
  Seg,
  Select,
  SideNav,
  Switch,
  Tag,
  Textarea,
  ThemeButton,
  Tooltip,
  TooltipProvider,
  ToastProvider,
  Topbar,
  TopNavLink,
  useToast,
  Waterfall,
  WorkspaceSwitcher,
  type PillStatus,
  type WaterfallStepData,
} from '@cascade/ui'
import styles from './page.module.css'

const SURFACES: Array<[string, string]> = [
  ['--ground', 'ground'],
  ['--surface', 'surface'],
  ['--surface-2', 'surface-2'],
  ['--surface-3', 'surface-3'],
  ['--border', 'border'],
  ['--brand', 'brand'],
  ['--cobalt', 'cobalt'],
  ['--gold', 'gold'],
]

const STATUS: Array<[PillStatus, string]> = [
  ['queued', 'Queued'],
  ['running', 'Running'],
  ['success', 'Success'],
  ['empty', 'Empty'],
  ['failed', 'Failed'],
  ['cached', 'Cached'],
]

const WF_STEPS: WaterfallStepData[] = [
  { id: 's1', provider: { glyph: 'PD', name: 'People Data Labs', color: '#3b82f6' }, operation: 'person enrich', inFields: ['first_name', 'last_name', 'domain'], outFields: ['work_email'], cost: '1 cr', costUsd: '~$0.008', fallThrough: { label: 'fall through if', cond: 'email is empty' } },
  { id: 's2', provider: { glyph: 'Hu', name: 'Hunter.io', color: '#f97316' }, operation: 'email finder', inFields: ['full_name', 'domain'], outFields: ['work_email', 'confidence'], cost: '1 cr', costUsd: '~$0.010', fallThrough: { label: 'then verify & accept only if', cond: 'deliverable' } },
  { id: 's3', provider: { glyph: 'ZB', name: 'ZeroBounce', color: '#10b981' }, operation: 'verify', inFields: ['work_email'], outFields: ['verify_status'], outTail: '· else fall through', cost: '0.5 cr', costUsd: '~$0.004', active: true },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function Tile({ title, name, col, children }: { title: string; name: string; col?: boolean; children: ReactNode }) {
  return (
    <div className={styles.tile}>
      <div className={styles.tileCap}>
        <span className="t">{title}</span>
        <span className="n">{name}</span>
      </div>
      <div className={[styles.tileBody, col ? styles.col : ''].filter(Boolean).join(' ')}>{children}</div>
    </div>
  )
}

const IconGrid = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M9 3v18" />
  </svg>
)
const IconPlus = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
)
const IconUsers = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="8" r="3.2" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </svg>
)
const IconCredits = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
)

function ToastDemo() {
  const { toast } = useToast()
  return (
    <div className={styles.stack}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Button onClick={() => toast('rec_9fK2x7Lp copied')}>Neutral (copytoast)</Button>
        <Button variant="primary" onClick={() => toast('1,181 rows enriched', { variant: 'success' })}>
          Success
        </Button>
        <Button onClick={() => toast('92% of budget consumed', { variant: 'warn' })}>Warn</Button>
        <Button variant="danger" onClick={() => toast('Provider key invalid', { variant: 'error' })}>
          Error
        </Button>
      </div>
      <span className={styles.note}>Click to fire a toast — it enters from the bottom, stacks, and auto-dismisses.</span>
    </div>
  )
}

export default function KitchenSink() {
  const [autoRun, setAutoRun] = useState(true)
  const [emptyOnly, setEmptyOnly] = useState(false)
  const [filter, setFilter] = useState<'all' | 'empty' | 'failed'>('all')
  const [nav, setNav] = useState('q3')
  const [wf, setWf] = useState<WaterfallStepData[]>(WF_STEPS)

  return (
    <TooltipProvider>
      <ToastProvider>
        <div className={styles.page}>
          <header className={styles.head}>
            <div>
              <div className={styles.title}>Component gallery</div>
              <Link href="/" style={{ fontSize: '0.82rem', color: 'var(--text-3)' }}>
                ← Cascade
              </Link>
            </div>
            <ThemeButton />
          </header>

          <Section title="Color · both themes (toggle top-right)">
            <div className={styles.swatches}>
              {SURFACES.map(([varName, label]) => (
                <div key={varName} className={styles.swatch}>
                  <div className={styles.chip} style={{ background: `var(${varName})` }} />
                  <div className={styles.meta}>
                    <div className={styles.name}>{label}</div>
                    <div className={styles.hex}>{varName}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Typography · Bricolage · Hanken · JetBrains Mono">
            <div className={styles.type}>
              <div className={styles.specDisplay}>Enrich, don&rsquo;t guess.</div>
              <div className={styles.specBody}>
                A waterfall runs providers in a defined order and only falls through to the next when the previous
                returns nothing — maximising coverage while minimising spend.
              </div>
              <div className={styles.specMono}>
                jordan@northwind.io &nbsp; 2,480 cr &nbsp; rec_9fK2x7Lp &nbsp; +1 415 555 0132
              </div>
            </div>
          </Section>

          <Section title="Buttons · variants, sizes, states">
            <div className={styles.grid}>
              <Tile title="Variants" name=".btn">
                <Button variant="primary">Run enrichment</Button>
                <Button variant="secondary">Add column</Button>
                <Button variant="ghost">Cancel</Button>
                <Button variant="danger">Delete table</Button>
              </Tile>
              <Tile title="Icons & sizes" name=".btn-sm / lg">
                <Button variant="primary" size="sm">
                  {IconPlus}
                  Run
                </Button>
                <Button variant="secondary">{IconPlus}New view</Button>
                <Button variant="primary" size="lg">
                  Confirm run · 2,480 cr
                </Button>
              </Tile>
              <Tile title="Disabled" name="states">
                <Button variant="primary" disabled>
                  Running…
                </Button>
                <Button variant="secondary" disabled>
                  Budget reached
                </Button>
              </Tile>
            </div>
          </Section>

          <Section title="Status pills · the enrichment state machine">
            <div className={styles.row}>
              {STATUS.map(([status, label]) => (
                <Pill key={status} status={status}>
                  {label}
                </Pill>
              ))}
            </div>
          </Section>

          <Section title="Tags & chips">
            <div className={styles.grid}>
              <Tile title="Select-option tags" name="tones">
                <Tag tone="brand">SaaS</Tag>
                <Tag tone="cobalt">Series B</Tag>
                <Tag tone="gold">Priority</Tag>
                <Tag tone="cached">Fintech</Tag>
                <Tag>Neutral</Tag>
                <Tag mono>1,240 rows</Tag>
              </Tile>
              <Tile title="Chips" name="mono, reference">
                <Chip>waterfall</Chip>
                <Chip tone="cobalt">↗ techcrunch.com</Chip>
                <Chip tone="gold">~3 cr/row</Chip>
                <Chip tone="cached">cached</Chip>
              </Tile>
            </div>
          </Section>

          <Section title="Forms & fields">
            <div className={styles.grid}>
              <Tile title="Typed inputs" name="column types" col>
                <Field label="Company domain" type="URL" hint="Normalised before caching · strips protocol & www">
                  <Input state="ok" defaultValue="northwind.io" />
                </Field>
                <Field label="Work email" type="Email" hint="Not a valid email shape — value not saved" error>
                  <Input state="err" defaultValue="jordan@northwind" />
                </Field>
                <Field label="Employees" type="Number">
                  <Input placeholder="e.g. 240" inputMode="numeric" />
                </Field>
              </Tile>
              <Tile title="Select & toggles" name="controls" col>
                <Field label="Fall-through condition" type="Select">
                  <Select defaultValue="empty">
                    <option value="empty">Previous step returned empty</option>
                    <option value="deliverable">Email marked deliverable</option>
                    <option value="conf">Confidence ≥ 0.8</option>
                  </Select>
                </Field>
                <div className={styles.between}>
                  <span className={styles.small}>Auto-run on new rows</span>
                  <Switch checked={autoRun} onCheckedChange={setAutoRun} aria-label="Auto-run on new rows" />
                </div>
                <div className={styles.between}>
                  <span className={styles.small}>Only enrich empty cells</span>
                  <Switch checked={emptyOnly} onCheckedChange={setEmptyOnly} aria-label="Only enrich empty cells" />
                </div>
              </Tile>
              <Tile title="Long text & segmented" name="textarea · seg" col>
                <Field label="Prompt" type="Long text">
                  <Textarea defaultValue="Summarise recent funding for {{Company}} in one sentence." />
                </Field>
                <Seg
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'empty', label: 'Empty only' },
                    { value: 'failed', label: 'Failed' },
                  ]}
                  value={filter}
                  onChange={setFilter}
                  aria-label="Row filter"
                />
                <span className={styles.note}>Showing: {filter}</span>
              </Tile>
            </div>
          </Section>

          <Section title="Alerts · four intents">
            <div className={styles.stack}>
              <Alert variant="info" title="Auto-run is on">
                New rows with a domain will enrich automatically.
              </Alert>
              <Alert variant="success" title="Run complete">
                1,181 enriched · 59 empty · 2,410 credits used.
              </Alert>
              <Alert variant="warn" title="Approaching budget">
                92% of the workspace budget consumed this period.
              </Alert>
              <Alert variant="error" title="Provider key invalid">
                Hunter.io returned 401 — update the key in provider settings.
              </Alert>
            </div>
          </Section>

          <Section title="Surfaces · card, panel, kbd">
            <div className={styles.grid}>
              <Card style={{ padding: 18 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Card</div>
                <p className={styles.small} style={{ color: 'var(--text-2)' }}>
                  Elevated surface with <code className="inline">shadow-2</code>. Used for grouped content.
                </p>
              </Card>
              <Panel style={{ padding: 18 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Panel</div>
                <p className={styles.small} style={{ color: 'var(--text-2)' }}>
                  Flat inset surface for toolbars and sub-regions.
                </p>
              </Panel>
              <Card style={{ padding: 18 }}>
                <div style={{ fontWeight: 700, marginBottom: 10 }}>Keyboard</div>
                <div className={styles.row}>
                  <Kbd>⌘</Kbd>
                  <Kbd>C</Kbd>
                  <span style={{ color: 'var(--text-3)' }}>/</span>
                  <Kbd>Enter</Kbd>
                  <Kbd>Esc</Kbd>
                </div>
              </Card>
            </div>
          </Section>

          <Section title="Members & roles">
            <div className={styles.grid}>
              <Tile title="Avatars" name="initials · pending">
                <Avatar initials="SD" bg="var(--brand)" />
                <Avatar initials="RA" bg="var(--cobalt)" />
                <Avatar initials="MK" bg="var(--surface-3)" color="var(--text-2)" />
                <Avatar initials="PN" dashed />
              </Tile>
              <Tile title="Role badges" name="4 roles">
                <RoleBadge role="owner" />
                <RoleBadge role="admin" />
                <RoleBadge role="member" />
                <RoleBadge role="viewer" />
              </Tile>
            </div>
            <Card style={{ padding: '6px 18px', maxWidth: 560, marginTop: 16 }}>
              <Member
                avatar={<Avatar initials="SD" bg="var(--brand)" />}
                name="Swarnendu De"
                email="swarnendu@insightstap.com"
                action={<RoleBadge role="owner" />}
              />
              <Member
                avatar={<Avatar initials="RA" bg="var(--cobalt)" />}
                name="Rhea Advani"
                email="rhea@insightstap.com"
                action={<RoleBadge role="admin" />}
              />
              <Member
                avatar={<Avatar initials="MK" bg="var(--surface-3)" color="var(--text-2)" />}
                name="Marco Klein"
                email="marco@insightstap.com"
                action={<RoleBadge role="member" />}
              />
              <Member
                last
                avatar={<Avatar initials="PN" dashed />}
                name={
                  <>
                    Priya Nair{' '}
                    <Tag style={{ fontSize: 'var(--fs-2xs)', padding: '.1em .4em' }}>pending</Tag>
                  </>
                }
                email="priya@client.com"
                action={<RoleBadge role="viewer" />}
              />
            </Card>
          </Section>

          <Section title="Provider chips">
            <div className={styles.row}>
              <ProvChip mono="PD" bg="#2563eb">
                People Data Labs
              </ProvChip>
              <ProvChip mono="Hu" bg="#c2410c">
                Hunter.io
              </ProvChip>
              <ProvChip mono="Pr" bg="#7c3aed">
                Prospeo
              </ProvChip>
              <ProvChip mono="ZB" bg="#047857">
                ZeroBounce
              </ProvChip>
              <ProvChip mono="Cs" bg="var(--brand)" color="var(--brand-ink)">
                Cascade Data
              </ProvChip>
            </div>
          </Section>

          <Section title="Empty state">
            <Card>
              <EmptyState
                icon={IconGrid}
                title="No tables yet"
                description="Create your first table to start enriching. Import a CSV or begin from a blank grid."
                action={
                  <>
                    <Button variant="primary">{IconPlus}New table</Button>
                    <Button variant="secondary">Import CSV</Button>
                  </>
                }
              />
            </Card>
          </Section>

          <Section title="Overlays · Radix, styled">
            <div className={styles.grid}>
              <Tile title="Dialog" name=".modal-demo">
                <Dialog
                  trigger={<Button variant="primary">Run waterfall…</Button>}
                  title="Run waterfall on 1,240 rows?"
                  footer={
                    <>
                      <DialogClose asChild>
                        <Button variant="ghost" size="sm">
                          Cancel
                        </Button>
                      </DialogClose>
                      <DialogClose asChild>
                        <Button variant="primary" size="sm">
                          Confirm &amp; run
                        </Button>
                      </DialogClose>
                    </>
                  }
                >
                  <p>
                    Providers run in order and stop as soon as a deliverable email is found. Cached and empty-input rows
                    are free.
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 14px',
                      margin: '12px 0 0',
                      borderRadius: 'var(--r-md)',
                      background: 'var(--gold-soft)',
                      border: '1px solid var(--gold-line)',
                    }}
                  >
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)' }}>Estimated maximum</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--gold)' }}>
                      ≤ 2,480 credits
                    </span>
                  </div>
                </Dialog>
              </Tile>

              <Tile title="Dropdown menu" name="row actions">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary">Table actions ▾</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLabel>Q3 Targets</DropdownMenuLabel>
                    <DropdownMenuItem>Rename</DropdownMenuItem>
                    <DropdownMenuItem>Duplicate</DropdownMenuItem>
                    <DropdownMenuItem>Export CSV</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem danger>Delete table</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </Tile>

              <Tile title="Popover" name="column config">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="secondary">Column options</Button>
                  </PopoverTrigger>
                  <PopoverContent align="start">
                    <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--text)' }}>Work email</div>
                    <div className={styles.between} style={{ marginBottom: 8 }}>
                      <span className={styles.small}>Frozen</span>
                      <Switch checked={false} aria-label="Frozen" />
                    </div>
                    <div className={styles.between}>
                      <span className={styles.small}>Only enrich empty</span>
                      <Switch checked aria-label="Only enrich empty" />
                    </div>
                  </PopoverContent>
                </Popover>
              </Tile>

              <Tile title="Tooltip" name="hover / focus">
                <Tooltip content="Providers run top-to-bottom and stop on the first hit.">
                  <Button variant="ghost">Hover me</Button>
                </Tooltip>
                <Tooltip content="rec_9fK2x7Lp" side="right">
                  <Tag mono>rec_9fK2x7Lp</Tag>
                </Tooltip>
              </Tile>

              <Tile title="Toasts" name=".copytoast" col>
                <ToastDemo />
              </Tile>
            </div>
          </Section>

          <Section title="Phase 2 · Enrichment engine">
            <div className={styles.grid}>
              <Tile title="Waterfall builder" name="signature · drag to reorder" col>
                <Waterfall
                  name="find_work_email"
                  summary={`${wf.length} steps · est. ≤ 2 cr/row`}
                  steps={wf}
                  onReorder={(from, to) =>
                    setWf((s) => {
                      const c = s.slice()
                      const [m] = c.splice(from, 1)
                      if (m) c.splice(to, 0, m)
                      return c
                    })
                  }
                  onRemoveStep={(id) => setWf((s) => s.filter((x) => x.id !== id))}
                  onAddStep={() =>
                    setWf((s) => [
                      ...s,
                      { id: `s${s.length + 1}_${s.length}`, provider: { glyph: 'Pr', name: 'Prospeo', color: '#8b5cf6' }, operation: 'email finder', inFields: ['domain'], outFields: ['work_email'], cost: '1 cr', costUsd: '~$0.009' },
                    ])
                  }
                />
              </Tile>

              <Tile title="Enrichment cells" name="the status machine" col>
                <EnrichCell status="success" display="jordan@northwind.io" />
                <EnrichCell status="running" />
                <EnrichCell status="cached" display="rosa@baltofreight.co" pill pillLabel="Cached" />
                <EnrichCell status="empty" display="no match found" muted pill />
                <EnrichCell status="failed" display="timeout · retried ×3" muted pill title="Provider timeout after 3 retries" />
                <EnrichCell status="queued" display="queued" muted pill />
              </Tile>

              <Tile title="Credit meter" name="the money surface" col>
                <CreditMeter
                  balance={18240}
                  used={31760}
                  total={50000}
                  renewsLabel="renews Aug 1"
                  estCharge="$180"
                  segments={[
                    { label: 'Enrichment', value: 22100, color: 'var(--brand)' },
                    { label: 'AI & agent', value: 7020, color: 'var(--cobalt)' },
                    { label: 'Cache saved', value: 2640, color: 'var(--st-cached)' },
                  ]}
                />
              </Tile>

              <Tile title="Consumption breakdown" name="admin sees cost" col>
                <Breakdown>
                  <BreakdownRow label="People Data Labs" credits="11,400 cr" cost="$91.20" fraction={0.62} />
                  <BreakdownRow label="Hunter.io" credits="6,300 cr" cost="$63.00" fraction={0.38} />
                  <BreakdownRow label="ZeroBounce · verify" credits="4,400 cr" cost="$17.60" fraction={0.24} />
                </Breakdown>
                <span className={styles.note}>Member view — the cost column collapses away:</span>
                <Breakdown>
                  <BreakdownRow label="People Data Labs" credits="11,400 cr" fraction={0.62} />
                  <BreakdownRow label="Hunter.io" credits="6,300 cr" fraction={0.38} />
                </Breakdown>
              </Tile>

              <Tile title="Spend gate" name="run confirmation" col>
                <p className={styles.note} style={{ marginTop: 0 }}>Run waterfall on 1,240 rows?</p>
                <CostLine amount="≤ 2,480 credits" />
                <div className={styles.row}>
                  <Button variant="ghost" size="sm">Cancel</Button>
                  <Button variant="primary" size="sm">Confirm &amp; run</Button>
                </div>
              </Tile>

              <Tile title="Per-cell provenance" name="popover">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="secondary" size="sm">Show provenance</Button>
                  </PopoverTrigger>
                  <PopoverContent align="start">
                    <ProvenanceCard
                      status="cached"
                      value="rosa@baltofreight.co"
                      provider={{ glyph: 'ZB', name: 'ZeroBounce', color: '#10b981' }}
                      operation="verify"
                      step="step 3"
                      at="2m ago"
                      fromCache
                      confidence={0.98}
                    />
                  </PopoverContent>
                </Popover>
              </Tile>
            </div>
          </Section>

          <Section title="App shell · topbar, sidebar, nav">
            <div className={styles.shellWrap}>
              <Topbar
                sub="Phase 1"
                nav={
                  <>
                    <TopNavLink active>Tables</TopNavLink>
                    <TopNavLink>Members</TopNavLink>
                    <TopNavLink>Audit</TopNavLink>
                  </>
                }
                actions={<ThemeButton />}
              />
              <AppShell
                sidebar={
                  <>
                    <WorkspaceSwitcher name="InsightsTap" />
                    <SideNav>
                      <NavGroup>Tables</NavGroup>
                      <NavItem icon={IconGrid} active={nav === 'q3'} onClick={() => setNav('q3')}>
                        Q3 Targets
                      </NavItem>
                      <NavItem icon={IconGrid} active={nav === 'abm'} onClick={() => setNav('abm')}>
                        ABM · Enterprise
                      </NavItem>
                      <NavItem icon={IconPlus} onClick={() => setNav('new')}>
                        New table
                      </NavItem>
                      <NavGroup>Workspace</NavGroup>
                      <NavItem icon={IconUsers} active={nav === 'members'} onClick={() => setNav('members')}>
                        Members
                      </NavItem>
                      <NavItem icon={IconCredits} disabled>
                        Usage &amp; credits
                      </NavItem>
                    </SideNav>
                  </>
                }
              >
                <div className={styles.shellToolbar}>
                  <span className={styles.tname}>Q3 Targets</span>
                  <Tag mono>1,240 rows</Tag>
                  <span style={{ flex: 1 }} />
                  <Pill status="running">34 running</Pill>
                  <Button variant="primary" size="sm">
                    Run
                  </Button>
                </div>
                <div className={styles.row}>
                  <Pill status="success">Success</Pill>
                  <Pill status="cached">Cached</Pill>
                  <Pill status="empty">Empty</Pill>
                  <Pill status="failed">Failed</Pill>
                </div>
                <p className={styles.note} style={{ marginBottom: 0 }}>
                  Active nav: <code className="inline">{nav}</code> — the shell grid, workspace switcher, and role-aware
                  nav are all live components.
                </p>
              </AppShell>
            </div>
          </Section>
        </div>
      </ToastProvider>
    </TooltipProvider>
  )
}
