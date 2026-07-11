// Realistic seed data: 2 workspaces, 4 members spanning every role, 3 tables in
// the primary workspace (Companies with 60 rows, Contacts, Pipeline) plus an
// isolated table in the second workspace to demonstrate tenant separation.
// `generateRows` synthesises up to ~100k believable rows for perf testing.

import type {
  AgentColumnConfig,
  AiCache,
  AiCellMeta,
  AiCellResult,
  AiColumnConfig,
  Automation,
  Cell,
  CellValue,
  Column,
  ColumnConfig,
  CreditLedgerEntry,
  CreditPurchase,
  CrmConnection,
  EnrichmentCache,
  EnrichmentCellMeta,
  EnrichmentCellResult,
  EnrichmentCellStatus,
  EnrichmentColumnConfig,
  EnrichmentRun,
  FormulaColumnConfig,
  HttpColumnConfig,
  InboundWebhook,
  IntegrationEvent,
  Invite,
  Invoice,
  InvoiceLineItem,
  Member,
  MultiSelectConfig,
  OutboundWebhook,
  PlatformAuditEntry,
  PlatformUser,
  Provider,
  ProviderCredential,
  RecordRow,
  SingleSelectConfig,
  SlackConnection,
  Subscription,
  TableMeta,
  User,
  Workspace,
  WorkspaceCredit,
} from '@cascade/core'
import { columnTypeRegistry, emptyFilter } from '@cascade/core'
import type { StoreData } from './store'
import { emptyStoreData } from './store'
import { PLANS } from './plans'

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) so seeds and perf rows are reproducible.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rint = (rng: () => number, min: number, max: number) => min + Math.floor(rng() * (max - min + 1))
const pickOne = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)] as T

// ---------------------------------------------------------------------------
// Stable IDs
// ---------------------------------------------------------------------------

const U = { owner: 'usr_owner', admin: 'usr_admin', member: 'usr_member', viewer: 'usr_viewer' } as const
const WS = { primary: 'ws_insightstap', secondary: 'ws_sdtc' } as const
const T = { companies: 'tbl_companies', contacts: 'tbl_contacts', pipeline: 'tbl_pipeline', accounts: 'tbl_accounts' } as const

const NOW = '2026-07-09T12:00:00.000Z'
const CREATED = '2026-06-01T09:00:00.000Z'

// ---------------------------------------------------------------------------
// Select options
// ---------------------------------------------------------------------------

const VERIFIED_OPTS = [
  { id: 'opt_v_verified', label: 'Verified', color: '#38d08c' },
  { id: 'opt_v_pending', label: 'Pending', color: '#f5b544' },
  { id: 'opt_v_unverified', label: 'Unverified', color: '#8698a4' },
]
const TAG_OPTS = [
  { id: 'opt_t_saas', label: 'SaaS', color: '#2fe6c8' },
  { id: 'opt_t_fintech', label: 'Fintech', color: '#4f9dff' },
  { id: 'opt_t_health', label: 'Health', color: '#38d08c' },
  { id: 'opt_t_commerce', label: 'Commerce', color: '#ab8cfb' },
  { id: 'opt_t_ai', label: 'AI', color: '#f2666b' },
  { id: 'opt_t_devtools', label: 'DevTools', color: '#16b79e' },
]
const PRIORITY_OPTS = [
  { id: 'opt_p_high', label: 'High', color: '#f2666b' },
  { id: 'opt_p_med', label: 'Medium', color: '#f5b544' },
  { id: 'opt_p_low', label: 'Low', color: '#8698a4' },
]
const STAGE_OPTS = [
  { id: 'opt_s_lead', label: 'Lead', color: '#8698a4' },
  { id: 'opt_s_qualified', label: 'Qualified', color: '#4f9dff' },
  { id: 'opt_s_proposal', label: 'Proposal', color: '#ab8cfb' },
  { id: 'opt_s_won', label: 'Won', color: '#38d08c' },
  { id: 'opt_s_lost', label: 'Lost', color: '#f2666b' },
]
// Verify verdicts (US-2.14) — the ZeroBounce output column of the "Work email" waterfall.
const DELIVERABLE_OPTS = [
  { id: 'opt_d_deliverable', label: 'Deliverable', color: '#38d08c' },
  { id: 'opt_d_risky', label: 'Risky', color: '#f5b544' },
  { id: 'opt_d_undeliverable', label: 'Undeliverable', color: '#f2666b' },
  { id: 'opt_d_unknown', label: 'Unknown', color: '#8698a4' },
]

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function makeColumn(
  id: string,
  tableId: string,
  name: string,
  config: ColumnConfig,
  position: number,
  opts: { frozen?: boolean; width?: number } = {},
): Column {
  return {
    id,
    tableId,
    name,
    type: config.type,
    config,
    position,
    isFrozen: opts.frozen ?? false,
    width: opts.width ?? 160,
  }
}

function cell(recordId: string, columnId: string, value: CellValue): Cell {
  return { recordId, columnId, value, meta: {} }
}

// ---------------------------------------------------------------------------
// Companies table
// ---------------------------------------------------------------------------

const COMPANIES: Array<[string, string]> = [
  ['Northwind Traders', 'northwind.io'], ['Acme Analytics', 'acmeanalytics.com'],
  ['Globex Systems', 'globex.io'], ['Initech Software', 'initech.com'],
  ['Umbrella Data', 'umbrelladata.com'], ['Hooli Cloud', 'hooli.com'],
  ['Pied Piper', 'piedpiper.io'], ['Vandelay Industries', 'vandelay.co'],
  ['Stark Industries', 'stark.io'], ['Wayne Enterprises', 'wayneent.com'],
  ['Wonka Commerce', 'wonka.io'], ['Cyberdyne Labs', 'cyberdyne.ai'],
  ['Soylent Foods', 'soylent.co'], ['Tyrell Systems', 'tyrell.io'],
  ['Massive Dynamic', 'massivedynamic.com'], ['Gekko Capital', 'gekko.finance'],
  ['Bluth Ventures', 'bluth.co'], ['Prestige Worldwide', 'prestigeww.com'],
  ['Dunder Data', 'dunderdata.com'], ['Sterling Cooper', 'sterlingcooper.io'],
  ['Paper Street', 'paperstreet.co'], ['Oscorp Health', 'oscorp.health'],
  ['Nakatomi Cloud', 'nakatomi.io'], ['Aperture Labs', 'aperture.science'],
  ['Black Mesa', 'blackmesa.io'], ['Weyland Systems', 'weyland.io'],
  ['Momcorp', 'momcorp.com'], ['Planet Express', 'planetexpress.io'],
  ['Bright Path', 'brightpath.ai'], ['Northgate Retail', 'northgate.shop'],
  ['Silverline SaaS', 'silverline.io'], ['Copperfield', 'copperfield.co'],
  ['Redwood Metrics', 'redwoodmetrics.com'], ['Blue Harbor', 'blueharbor.io'],
  ['Greenfield Labs', 'greenfield.dev'], ['Ironclad Security', 'ironclad.io'],
  ['Lumen Works', 'lumenworks.com'], ['Nimbus Data', 'nimbusdata.io'],
  ['Orbit Commerce', 'orbitcommerce.com'], ['Quill Software', 'quill.io'],
  ['Riverstone', 'riverstone.co'], ['Sable Fintech', 'sable.finance'],
  ['Tessera Health', 'tessera.health'], ['Vertex Cloud', 'vertexcloud.io'],
  ['Willow Systems', 'willowsystems.com'], ['Zephyr Labs', 'zephyrlabs.ai'],
  ['Anvil DevTools', 'anvil.dev'], ['Beacon Analytics', 'beacon.io'],
  ['Cobalt Commerce', 'cobalt.shop'], ['Delta Metrics', 'deltametrics.com'],
  ['Echo Health', 'echohealth.io'], ['Fathom Data', 'fathom.io'],
  ['Granite CRM', 'granitecrm.com'], ['Halcyon', 'halcyon.io'],
  ['Indigo Cloud', 'indigocloud.com'], ['Juniper Works', 'juniperworks.io'],
  ['Kestrel Fintech', 'kestrel.finance'], ['Lattice Labs', 'latticelabs.dev'],
  ['Meridian Health', 'meridian.health'], ['Onyx Systems', 'onyxsystems.io'],
]

const EMAIL_PREFIX = ['hello', 'contact', 'sales', 'team', 'info']
const AREA_CODES = ['415', '212', '646', '503', '312', '206', '617', '303', '512', '404']
const NOTES = [
  'Warm intro via the Q2 webinar. Decision maker is the VP of Ops.',
  'Renewal due next quarter — flagged for an expansion conversation.',
  'Migrated from a legacy spreadsheet workflow last month.',
  'Champion left; needs a re-engagement sequence.',
  'Strong product fit, waiting on procurement sign-off.',
  'Pilot going well; usage up 3x week over week.',
  '',
]

