// Template catalog (Phase 4, US-4.9). The DATA layer owns the curated library —
// each entry is a serialized table + column recipe (with enrichment / AI / agent
// configured by column NAME). MockApi.templates.instantiate expands one into a
// real table with configured columns ready to run. Provider/model keys resolve
// on instantiate; nothing here consumes credits until the user runs it.

import type { Template } from '@cascade/core'

const HAIKU = { provider: 'anthropic' as const, model: 'claude-haiku-4-5' }

export const TEMPLATES: Template[] = [
  {
    id: 'tpl_company_email',
    name: 'Find & verify company emails',
    summary: 'Companies with a waterfall that finds a work email (People Data Labs → Hunter) and verifies deliverability (ZeroBounce).',
    category: 'sales',
    glyph: 'CE',
    accent: '#3f6fe0',
    tags: ['Waterfall', 'Email', 'Verify'],
    tableName: 'Company emails',
    creditsPerRow: 6,
    columns: [
      { name: 'Company', type: 'text', frozen: true, width: 200 },
      { name: 'Domain', type: 'url', width: 190 },
      { name: 'Work email', type: 'email', width: 230 },
      { name: 'Deliverable', type: 'text', width: 150 },
    ],
    enrichment: [
      {
        columnName: 'Work email',
        autoRun: false,
        steps: [
          { providerKey: 'pdl', operation: 'person_enrich', inputMapping: { domain: 'Domain' }, outputMapping: { email: 'Work email' }, acceptanceCondition: 'nonEmptyField', acceptField: 'email' },
          { providerKey: 'hunter', operation: 'find_email', inputMapping: { domain: 'Domain' }, outputMapping: { email: 'Work email' }, acceptanceCondition: 'nonEmptyField', acceptField: 'email' },
        ],
      },
      {
        columnName: 'Deliverable',
        autoRun: false,
        steps: [
          { providerKey: 'zerobounce', operation: 'verify_email', inputMapping: { email: 'Work email' }, outputMapping: { deliverable: 'Deliverable' }, acceptanceCondition: 'verifyDeliverable' },
        ],
      },
    ],
    sampleRows: [
      { Company: 'Northwind Labs', Domain: 'https://northwind.com' },
      { Company: 'Zephyr Systems', Domain: 'https://zephyr.io' },
      { Company: 'Acme Analytics', Domain: 'https://acmeanalytics.com' },
      { Company: 'Globex', Domain: 'https://globex.com' },
      { Company: 'Umbra AI', Domain: 'https://umbra.ai' },
    ],
  },
  {
    id: 'tpl_agent_research',
    name: 'Research companies with the agent',
    summary: 'Companies with a web-research agent column that summarizes funding, size and recent news per row — with cited sources.',
    category: 'research',
    glyph: 'AR',
    accent: '#6c9bff',
    tags: ['Agent', 'Research', 'Citations'],
    tableName: 'Company research',
    creditsPerRow: 2,
    columns: [
      { name: 'Company', type: 'text', frozen: true, width: 200 },
      { name: 'Domain', type: 'url', width: 190 },
      { name: 'Company intel', type: 'agent', width: 320 },
      { name: 'Segment', type: 'formula', width: 140 },
      { name: 'Employees', type: 'number', width: 120 },
    ],
    agent: [
      {
        columnName: 'Company intel',
        model: HAIKU,
        objective: 'Research {{Company}} ({{Domain}}) and summarise recent funding, size, and notable news in one line.',
        maxSteps: 5,
        maxPages: 4,
      },
    ],
    formula: [
      { columnName: 'Segment', expression: 'IF({{Employees}} > 500, "Enterprise", IF({{Employees}} > 50, "Mid-market", "SMB"))' },
    ],
    sampleRows: [
      { Company: 'Northwind Labs', Domain: 'https://northwind.com', Employees: 340 },
      { Company: 'Zephyr Systems', Domain: 'https://zephyr.io', Employees: 90 },
      { Company: 'Acme Analytics', Domain: 'https://acmeanalytics.com', Employees: 24 },
    ],
  },
  {
    id: 'tpl_ai_lead_scoring',
    name: 'AI lead scoring',
    summary: 'Leads with an AI column that classifies fit and a formula that segments accounts by size — no third-party providers.',
    category: 'sales',
    glyph: 'LS',
    accent: '#3f6fe0',
    tags: ['AI', 'Formula', 'Scoring'],
    tableName: 'Lead scoring',
    creditsPerRow: 1,
    columns: [
      { name: 'Company', type: 'text', frozen: true, width: 200 },
      { name: 'Domain', type: 'url', width: 190 },
      { name: 'Employees', type: 'number', width: 120 },
      { name: 'Fit', type: 'ai', width: 160 },
      { name: 'Segment', type: 'formula', width: 140 },
    ],
    ai: [
      {
        columnName: 'Fit',
        model: HAIKU,
        operation: 'classify',
        promptTemplate: 'Classify the ICP fit of {{Company}} ({{Domain}}, {{Employees}} employees) as High, Medium or Low.',
      },
    ],
    formula: [
      { columnName: 'Segment', expression: 'IF({{Employees}} > 500, "Enterprise", IF({{Employees}} > 50, "Mid-market", "SMB"))' },
    ],
    sampleRows: [
      { Company: 'Northwind Labs', Domain: 'https://northwind.com', Employees: 340 },
      { Company: 'Zephyr Systems', Domain: 'https://zephyr.io', Employees: 90 },
      { Company: 'Acme Analytics', Domain: 'https://acmeanalytics.com', Employees: 24 },
      { Company: 'Globex', Domain: 'https://globex.com', Employees: 1200 },
    ],
  },
  {
    id: 'tpl_recruit_people',
    name: 'Enrich people for outreach',
    summary: 'People with a waterfall that finds a work email and a direct phone (People Data Labs → LeadMagic) — ready to push to a sequencer.',
    category: 'recruiting',
    glyph: 'PE',
    accent: '#1f9d63',
    tags: ['Waterfall', 'Email', 'Phone'],
    tableName: 'People outreach',
    creditsPerRow: 7,
    columns: [
      { name: 'Name', type: 'text', frozen: true, width: 180 },
      { name: 'Company', type: 'text', width: 170 },
      { name: 'Domain', type: 'url', width: 180 },
      { name: 'Work email', type: 'email', width: 230 },
      { name: 'Direct phone', type: 'phone', width: 170 },
    ],
    enrichment: [
      {
        columnName: 'Work email',
        steps: [
          { providerKey: 'pdl', operation: 'person_enrich', inputMapping: { domain: 'Domain', name: 'Name' }, outputMapping: { email: 'Work email' }, acceptanceCondition: 'nonEmptyField', acceptField: 'email' },
        ],
      },
      {
        columnName: 'Direct phone',
        steps: [
          { providerKey: 'leadmagic', operation: 'find_phone', inputMapping: { domain: 'Domain', name: 'Name' }, outputMapping: { phone: 'Direct phone' }, acceptanceCondition: 'nonEmptyField', acceptField: 'phone' },
        ],
      },
    ],
    sampleRows: [
      { Name: 'Jordan Okoye', Company: 'Northwind Labs', Domain: 'https://northwind.com' },
      { Name: 'Rosa Silva', Company: 'Zephyr Systems', Domain: 'https://zephyr.io' },
      { Name: 'Marco Reyes', Company: 'Acme Analytics', Domain: 'https://acmeanalytics.com' },
    ],
  },
  {
    id: 'tpl_blank_companies',
    name: 'Blank companies table',
    summary: 'A clean company table (Company, Domain, Employees, Notes) with no configured columns — start from scratch.',
    category: 'operations',
    glyph: '＋',
    accent: '#5f7488',
    tags: ['Starter'],
    tableName: 'Companies',
    creditsPerRow: 0,
    columns: [
      { name: 'Company', type: 'text', frozen: true, width: 200 },
      { name: 'Domain', type: 'url', width: 190 },
      { name: 'Employees', type: 'number', width: 120 },
      { name: 'Notes', type: 'longText', width: 280 },
    ],
    sampleRows: [
      { Company: 'Northwind Labs', Domain: 'https://northwind.com', Employees: 340 },
      { Company: 'Zephyr Systems', Domain: 'https://zephyr.io', Employees: 90 },
    ],
  },
]

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id)
}
