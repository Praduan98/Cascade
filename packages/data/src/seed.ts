// Realistic seed data: 2 workspaces, 4 members spanning every role, 3 tables in
// the primary workspace (Companies with 60 rows, Contacts, Pipeline) plus an
// isolated table in the second workspace to demonstrate tenant separation.
// `generateRows` synthesises up to ~100k believable rows for perf testing.

import type {
  Cell,
  CellValue,
  Column,
  ColumnConfig,
  Invite,
  Member,
  MultiSelectConfig,
  RecordRow,
  SingleSelectConfig,
  TableMeta,
  User,
  Workspace,
} from '@cascade/core'
import { columnTypeRegistry, emptyFilter } from '@cascade/core'
import type { StoreData } from './store'
import { emptyStoreData } from './store'

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
  makeColumn('col_co_email', T.companies, 'Work email', { type: 'email' }, 3, { width: 210 }),
  makeColumn('col_co_verified', T.companies, 'Verified', { type: 'singleSelect', options: VERIFIED_OPTS }, 4, { width: 130 }),
  makeColumn('col_co_tags', T.companies, 'Tags', { type: 'multiSelect', options: TAG_OPTS }, 5, { width: 210 }),
  makeColumn('col_co_mrr', T.companies, 'MRR', { type: 'currency', currencyCode: 'USD', precision: 0 }, 6, { width: 130 }),
  makeColumn('col_co_signed', T.companies, 'Signed', { type: 'date', format: 'MMM D, YYYY' }, 7, { width: 150 }),
  makeColumn('col_co_phone', T.companies, 'Phone', { type: 'phone' }, 8, { width: 160 }),
  makeColumn('col_co_active', T.companies, 'Active', { type: 'boolean' }, 9, { width: 90 }),
  makeColumn('col_co_notes', T.companies, 'Notes', { type: 'longText' }, 10, { width: 280 }),
]

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

    cells.push(
      cell(rid, 'col_co_company', name),
      cell(rid, 'col_co_domain', `https://${domain}`),
      cell(rid, 'col_co_employees', rint(rng, 8, 8200)),
      cell(rid, 'col_co_email', `${pickOne(rng, EMAIL_PREFIX)}@${domain}`),
      cell(rid, 'col_co_verified', verified),
      cell(rid, 'col_co_tags', tags),
      cell(rid, 'col_co_mrr', rint(rng, 10, 1800) * 50),
      cell(rid, 'col_co_signed', signed),
      cell(rid, 'col_co_phone', i % 9 === 0 ? null : phone),
      cell(rid, 'col_co_active', i % 7 !== 0),
      cell(rid, 'col_co_notes', note === '' ? null : note),
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

  data.users = users
  data.workspaces = workspaces
  data.members = members
  data.invites = invites
  data.tables = tables
  data.columns = columns
  data.records = records
  data.cells = cells
  data.views = views
  data.audit = []
  data.session = { userId: U.owner, workspaceId: WS.primary, token: 'mock-token', expiresAt: '2026-12-31T23:59:59.000Z' }

  return data
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

export const SEED_IDS = { U, WS, T } as const