const companyColumns: Column[] = [
  makeColumn('col_co_company', T.companies, 'Company', { type: 'text' }, 0, { frozen: true, width: 200 }),
  makeColumn('col_co_domain', T.companies, 'Domain', { type: 'url' }, 1, { width: 190 }),
  makeColumn('col_co_employees', T.companies, 'Employees', { type: 'number', precision: 0 }, 2, { width: 120 }),
  // The "Work email" waterfall anchor + its ZeroBounce verify output.
  makeColumn('col_co_email', T.companies, 'Work email', { type: 'email' }, 3, { width: 220 }),
  makeColumn('col_co_deliverable', T.companies, 'Deliverable', { type: 'singleSelect', options: DELIVERABLE_OPTS }, 4, { width: 140 }),
  makeColumn('col_co_verified', T.companies, 'Verified', { type: 'singleSelect', options: VERIFIED_OPTS }, 5, { width: 130 }),
  makeColumn('col_co_tags', T.companies, 'Tags', { type: 'multiSelect', options: TAG_OPTS }, 6, { width: 210 }),
  makeColumn('col_co_mrr', T.companies, 'MRR', { type: 'currency', currencyCode: 'USD', precision: 0 }, 7, { width: 130 }),
  makeColumn('col_co_signed', T.companies, 'Signed', { type: 'date', format: 'MMM D, YYYY' }, 8, { width: 150 }),
  makeColumn('col_co_phone', T.companies, 'Phone', { type: 'phone' }, 9, { width: 160 }),
  makeColumn('col_co_active', T.companies, 'Active', { type: 'boolean' }, 10, { width: 90 }),
  makeColumn('col_co_notes', T.companies, 'Notes', { type: 'longText' }, 11, { width: 280 }),
  // Phase 3 demo AI column — a one-line pitch generated from the company fields.
  makeColumn('col_co_pitch', T.companies, 'AI: One-line pitch', { type: 'ai' }, 12, { width: 320 }),
  // Phase 3 rest — a computed Segment (formula), a web-research Agent column, and
  // an HTTP-enrichment column. Formula fills instantly; agent/http are runnable.
  makeColumn('col_co_segment', T.companies, 'Segment', { type: 'formula' }, 13, { width: 130 }),
  makeColumn('col_co_intel', T.companies, 'Agent: Company intel', { type: 'agent' }, 14, { width: 300 }),
  makeColumn('col_co_hq', T.companies, 'HTTP: HQ city', { type: 'http' }, 15, { width: 160 }),
]

/** The demo Segment formula (kept here so seed can pre-compute matching cells). */
const SEGMENT_EXPR = 'IF({{Employees}} > 500, "Enterprise", IF({{Employees}} > 50, "Mid-market", "SMB"))'
function segmentFor(employees: number): string {
  return employees > 500 ? 'Enterprise' : employees > 50 ? 'Mid-market' : 'SMB'
}

function buildCompanies(): { records: RecordRow[]; cells: Cell[] } {
  const records: RecordRow[] = []
  const cells: Cell[] = []
  COMPANIES.forEach(([name, domain], i) => {
    const rng = mulberry32(1000 + i)
    const rid = `rec_co_${String(i).padStart(3, '0')}`
    records.push({ id: rid, tableId: T.companies, position: i, createdAt: CREATED, updatedAt: NOW })

    const verified = i % 5 === 0 ? 'opt_v_unverified' : i % 3 === 0 ? 'opt_v_pending' : 'opt_v_verified'
    const tags: string[] = []
    const tagCount = rint(rng, 1, 3)
    while (tags.length < tagCount) {
      const id = pickOne(rng, TAG_OPTS).id
      if (!tags.includes(id)) tags.push(id)
    }
    const year = 2024 + (i % 3)
    const month = (i % 12) + 1
    const day = (i % 27) + 1
    const signed = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const area = pickOne(rng, AREA_CODES)
    const phone = `+1${area}555${String(1000 + i).padStart(4, '0')}`
    const note = NOTES[i % NOTES.length] ?? ''
    const employees = rint(rng, 8, 8200)

    cells.push(
      cell(rid, 'col_co_company', name),
      cell(rid, 'col_co_domain', `https://${domain}`),
      cell(rid, 'col_co_employees', employees),
      cell(rid, 'col_co_email', `${pickOne(rng, EMAIL_PREFIX)}@${domain}`),
      cell(rid, 'col_co_verified', verified),
      cell(rid, 'col_co_tags', tags),
      cell(rid, 'col_co_mrr', rint(rng, 10, 1800) * 50),
      cell(rid, 'col_co_signed', signed),
      cell(rid, 'col_co_phone', i % 9 === 0 ? null : phone),
      cell(rid, 'col_co_active', i % 7 !== 0),
      cell(rid, 'col_co_notes', note === '' ? null : note),
      // Formula column pre-computed to match the SEGMENT_EXPR (US-3.6).
      { recordId: rid, columnId: 'col_co_segment', value: segmentFor(employees), meta: { formula: { status: 'ok', computedAt: NOW } } },
    )
  })
  return { records, cells }
}

// ---------------------------------------------------------------------------
// Contacts table
// ---------------------------------------------------------------------------

const contactColumns: Column[] = [
  makeColumn('col_ct_name', T.contacts, 'Name', { type: 'text' }, 0, { frozen: true, width: 180 }),
  makeColumn('col_ct_title', T.contacts, 'Title', { type: 'text' }, 1, { width: 180 }),
  makeColumn('col_ct_company', T.contacts, 'Company', { type: 'text' }, 2, { width: 170 }),
  makeColumn('col_ct_email', T.contacts, 'Email', { type: 'email' }, 3, { width: 220 }),
  makeColumn('col_ct_linkedin', T.contacts, 'LinkedIn', { type: 'url' }, 4, { width: 200 }),
  makeColumn('col_ct_priority', T.contacts, 'Priority', { type: 'singleSelect', options: PRIORITY_OPTS }, 5, { width: 120 }),
  makeColumn('col_ct_reachable', T.contacts, 'Reachable', { type: 'boolean' }, 6, { width: 100 }),
  makeColumn('col_ct_added', T.contacts, 'Added', { type: 'date', format: 'YYYY-MM-DD' }, 7, { width: 130 }),
]

const CONTACTS: Array<[string, string, string, string, string]> = [
  ['Amara Okafor', 'VP Operations', 'Northwind Traders', 'amara.okafor', 'opt_p_high'],
  ['Ben Carter', 'Head of Growth', 'Acme Analytics', 'ben.carter', 'opt_p_high'],
  ['Chen Wei', 'CTO', 'Globex Systems', 'chen.wei', 'opt_p_med'],
  ['Dahlia Ross', 'Procurement Lead', 'Initech Software', 'dahlia.ross', 'opt_p_low'],
  ['Elena Popov', 'RevOps Manager', 'Umbrella Data', 'elena.popov', 'opt_p_med'],
  ['Farid Hassan', 'Founder', 'Pied Piper', 'farid.hassan', 'opt_p_high'],
  ['Grace Lin', 'Data Lead', 'Massive Dynamic', 'grace.lin', 'opt_p_med'],
  ['Hugo Martin', 'Sales Director', 'Sterling Cooper', 'hugo.martin', 'opt_p_low'],
  ['Ines Duarte', 'COO', 'Bright Path', 'ines.duarte', 'opt_p_high'],
  ['Jamal Reed', 'IT Manager', 'Nimbus Data', 'jamal.reed', 'opt_p_med'],
  ['Kira Novak', 'Product Lead', 'Vertex Cloud', 'kira.novak', 'opt_p_low'],
  ['Liam OConnor', 'CEO', 'Anvil DevTools', 'liam.oconnor', 'opt_p_high'],
  ['Mona Aziz', 'Marketing Lead', 'Beacon Analytics', 'mona.aziz', 'opt_p_med'],
  ['Noah Berg', 'Finance Director', 'Sable Fintech', 'noah.berg', 'opt_p_med'],
  ['Olivia Shah', 'Head of Data', 'Fathom Data', 'olivia.shah', 'opt_p_low'],
]

function buildContacts(): { records: RecordRow[]; cells: Cell[] } {
  const records: RecordRow[] = []
  const cells: Cell[] = []
  CONTACTS.forEach(([name, title, company, handle, priority], i) => {
    const rng = mulberry32(5000 + i)
    const rid = `rec_ct_${String(i).padStart(3, '0')}`
    records.push({ id: rid, tableId: T.contacts, position: i, createdAt: CREATED, updatedAt: NOW })
    const day = (i % 27) + 1
    cells.push(
      cell(rid, 'col_ct_name', name),
      cell(rid, 'col_ct_title', title),
      cell(rid, 'col_ct_company', company),
      cell(rid, 'col_ct_email', `${handle}@example.com`),
      cell(rid, 'col_ct_linkedin', `https://linkedin.com/in/${handle.replace('.', '-')}`),
      cell(rid, 'col_ct_priority', priority),
      cell(rid, 'col_ct_reachable', rng() > 0.35),
      cell(rid, 'col_ct_added', `2026-0${(i % 6) + 1}-${String(day).padStart(2, '0')}`),
    )
  })
  return { records, cells }
}

// ---------------------------------------------------------------------------
// Pipeline table (currency-heavy)
// ---------------------------------------------------------------------------

const pipelineColumns: Column[] = [
  makeColumn('col_pl_deal', T.pipeline, 'Deal', { type: 'text' }, 0, { frozen: true, width: 220 }),
  makeColumn('col_pl_company', T.pipeline, 'Company', { type: 'text' }, 1, { width: 180 }),
  makeColumn('col_pl_stage', T.pipeline, 'Stage', { type: 'singleSelect', options: STAGE_OPTS }, 2, { width: 130 }),
  makeColumn('col_pl_value', T.pipeline, 'Value', { type: 'currency', currencyCode: 'USD', precision: 0 }, 3, { width: 140 }),
  makeColumn('col_pl_close', T.pipeline, 'Close date', { type: 'date', format: 'MMM D, YYYY' }, 4, { width: 150 }),
  makeColumn('col_pl_web', T.pipeline, 'Website', { type: 'url' }, 5, { width: 190 }),
]

const PIPELINE: Array<[string, string, string, number, string]> = [
  ['Northwind — Platform', 'Northwind Traders', 'opt_s_proposal', 48000, 'northwind.io'],
  ['Acme — Analytics Suite', 'Acme Analytics', 'opt_s_qualified', 22000, 'acmeanalytics.com'],
  ['Globex — Enterprise', 'Globex Systems', 'opt_s_won', 96000, 'globex.io'],
  ['Initech — Team Plan', 'Initech Software', 'opt_s_lead', 9000, 'initech.com'],
  ['Massive — Data Cloud', 'Massive Dynamic', 'opt_s_proposal', 61000, 'massivedynamic.com'],
  ['Bright Path — Growth', 'Bright Path', 'opt_s_qualified', 31000, 'brightpath.ai'],
  ['Vertex — Migration', 'Vertex Cloud', 'opt_s_won', 74000, 'vertexcloud.io'],
  ['Anvil — DevTools', 'Anvil DevTools', 'opt_s_lost', 12000, 'anvil.dev'],
  ['Sable — Fintech API', 'Sable Fintech', 'opt_s_proposal', 53000, 'sable.finance'],
  ['Fathom — Metrics', 'Fathom Data', 'opt_s_lead', 15000, 'fathom.io'],
  ['Beacon — Insights', 'Beacon Analytics', 'opt_s_qualified', 27000, 'beacon.io'],
  ['Nimbus — Storage', 'Nimbus Data', 'opt_s_won', 41000, 'nimbusdata.io'],
]

function buildPipeline(): { records: RecordRow[]; cells: Cell[] } {
  const records: RecordRow[] = []
  const cells: Cell[] = []
  PIPELINE.forEach(([deal, company, stage, value, domain], i) => {
    const rid = `rec_pl_${String(i).padStart(3, '0')}`
    records.push({ id: rid, tableId: T.pipeline, position: i, createdAt: CREATED, updatedAt: NOW })
    const month = (i % 6) + 7
    const day = (i % 27) + 1
    cells.push(
      cell(rid, 'col_pl_deal', deal),
      cell(rid, 'col_pl_company', company),
      cell(rid, 'col_pl_stage', stage),
      cell(rid, 'col_pl_value', value),
      cell(rid, 'col_pl_close', `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`),
      cell(rid, 'col_pl_web', `https://${domain}`),
    )
  })
  return { records, cells }
}

// ---------------------------------------------------------------------------
// Second-workspace table (isolation demo)
// ---------------------------------------------------------------------------

const accountColumns: Column[] = [
  makeColumn('col_ac_name', T.accounts, 'Account', { type: 'text' }, 0, { frozen: true, width: 200 }),
  makeColumn('col_ac_owner', T.accounts, 'Owner', { type: 'email' }, 1, { width: 220 }),
  makeColumn('col_ac_tier', T.accounts, 'Tier', { type: 'singleSelect', options: PRIORITY_OPTS }, 2, { width: 120 }),
]

function buildAccounts(): { records: RecordRow[]; cells: Cell[] } {
  const rows = [
    ['SDTC Internal', 'ops@sdtc.digital', 'opt_p_high'],
    ['Partner — Contoso', 'liaison@contoso.com', 'opt_p_med'],
    ['Partner — Fabrikam', 'liaison@fabrikam.com', 'opt_p_low'],
  ]
  const records: RecordRow[] = []
  const cells: Cell[] = []
  rows.forEach(([name, owner, tier], i) => {
    const rid = `rec_ac_${String(i).padStart(3, '0')}`
    records.push({ id: rid, tableId: T.accounts, position: i, createdAt: CREATED, updatedAt: NOW })
    cells.push(
      cell(rid, 'col_ac_name', name as string),
      cell(rid, 'col_ac_owner', owner as string),
      cell(rid, 'col_ac_tier', tier as string),
    )
  })
  return { records, cells }
}

// ---------------------------------------------------------------------------
// Enrichment engine (Phase 2) — providers, credentials, credits, the "Work
// email" waterfall, a demo of every status, and reconciling run history.
// ---------------------------------------------------------------------------

const P = {
  pdl: 'prov_pdl',
  apollo: 'prov_apollo',
  hunter: 'prov_hunter',
  prospeo: 'prov_prospeo',
  zerobounce: 'prov_zerobounce',
  leadmagic: 'prov_leadmagic',
} as const

const ENR = { config: 'enrcfg_co_email', run1: 'enrrun_seed_1', run2: 'enrrun_seed_2' } as const

const AI = { config: 'aicfg_co_pitch', run1: 'airun_seed_1' } as const

const PROVIDERS: Provider[] = [
  { id: P.pdl, key: 'pdl', name: 'People Data Labs', category: 'people', defaultRateLimit: 10, defaultTtlDays: 30, costConfig: { person_enrich: { credits: 3, providerCostUsd: 0.02 }, company_enrich: { credits: 2, providerCostUsd: 0.01 } }, supportsByoKey: true, glyph: 'PD', monoColor: '#3b82f6' },
  { id: P.apollo, key: 'apollo', name: 'Apollo.io', category: 'people', defaultRateLimit: 8, defaultTtlDays: 30, costConfig: { person_enrich: { credits: 2, providerCostUsd: 0.015 }, company_enrich: { credits: 2, providerCostUsd: 0.012 } }, supportsByoKey: true, glyph: 'Ap', monoColor: '#ec4899' },
  { id: P.hunter, key: 'hunter', name: 'Hunter.io', category: 'email_find', defaultRateLimit: 15, defaultTtlDays: 14, costConfig: { find_email: { credits: 2, providerCostUsd: 0.01 } }, supportsByoKey: true, glyph: 'Hu', monoColor: '#f97316' },
  { id: P.prospeo, key: 'prospeo', name: 'Prospeo', category: 'email_find', defaultRateLimit: 12, defaultTtlDays: 14, costConfig: { find_email: { credits: 2, providerCostUsd: 0.009 } }, supportsByoKey: true, glyph: 'Pr', monoColor: '#8b5cf6' },
  { id: P.zerobounce, key: 'zerobounce', name: 'ZeroBounce', category: 'email_verify', defaultRateLimit: 20, defaultTtlDays: 7, costConfig: { verify_email: { credits: 1, providerCostUsd: 0.004 } }, supportsByoKey: true, glyph: 'ZB', monoColor: '#10b981' },
  { id: P.leadmagic, key: 'leadmagic', name: 'LeadMagic', category: 'phone', defaultRateLimit: 10, defaultTtlDays: 30, costConfig: { find_phone: { credits: 4, providerCostUsd: 0.03 }, find_email: { credits: 2, providerCostUsd: 0.011 } }, supportsByoKey: true, glyph: 'LM', monoColor: '#6366f1' },
]

const providerCredentials: ProviderCredential[] = [
  { id: 'cred_pdl', workspaceId: WS.primary, providerId: P.pdl, isPlatformManaged: true, maskedKey: '••••managed', status: 'active', createdAt: CREATED },
  { id: 'cred_apollo', workspaceId: WS.primary, providerId: P.apollo, isPlatformManaged: true, maskedKey: '••••managed', status: 'active', createdAt: CREATED },
  // Hunter is a bring-your-own-key demo (usage attributed to the workspace).
  { id: 'cred_hunter', workspaceId: WS.primary, providerId: P.hunter, isPlatformManaged: false, maskedKey: '••••7f3a', status: 'active', createdAt: CREATED },
  { id: 'cred_prospeo', workspaceId: WS.primary, providerId: P.prospeo, isPlatformManaged: true, maskedKey: '••••managed', status: 'active', createdAt: CREATED },
  { id: 'cred_zerobounce', workspaceId: WS.primary, providerId: P.zerobounce, isPlatformManaged: true, maskedKey: '••••managed', status: 'active', createdAt: CREATED },
  { id: 'cred_leadmagic', workspaceId: WS.primary, providerId: P.leadmagic, isPlatformManaged: true, maskedKey: '••••managed', status: 'active', createdAt: CREATED },
]

const workspaceCredits: WorkspaceCredit[] = [
  { workspaceId: WS.primary, balance: 18240, budgetCap: 50000, perRunCap: 5000 },
  { workspaceId: WS.secondary, balance: 5000, budgetCap: 10000, perRunCap: 2000 },
]

// The signature 3-step waterfall: PDL person-enrich → Hunter finder → ZeroBounce
// verify (accept only if deliverable). Matches the design-system sample.
const emailConfig: EnrichmentColumnConfig = {
  id: ENR.config,
  columnId: 'col_co_email',
  autoRun: false,
  forceFreshDefault: false,
  steps: [
    { providerId: P.pdl, operation: 'person_enrich', inputMapping: { domain: 'col_co_domain' }, outputMapping: { email: 'col_co_email' }, acceptanceCondition: 'nonEmptyField', acceptField: 'email', credits: 3, providerCostUsd: 0.02 },
    { providerId: P.hunter, operation: 'find_email', inputMapping: { domain: 'col_co_domain' }, outputMapping: { email: 'col_co_email' }, acceptanceCondition: 'nonEmptyField', acceptField: 'email', credits: 2, providerCostUsd: 0.01 },
    { providerId: P.zerobounce, operation: 'verify_email', inputMapping: { email: 'col_co_email' }, outputMapping: { deliverable: 'col_co_deliverable' }, acceptanceCondition: 'verifyDeliverable', credits: 1, providerCostUsd: 0.004 },
  ],
}

const enrichmentRuns: EnrichmentRun[] = [
  { id: ENR.run1, workspaceId: WS.primary, tableId: T.companies, triggeredBy: U.owner, triggeredByName: 'Aarav Shah', scope: { mode: 'whole', columnIds: ['col_co_email'] }, forceFresh: false, status: 'complete', counts: { processed: 52, total: 52, success: 38, empty: 9, failed: 2, cached: 3 }, creditsConsumed: 105, providerCostUsd: 0.5, startedAt: '2026-06-20T14:02:00.000Z', finishedAt: '2026-06-20T14:07:30.000Z' },
  { id: ENR.run2, workspaceId: WS.primary, tableId: T.companies, triggeredBy: U.member, triggeredByName: 'Dana Whitfield', scope: { mode: 'selected', recordIds: Array.from({ length: 24 }, (_, i) => `rec_co_${String(i).padStart(3, '0')}`), columnIds: ['col_co_email'] }, forceFresh: false, status: 'complete', counts: { processed: 24, total: 24, success: 18, empty: 3, failed: 1, cached: 2 }, creditsConsumed: 70, providerCostUsd: 0.35, startedAt: '2026-07-05T09:15:00.000Z', finishedAt: '2026-07-05T09:18:10.000Z' },
]

// Append-only ledger: a grant, then per-provider consumption reconciling the
// balance exactly to 18,240. `enrich:<key>:<op>` reasons drive the Usage
// "by provider" breakdown (and are the same reasons live runs write).
const creditLedger: CreditLedgerEntry[] = [
  { id: 'led_grant', workspaceId: WS.primary, delta: 18415, reason: 'grant:seed', balanceAfter: 18415, createdAt: '2026-06-01T09:00:00.000Z' },
  { id: 'led_1a', workspaceId: WS.primary, delta: -60, reason: 'enrich:pdl:person_enrich', runId: ENR.run1, balanceAfter: 18355, createdAt: '2026-06-20T14:07:00.000Z' },
  { id: 'led_1b', workspaceId: WS.primary, delta: -20, reason: 'enrich:hunter:find_email', runId: ENR.run1, balanceAfter: 18335, createdAt: '2026-06-20T14:07:10.000Z' },
  { id: 'led_1c', workspaceId: WS.primary, delta: -25, reason: 'enrich:zerobounce:verify_email', runId: ENR.run1, balanceAfter: 18310, createdAt: '2026-06-20T14:07:20.000Z' },
  { id: 'led_2a', workspaceId: WS.primary, delta: -30, reason: 'enrich:pdl:person_enrich', runId: ENR.run2, balanceAfter: 18280, createdAt: '2026-07-05T09:17:50.000Z' },
  { id: 'led_2b', workspaceId: WS.primary, delta: -20, reason: 'enrich:leadmagic:find_phone', runId: ENR.run2, balanceAfter: 18260, createdAt: '2026-07-05T09:18:00.000Z' },
  { id: 'led_2c', workspaceId: WS.primary, delta: -20, reason: 'enrich:prospeo:find_email', runId: ENR.run2, balanceAfter: 18240, createdAt: '2026-07-05T09:18:05.000Z' },
]

// A few warm cache entries so an immediate re-run of the cached demo rows is a
// genuine, free hit (keyed exactly as the engine keys them).
const enrichmentCache: EnrichmentCache[] = [
  { id: 'cache_1', cacheKey: 'prov_pdl|person_enrich|domain=acmeanalytics.com', providerId: P.pdl, operation: 'person_enrich', resultJson: { fields: { email: 'jordan.okoye@acmeanalytics.com' }, confidence: 0.91 }, cost: 0.02, fetchedAt: '2026-07-05T09:00:00.000Z', expiresAt: '2027-06-01T00:00:00.000Z' },
  { id: 'cache_2', cacheKey: 'prov_pdl|person_enrich|domain=piedpiper.io', providerId: P.pdl, operation: 'person_enrich', resultJson: { fields: { email: 'rosa.silva@piedpiper.io' }, confidence: 0.88 }, cost: 0.02, fetchedAt: '2026-07-05T09:00:00.000Z', expiresAt: '2027-06-01T00:00:00.000Z' },
  { id: 'cache_3', cacheKey: 'prov_pdl|person_enrich|domain=cyberdyne.ai', providerId: P.pdl, operation: 'person_enrich', resultJson: { fields: { email: 'marco.reyes@cyberdyne.ai' }, confidence: 0.93 }, cost: 0.02, fetchedAt: '2026-07-05T09:00:00.000Z', expiresAt: '2027-06-01T00:00:00.000Z' },
]

const ENR_STAMP = '2026-06-20T14:05:00.000Z'

/**
 * Overlay enrichment status onto the first 16 "Work email" cells so the grid
 * demonstrates the whole status system on first load; add the matching
 * Deliverable outputs and provenance results.
 */
function applyEnrichmentSeed(cells: Cell[]): { deliverableCells: Cell[]; results: EnrichmentCellResult[] } {
  const successIdx = new Set([0, 3, 5, 8, 9, 12, 14, 15])
  const cachedIdx = new Set([1, 6, 11])
  const emptyIdx = new Set([2, 7, 13])
  const byKey = new Map(cells.map((c) => [`${c.recordId}|${c.columnId}`, c] as const))
  const deliverableCells: Cell[] = []
  const results: EnrichmentCellResult[] = []

  for (let i = 0; i < 16; i++) {
    const rid = `rec_co_${String(i).padStart(3, '0')}`
    const emailCell = byKey.get(`${rid}|col_co_email`)
    if (!emailCell) continue

    let status: EnrichmentCellStatus
    let providerId: string | null
    let stepIndex: number | null
    let credits: number
    let usd: number
    let fromCache = false
    let reason: string | undefined

    if (successIdx.has(i)) {
      status = 'success'
      if (i % 2 === 0) {
        providerId = P.pdl
        stepIndex = 0
        credits = 3
        usd = 0.02
      } else {
        providerId = P.hunter
        stepIndex = 1
        credits = 2
        usd = 0.01
      }
    } else if (cachedIdx.has(i)) {
      status = 'cached'
      providerId = P.pdl
      stepIndex = 0
      credits = 0
      usd = 0
      fromCache = true
    } else if (emptyIdx.has(i)) {
      status = 'empty'
      providerId = null
      stepIndex = null
      credits = 0
      usd = 0
      reason = 'no match found'
    } else {
      status = 'failed'
      providerId = P.pdl
      stepIndex = 0
      credits = 0
      usd = 0
      reason = 'provider timeout · retried ×3'
    }

    const success = status === 'success' || status === 'cached'
    const meta: EnrichmentCellMeta = {
      status,
      providerId,
      stepIndex,
      runId: ENR.run1,
      confidence: success ? 0.9 : null,
      credits,
      fromCache,
      reason,
      fetchedAt: ENR_STAMP,
      valueSource: fromCache ? 'cache' : 'provider',
    }
    if (!success) emailCell.value = null
    emailCell.meta = { enrichment: meta }

    if (success) {
      const dMeta: EnrichmentCellMeta = {
        status: 'success',
        providerId: P.zerobounce,
        stepIndex: 2,
        runId: ENR.run1,
        confidence: 0.97,
        credits: fromCache ? 0 : 1,
        fromCache,
        fetchedAt: ENR_STAMP,
        valueSource: 'provider',
      }
      deliverableCells.push({ recordId: rid, columnId: 'col_co_deliverable', value: 'opt_d_deliverable', meta: { enrichment: dMeta } })
    }

    results.push({
      id: `enrres_${i}`,
      recordId: rid,
      columnId: 'col_co_email',
      runId: ENR.run1,
      providerId,
      stepIndex,
      status,
      valueJson: emailCell.value,
      confidence: meta.confidence ?? null,
      credits,
      providerCostUsd: usd,
      fromCache,
      reason,
      fetchedAt: ENR_STAMP,
    })
  }
  return { deliverableCells, results }
}

// ---------------------------------------------------------------------------
// AI columns (Phase 3) — a "one-line pitch" AI column over the Companies table.
// ---------------------------------------------------------------------------

// The signature single-shot AI column: summarize the company from its fields.
const pitchConfig: AiColumnConfig = {
  id: AI.config,
  columnId: 'col_co_pitch',
  model: { provider: 'anthropic', model: 'claude-haiku-4-5' },
  operation: 'summarize',
  promptTemplate: 'Write a one-line pitch for {{Company}} ({{Domain}}), a company with {{Employees}} employees.',
  outputSchema: [],
  outputMapping: {},
  cacheTtlDays: 30,
  autoRun: false,
  forceFreshDefault: false,
  credits: 1,
  providerCostUsd: 0.002,
}

const aiRuns: EnrichmentRun[] = [
  { id: AI.run1, workspaceId: WS.primary, tableId: T.companies, triggeredBy: U.admin, triggeredByName: 'Marcus Chen', scope: { mode: 'whole', columnIds: ['col_co_pitch'] }, forceFresh: false, status: 'complete', counts: { processed: 10, total: 10, success: 6, empty: 2, failed: 0, cached: 2 }, creditsConsumed: 6, providerCostUsd: 0.012, startedAt: '2026-07-06T10:00:00.000Z', finishedAt: '2026-07-06T10:00:20.000Z' },
]

// Net-zero grant/consume so the "by model" usage breakdown is demoable while the
// stored workspace balance stays exactly 18,240 (the enrichment test asserts it).
const aiLedger: CreditLedgerEntry[] = [
  { id: 'led_ai_grant', workspaceId: WS.primary, delta: 6, reason: 'grant:ai_seed', balanceAfter: 18246, createdAt: '2026-07-06T09:59:00.000Z' },
  { id: 'led_ai_1', workspaceId: WS.primary, delta: -6, reason: 'ai:claude-haiku-4-5:summarize', runId: AI.run1, balanceAfter: 18240, createdAt: '2026-07-06T10:00:15.000Z' },
]

const AI_STAMP = '2026-07-06T10:00:10.000Z'
const AI_PITCHES = [
  'AI-native GTM platform that turns raw signals into pipeline.',
  'Operator-first enrichment engine that keeps records fresh automatically.',
  'Developer-friendly revenue-intelligence suite that surfaces the next best action.',
  'Enterprise-grade prospecting workspace that scales outreach without the noise.',
  'Lightweight analytics layer that unifies scattered data.',
  'Purpose-built CRM companion that automates the busywork.',
]

// A warm cache entry (cacheStats + a plausible free hit for the demo).
const aiCache: AiCache[] = [
  { id: 'aicache_1', cacheKey: 'claude-haiku-4-5|summarize|Write a one-line pitch for Acme Analytics (acmeanalytics.com), a company with 240 employees.', modelKey: 'claude-haiku-4-5', operation: 'summarize', resultJson: { text: AI_PITCHES[0], structured: {}, confidence: 0.9 }, cost: 0.002, fetchedAt: '2026-07-06T09:00:00.000Z', expiresAt: '2027-07-01T00:00:00.000Z' },
]

/**
 * Overlay AI status onto the first 10 "AI: One-line pitch" cells so the grid
 * demonstrates the status system on first load, with matching provenance.
 */
function applyAiSeed(): { pitchCells: Cell[]; results: AiCellResult[] } {
  const successIdx = new Set([0, 1, 3, 4, 6, 8])
  const cachedIdx = new Set([2, 7])
  const pitchCells: Cell[] = []
  const results: AiCellResult[] = []
  let pitchI = 0
  for (let i = 0; i < 10; i++) {
    const rid = `rec_co_${String(i).padStart(3, '0')}`
    let status: EnrichmentCellStatus
    let credits: number
    let fromCache = false
    let reason: string | undefined
    let value: CellValue = null
    if (successIdx.has(i)) {
      status = 'success'
      credits = 1
      value = AI_PITCHES[pitchI++ % AI_PITCHES.length] ?? null
    } else if (cachedIdx.has(i)) {
      status = 'cached'
      credits = 0
      fromCache = true
      value = AI_PITCHES[pitchI++ % AI_PITCHES.length] ?? null
    } else {
      status = 'empty'
      credits = 0
      reason = 'no result'
    }
    const confidence = status === 'empty' ? null : 0.88
    const meta: AiCellMeta = {
      status,
      modelKey: 'claude-haiku-4-5',
      operation: 'summarize',
      runId: AI.run1,
      fieldName: null,
      confidence,
      credits,
      fromCache,
      reason,
      fetchedAt: AI_STAMP,
      valueSource: fromCache ? 'cache' : 'provider',
    }
    pitchCells.push({ recordId: rid, columnId: 'col_co_pitch', value, meta: { ai: meta } })
    results.push({
      id: `aires_${i}`,
      recordId: rid,
      columnId: 'col_co_pitch',
      runId: AI.run1,
      modelKey: 'claude-haiku-4-5',
      operation: 'summarize',
      status,
      valueJson: value,
      promptResolved: 'Write a one-line pitch for this company from its fields.',
      confidence,
      credits,
      providerCostUsd: fromCache ? 0 : credits * 0.002,
      fromCache,
      reason,
      fetchedAt: AI_STAMP,
    })
  }
  return { pitchCells, results }
}

// ---------------------------------------------------------------------------
// Phase 3 rest — agent + HTTP + formula column configs, plus a starter set of
// automations, webhooks, and integrations so /automations + /integrations are
// populated on first load. No credit-ledger impact (nothing is pre-run).
// ---------------------------------------------------------------------------

const segmentFormula: FormulaColumnConfig = {
  id: 'fx_co_segment',
  columnId: 'col_co_segment',
  expression: SEGMENT_EXPR,
}

const intelAgent: AgentColumnConfig = {
  id: 'agt_co_intel',
  columnId: 'col_co_intel',
  model: { provider: 'anthropic', model: 'claude-haiku-4-5' },
  objective: 'Research {{Company}} ({{Domain}}) and summarise recent funding, size, and notable news in one line.',
  outputSchema: [],
  outputMapping: {},
  maxSteps: 5,
  maxPages: 4,
  cacheTtlDays: 30,
  autoRun: false,
  forceFreshDefault: false,
  credits: 2,
  providerCostUsd: 0.008,
}

const hqHttp: HttpColumnConfig = {
  id: 'http_co_hq',
  columnId: 'col_co_hq',
  method: 'GET',
  urlTemplate: 'https://api.company-data.example/v1/lookup?domain={{Domain}}',
  headers: [{ key: 'Authorization', value: '••••7f2a', secretRef: 'sec_demo' }],
  bodyTemplate: '',
  responsePath: 'data.city',
  responseMapping: { industry: 'data.industry' },
  outputMapping: {},
  cacheTtlDays: 7,
  autoRun: false,
  forceFreshDefault: false,
  credits: 1,
  providerCostUsd: 0.0005,
}

const httpSecrets = [
  { id: 'sec_demo', workspaceId: WS.primary, name: 'Company Data API key', maskedHint: '••••7f2a', createdAt: CREATED },
]

const automations: Automation[] = [
  {
    id: 'auto_daily_intel',
    workspaceId: WS.primary,
    tableId: T.companies,
    name: 'Refresh company intel daily',
    trigger: 'schedule',
    action: 'run_column',
    targetColumnId: 'col_co_intel',
    forceFresh: false,
    schedule: { cadence: 'daily', hour: 7 },
    isEnabled: true,
    createdBy: U.admin,
    createdAt: CREATED,
    nextRunAt: '2026-07-12T07:00:00.000Z',
    lastRunAt: '2026-07-11T07:00:00.000Z',
    lastStatus: 'success',
  },
  {
    id: 'auto_enrich_new',
    workspaceId: WS.primary,
    tableId: T.companies,
    name: 'Enrich email on new rows',
    trigger: 'row_event',
    action: 'run_column',
    targetColumnId: 'col_co_email',
    forceFresh: false,
    rowEvent: { event: 'record.created' },
    isEnabled: true,
    createdBy: U.owner,
    createdAt: CREATED,
    nextRunAt: null,
    lastRunAt: '2026-07-10T16:20:00.000Z',
    lastStatus: 'success',
  },
]

const inboundWebhooks: InboundWebhook[] = [
  {
    id: 'wh_in_leads',
    workspaceId: WS.primary,
    tableId: T.companies,
    name: 'Website lead capture',
    slug: 'website-lead-a1b2c3',
    secretHint: '••••9x4k',
    mapping: { company: 'col_co_company', domain: 'col_co_domain', email: 'col_co_email' },
    isEnabled: true,
    createdAt: CREATED,
    lastReceivedAt: '2026-07-09T12:11:00.000Z',
    receivedCount: 14,
  },
]

const outboundWebhooks: OutboundWebhook[] = [
  {
    id: 'wh_out_signed',
    workspaceId: WS.primary,
    tableId: T.companies,
    name: 'Notify ops on signed deal',
    url: 'https://hooks.zapier.com/hooks/catch/demo/signed',
    event: 'record.updated',
    condition: { columnId: 'col_co_active', op: 'equals', value: 'true' },
    fieldColumnIds: ['col_co_company', 'col_co_mrr'],
    isEnabled: true,
    createdAt: CREATED,
    lastDeliveryAt: '2026-07-08T15:00:00.000Z',
    lastStatus: 'delivered',
    deliveredCount: 23,
    failedCount: 1,
  },
]

const crmConnections: CrmConnection[] = [
  {
    id: 'crm_hubspot',
    workspaceId: WS.primary,
    provider: 'hubspot',
    accountLabel: 'InsightsTap (hub-3391)',
    maskedToken: '••••b8e1',
    tableId: T.companies,
    fieldMapping: { name: 'col_co_company', domain: 'col_co_domain', numberofemployees: 'col_co_employees' },
    dedupeColumnId: 'col_co_domain',
    isConnected: true,
    createdAt: CREATED,
    lastSyncAt: '2026-07-10T08:00:00.000Z',
  },
]

const slackConnections: SlackConnection[] = [
  {
    id: 'slack_primary',
    workspaceId: WS.primary,
    teamName: 'InsightsTap',
    maskedToken: '••••x0aa',
    defaultChannel: '#gtm-signals',
    isConnected: true,
    createdAt: CREATED,
  },
]

const integrationEvents: IntegrationEvent[] = [
  { id: 'ie_1', workspaceId: WS.primary, source: 'crm', status: 'success', summary: 'HubSpot push: 41 created, 11 updated, 3 skipped', detail: { direction: 'push', created: 41, updated: 11, skipped: 3 }, tableId: T.companies, refId: 'crm_hubspot', createdAt: '2026-07-10T08:00:05.000Z' },
  { id: 'ie_2', workspaceId: WS.primary, source: 'schedule', status: 'success', summary: 'Refresh company intel daily: Queued 52 agent cells', detail: { automationId: 'auto_daily_intel' }, tableId: T.companies, refId: 'auto_daily_intel', createdAt: '2026-07-11T07:00:02.000Z' },
  { id: 'ie_3', workspaceId: WS.primary, source: 'webhook_in', status: 'success', summary: 'Website lead capture: created a row from inbound payload', detail: { webhookId: 'wh_in_leads', fields: 3 }, tableId: T.companies, refId: 'wh_in_leads', createdAt: '2026-07-09T12:11:00.000Z' },
  { id: 'ie_4', workspaceId: WS.primary, source: 'webhook_out', status: 'success', summary: 'Notify ops on signed deal → POST hooks.zapier.com (record.updated)', detail: { webhookId: 'wh_out_signed' }, tableId: T.companies, refId: 'wh_out_signed', createdAt: '2026-07-08T15:00:00.000Z' },
  { id: 'ie_5', workspaceId: WS.primary, source: 'slack', status: 'success', summary: 'Slack → #gtm-signals: New enterprise deal signed 🎉', detail: { channel: '#gtm-signals' }, createdAt: '2026-07-08T15:00:03.000Z' },
  { id: 'ie_6', workspaceId: WS.primary, source: 'webhook_out', status: 'failed', summary: 'Notify ops on signed deal → POST hooks.zapier.com — failed, will retry', detail: { webhookId: 'wh_out_signed', code: 503 }, tableId: T.companies, refId: 'wh_out_signed', createdAt: '2026-07-07T10:22:00.000Z' },
]

// ---------------------------------------------------------------------------
// SaaS billing + platform superadmin seed (Phase 4)
// ---------------------------------------------------------------------------

const PLAN = { free: 'plan_free', starter: 'plan_starter', growth: 'plan_growth', scale: 'plan_scale' } as const
const PU = { admin: 'pu_admin', support: 'pu_support' } as const
const PERIOD_END = '2026-07-25T00:00:00.000Z'

// Extra "customer" workspaces so the superadmin dashboard shows real MRR/margin.
const EXTRA_USERS: User[] = [
  { id: 'usr_north', email: 'lena@northwindlabs.com', name: 'Lena Fischer', emailVerified: true, createdAt: CREATED },
  { id: 'usr_zephyr', email: 'omar@zephyr.ai', name: 'Omar Haddad', emailVerified: true, createdAt: CREATED },
  { id: 'usr_acme', email: 'mira@acme.co', name: 'Mira Patel', emailVerified: true, createdAt: CREATED },
  { id: 'usr_globex', email: 'theo@globex.io', name: 'Theo Ionescu', emailVerified: true, createdAt: CREATED },
]
const EXTRA_WORKSPACES: Workspace[] = [
  { id: 'ws_north', name: 'Northwind Labs', ownerUserId: 'usr_north', createdAt: CREATED, status: 'active' },
  { id: 'ws_zephyr', name: 'Zephyr AI', ownerUserId: 'usr_zephyr', createdAt: CREATED, status: 'active' },
  { id: 'ws_acme', name: 'Acme Co', ownerUserId: 'usr_acme', createdAt: CREATED, status: 'active' },
  { id: 'ws_globex', name: 'Globex', ownerUserId: 'usr_globex', createdAt: CREATED, status: 'suspended' },
]
const EXTRA_MEMBERS: Member[] = EXTRA_WORKSPACES.map((w, i) => ({
  id: `mem_x${i}`,
  workspaceId: w.id,
  userId: w.ownerUserId,
  email: EXTRA_USERS[i]!.email,
  name: EXTRA_USERS[i]!.name,
  role: 'owner',
  status: 'active',
  invitedBy: null,
  createdAt: CREATED,
}))
const EXTRA_CREDITS: WorkspaceCredit[] = [
  { workspaceId: 'ws_north', balance: 16800, budgetCap: 20000, perRunCap: 5000 },
  { workspaceId: 'ws_zephyr', balance: 52000, budgetCap: 60000, perRunCap: 5000 },
  { workspaceId: 'ws_acme', balance: 140, budgetCap: 200, perRunCap: 100 },
  { workspaceId: 'ws_globex', balance: 3200, budgetCap: 5000, perRunCap: 2000 },
]
// Self-consistent ledger per extra workspace (grant → consumption → balance).
// Consumption uses `enrich:<key>:<op>` reasons so COGS/margin compute for real.
const EXTRA_LEDGER: CreditLedgerEntry[] = [
  { id: 'led_north_g', workspaceId: 'ws_north', delta: 20000, reason: 'plan:grant:seed', balanceAfter: 20000, createdAt: '2026-06-25T09:00:00.000Z' },
  { id: 'led_north_0', workspaceId: 'ws_north', delta: -2400, reason: 'enrich:pdl:person_enrich', balanceAfter: 17600, createdAt: '2026-07-05T10:00:00.000Z' },
  { id: 'led_north_1', workspaceId: 'ws_north', delta: -800, reason: 'enrich:hunter:find_email', balanceAfter: 16800, createdAt: '2026-07-06T10:00:00.000Z' },
  { id: 'led_zephyr_g', workspaceId: 'ws_zephyr', delta: 60000, reason: 'plan:grant:seed', balanceAfter: 60000, createdAt: '2026-06-25T09:00:00.000Z' },
  { id: 'led_zephyr_0', workspaceId: 'ws_zephyr', delta: -6000, reason: 'enrich:pdl:person_enrich', balanceAfter: 54000, createdAt: '2026-07-05T10:00:00.000Z' },
  { id: 'led_zephyr_1', workspaceId: 'ws_zephyr', delta: -2000, reason: 'enrich:zerobounce:verify_email', balanceAfter: 52000, createdAt: '2026-07-06T10:00:00.000Z' },
  { id: 'led_acme_g', workspaceId: 'ws_acme', delta: 200, reason: 'plan:grant:seed', balanceAfter: 200, createdAt: '2026-06-25T09:00:00.000Z' },
  { id: 'led_acme_c', workspaceId: 'ws_acme', delta: 100, reason: 'comp:onboarding goodwill', balanceAfter: 300, createdAt: '2026-07-02T14:00:00.000Z' },
  { id: 'led_acme_0', workspaceId: 'ws_acme', delta: -160, reason: 'enrich:hunter:find_email', balanceAfter: 140, createdAt: '2026-07-05T10:00:00.000Z' },
  { id: 'led_globex_g', workspaceId: 'ws_globex', delta: 5000, reason: 'plan:grant:seed', balanceAfter: 5000, createdAt: '2026-06-01T09:00:00.000Z' },
  { id: 'led_globex_0', workspaceId: 'ws_globex', delta: -1800, reason: 'enrich:pdl:person_enrich', balanceAfter: 3200, createdAt: '2026-06-20T10:00:00.000Z' },
]

const SUBSCRIPTIONS: Subscription[] = [
  { id: 'sub_insightstap', workspaceId: WS.primary, planId: PLAN.growth, stripeSubscriptionId: 'sub_mock_insightstap', status: 'active', currentPeriodEnd: PERIOD_END, cancelAtPeriodEnd: false, createdAt: CREATED },
  { id: 'sub_sdtc', workspaceId: WS.secondary, planId: PLAN.starter, stripeSubscriptionId: 'sub_mock_sdtc', status: 'active', currentPeriodEnd: PERIOD_END, cancelAtPeriodEnd: false, createdAt: CREATED },
  { id: 'sub_north', workspaceId: 'ws_north', planId: PLAN.growth, stripeSubscriptionId: 'sub_mock_north', status: 'active', currentPeriodEnd: PERIOD_END, cancelAtPeriodEnd: false, createdAt: CREATED },
  { id: 'sub_zephyr', workspaceId: 'ws_zephyr', planId: PLAN.scale, stripeSubscriptionId: 'sub_mock_zephyr', status: 'active', currentPeriodEnd: PERIOD_END, cancelAtPeriodEnd: false, createdAt: CREATED },
  { id: 'sub_acme', workspaceId: 'ws_acme', planId: PLAN.free, stripeSubscriptionId: 'sub_mock_acme', status: 'active', currentPeriodEnd: PERIOD_END, cancelAtPeriodEnd: false, createdAt: CREATED },
  { id: 'sub_globex', workspaceId: 'ws_globex', planId: PLAN.starter, stripeSubscriptionId: 'sub_mock_globex', status: 'canceled', currentPeriodEnd: '2026-07-01T00:00:00.000Z', cancelAtPeriodEnd: true, createdAt: CREATED },
]

function invoice(id: string, ws: string, start: string, end: string, amountUsd: number, label: string): Invoice {
  const lines: InvoiceLineItem[] = [{ label, amountUsd }]
  return { id, workspaceId: ws, stripeInvoiceId: `in_mock_${id}`, periodStart: `${start}T00:00:00.000Z`, periodEnd: `${end}T00:00:00.000Z`, amountUsd, status: 'paid', lines, createdAt: `${end}T00:05:00.000Z` }
}
const INVOICES: Invoice[] = [
  invoice('it_may', WS.primary, '2026-05-25', '2026-06-25', 299, 'Growth plan · monthly'),
  invoice('it_jun', WS.primary, '2026-06-25', '2026-07-25', 299, 'Growth plan · monthly'),
  invoice('sdtc_jun', WS.secondary, '2026-06-25', '2026-07-25', 99, 'Starter plan · monthly'),
  invoice('north_jun', 'ws_north', '2026-06-25', '2026-07-25', 299, 'Growth plan · monthly'),
  invoice('zephyr_jun', 'ws_zephyr', '2026-06-25', '2026-07-25', 799, 'Scale plan · monthly'),
]

const PURCHASES: CreditPurchase[] = [
  { id: 'cp_it_1', workspaceId: WS.primary, credits: 10000, amountUsd: 90, stripePaymentId: 'pi_mock_it1', createdAt: '2026-06-10T00:00:00.000Z' },
]

const PLATFORM_USERS: PlatformUser[] = [
  { id: PU.admin, email: 'ops@sdtcdigital.com', name: 'Nadia Osei', platformRole: 'admin', createdAt: CREATED },
  { id: PU.support, email: 'support@sdtcdigital.com', name: 'Ravi Menon', platformRole: 'support', createdAt: CREATED },
]

const PLATFORM_AUDIT: PlatformAuditEntry[] = [
  { id: 'pa_1', platformUserId: PU.admin, platformUserName: 'Nadia Osei', action: 'credit.comp', targetType: 'workspace', targetId: 'ws_acme', detail: { credits: 100, reason: 'onboarding goodwill' }, createdAt: '2026-07-02T14:00:00.000Z' },
  { id: 'pa_2', platformUserId: PU.admin, platformUserName: 'Nadia Osei', action: 'workspace.suspend', targetType: 'workspace', targetId: 'ws_globex', detail: { reason: 'payment failure after 3 retries' }, createdAt: '2026-07-03T09:30:00.000Z' },
  { id: 'pa_3', platformUserId: PU.support, platformUserName: 'Ravi Menon', action: 'plan.override', targetType: 'subscription', targetId: 'sub_north', detail: { to: 'Growth', reason: 'sales-assisted upgrade' }, createdAt: '2026-07-04T11:00:00.000Z' },
]

// ---------------------------------------------------------------------------
// Assemble the full seed
// ---------------------------------------------------------------------------

export function buildSeed(): StoreData {
  const data = emptyStoreData()

  const users: User[] = [
    { id: U.owner, email: 'aitools@insightstap.com', name: 'Aarav Shah', emailVerified: true, createdAt: CREATED },
    { id: U.admin, email: 'marcus.chen@insightstap.com', name: 'Marcus Chen', emailVerified: true, createdAt: CREATED },
    { id: U.member, email: 'dana.whitfield@insightstap.com', name: 'Dana Whitfield', emailVerified: true, createdAt: CREATED },
    { id: U.viewer, email: 'sam.okoye@insightstap.com', name: 'Sam Okoye', emailVerified: false, createdAt: CREATED },
  ]

  const workspaces: Workspace[] = [
    { id: WS.primary, name: 'InsightsTap', ownerUserId: U.owner, createdAt: CREATED },
    { id: WS.secondary, name: 'SDTC Digital', ownerUserId: U.admin, createdAt: CREATED },
  ]

  const members: Member[] = [
    { id: 'mem_1', workspaceId: WS.primary, userId: U.owner, email: 'aitools@insightstap.com', name: 'Aarav Shah', role: 'owner', status: 'active', invitedBy: null, createdAt: CREATED },
    { id: 'mem_2', workspaceId: WS.primary, userId: U.admin, email: 'marcus.chen@insightstap.com', name: 'Marcus Chen', role: 'admin', status: 'active', invitedBy: U.owner, createdAt: CREATED },
    { id: 'mem_3', workspaceId: WS.primary, userId: U.member, email: 'dana.whitfield@insightstap.com', name: 'Dana Whitfield', role: 'member', status: 'active', invitedBy: U.owner, createdAt: CREATED },
    { id: 'mem_4', workspaceId: WS.primary, userId: U.viewer, email: 'sam.okoye@insightstap.com', name: 'Sam Okoye', role: 'viewer', status: 'active', invitedBy: U.admin, createdAt: CREATED },
    // Second workspace: Marcus owns it, Aarav is an admin there.
    { id: 'mem_5', workspaceId: WS.secondary, userId: U.admin, email: 'marcus.chen@insightstap.com', name: 'Marcus Chen', role: 'owner', status: 'active', invitedBy: null, createdAt: CREATED },
    { id: 'mem_6', workspaceId: WS.secondary, userId: U.owner, email: 'aitools@insightstap.com', name: 'Aarav Shah', role: 'admin', status: 'active', invitedBy: U.admin, createdAt: CREATED },
  ]

  const invites: Invite[] = [
    { id: 'inv_1', workspaceId: WS.primary, email: 'jordan.lee@prospect.com', role: 'member', invitedBy: U.owner, status: 'pending', createdAt: CREATED },
    { id: 'inv_2', workspaceId: WS.primary, email: 'taylor.reed@prospect.io', role: 'viewer', invitedBy: U.admin, status: 'pending', createdAt: CREATED },
  ]

  const tables: TableMeta[] = [
    { id: T.companies, workspaceId: WS.primary, name: 'Companies', createdBy: U.owner, createdAt: CREATED },
    { id: T.contacts, workspaceId: WS.primary, name: 'Contacts', createdBy: U.owner, createdAt: CREATED },
    { id: T.pipeline, workspaceId: WS.primary, name: 'Pipeline', createdBy: U.member, createdAt: CREATED },
    { id: T.accounts, workspaceId: WS.secondary, name: 'Accounts', createdBy: U.admin, createdAt: CREATED },
  ]

  const columns: Column[] = [...companyColumns, ...contactColumns, ...pipelineColumns, ...accountColumns]

  const co = buildCompanies()
  const ct = buildContacts()
  const pl = buildPipeline()
  const ac = buildAccounts()

  const records = [...co.records, ...ct.records, ...pl.records, ...ac.records]
  const cells = [...co.cells, ...ct.cells, ...pl.cells, ...ac.cells]

  // Overlay enrichment status onto the Companies "Work email" column.
  const { deliverableCells, results } = applyEnrichmentSeed(cells)
  cells.push(...deliverableCells)
  // Overlay AI status onto the Companies "AI: One-line pitch" column.
  const { pitchCells, results: aiResults } = applyAiSeed()
  cells.push(...pitchCells)

  // A default view per table (undeletable, no filters/sorts).
  const views = tables.map((tbl) => ({
    id: `view_default_${tbl.id}`,
    tableId: tbl.id,
    name: 'All records',
    filters: emptyFilter(),
    sorts: [],
    columnState: columns
      .filter((c) => c.tableId === tbl.id)
      .map((c) => ({ columnId: c.id, visible: true, position: c.position, width: c.width })),
    isDefault: true,
  }))

  // Deep-clone so each MockApi instance owns its copy (the extras are shared
  // module-level templates; the platform panel mutates workspace.status etc.).
  data.users = clone([...users, ...EXTRA_USERS])
  data.workspaces = clone([...workspaces, ...EXTRA_WORKSPACES])
  data.members = clone([...members, ...EXTRA_MEMBERS])
  data.invites = invites
  data.tables = tables
  data.columns = columns
  data.records = records
  data.cells = cells
  data.views = views
  data.audit = []
  data.session = { userId: U.owner, workspaceId: WS.primary, token: 'mock-token', expiresAt: '2026-12-31T23:59:59.000Z' }

  // Enrichment engine state (Phase 2). Deep-clone the module-level templates so
  // each MockApi instance owns its own mutable copy (the engine deducts credits,
  // pushes ledger rows, and edits configs in place).
  data.providers = clone(PROVIDERS)
  data.providerCredentials = clone(providerCredentials)
  data.workspaceCredits = clone([...workspaceCredits, ...EXTRA_CREDITS])
  data.enrichmentConfigs = clone([emailConfig])
  data.enrichmentRuns = clone(enrichmentRuns)
  data.creditLedger = clone([...creditLedger, ...aiLedger, ...EXTRA_LEDGER])
  data.enrichmentCache = clone(enrichmentCache)
  data.enrichmentResults = results

  // AI columns (Phase 3).
  data.aiColumnConfigs = clone([pitchConfig])
  data.aiRuns = clone(aiRuns)
  data.aiResults = aiResults
  data.aiCache = clone(aiCache)

  // Agent + HTTP + formula columns (Phase 3 rest). No pre-run cells → no ledger
  // impact (the formula column is pre-computed in buildCompanies).
  data.agentColumnConfigs = clone([intelAgent])
  data.httpColumnConfigs = clone([hqHttp])
  data.httpSecrets = clone(httpSecrets)
  data.formulaColumnConfigs = clone([segmentFormula])

  // Automation + integration layer (Phase 3 rest).
  data.automations = clone(automations)
  data.inboundWebhooks = clone(inboundWebhooks)
  data.outboundWebhooks = clone(outboundWebhooks)
  data.crmConnections = clone(crmConnections)
  data.slackConnections = clone(slackConnections)
  data.integrationEvents = clone(integrationEvents)

  // SaaS billing + platform superadmin (Phase 4).
  data.plans = clone(PLANS)
  data.subscriptions = clone(SUBSCRIPTIONS)
  data.invoices = clone(INVOICES)
  data.creditPurchases = clone(PURCHASES)
  data.platformUsers = clone(PLATFORM_USERS)
  data.platformAudit = clone(PLATFORM_AUDIT)
  data.platformSession = null

  return data
}

/** Deep-clone plain seed data so instances never share mutable references. */
function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T
}

// ---------------------------------------------------------------------------
// Perf-row generator — synthesises up to ~100k believable rows for any table.
// ---------------------------------------------------------------------------

const GEN_COMPANY_SUFFIX = ['Labs', 'Systems', 'Cloud', 'Data', 'Works', 'Group', 'Digital', 'Technologies']
const GEN_COMPANY_ROOT = ['Nova', 'Apex', 'Vega', 'Lyra', 'Zeta', 'Orbit', 'Quanta', 'Helix', 'Pulse', 'Aster', 'Cobalt', 'Flint']

function genValue(rng: () => number, col: Column, i: number): CellValue {
  switch (col.type) {
    case 'text': {
      return `${pickOne(rng, GEN_COMPANY_ROOT)} ${pickOne(rng, GEN_COMPANY_SUFFIX)} ${i}`
    }
    case 'longText':
      return pickOne(rng, NOTES) || `Auto-generated record ${i} for load testing.`
    case 'number':
      return rint(rng, 1, 100000)
    case 'currency':
      return rint(rng, 10, 4000) * 25
    case 'boolean':
      return rng() > 0.5
    case 'date': {
      const y = 2023 + rint(rng, 0, 3)
      const m = rint(rng, 1, 12)
      const d = rint(rng, 1, 28)
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
    case 'url':
      return `https://gen-${i}.example.com`
    case 'email':
      return `user${i}@example.com`
    case 'phone':
      return `+1${pickOne(rng, AREA_CODES)}555${String(1000 + (i % 9000)).padStart(4, '0')}`
    case 'singleSelect': {
      const opts = (col.config as SingleSelectConfig).options
      return opts.length ? pickOne(rng, opts).id : null
    }
    case 'multiSelect': {
      const opts = (col.config as MultiSelectConfig).options
      if (!opts.length) return []
      const out: string[] = []
      const n = rint(rng, 0, Math.min(3, opts.length))
      while (out.length < n) {
        const id = pickOne(rng, opts).id
        if (!out.includes(id)) out.push(id)
      }
      return out
    }
    default:
      return null
  }
}

/**
 * Synthesise `n` rows (records + cells) for a table given its columns. Intended
 * for perf testing (up to ~100k). Values are valid for each column type per the
 * registry. `startPosition` continues numbering after existing rows.
 */
export function generateRows(
  tableId: string,
  columns: Column[],
  n: number,
  startPosition = 0,
): { records: RecordRow[]; cells: Cell[] } {
  const records: RecordRow[] = []
  const cells: Cell[] = []
  const cols = columns.filter((c) => c.tableId === tableId)
  for (let i = 0; i < n; i++) {
    const rng = mulberry32(0x9e3779b1 ^ (i + 1))
    const rid = `rec_gen_${tableId}_${i}`
    const pos = startPosition + i
    records.push({ id: rid, tableId, position: pos, createdAt: CREATED, updatedAt: NOW })
    for (const col of cols) {
      const value = genValue(rng, col, i)
      // Skip storing "empty" values to keep the dataset lean at scale.
      if (columnTypeRegistry[col.type].isEmpty(value)) continue
      cells.push(cell(rid, col.id, value))
    }
  }
  return { records, cells }
}

export const SEED_IDS = { U, WS, T, P, ENR, AI, PLAN, PU } as const
