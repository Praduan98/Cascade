import type { ReactNode } from 'react'

// Shared table icons + name→icon resolver, used by the sidebar nav and the
// tables gallery so both show the same semantic glyph per table.
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}
const TableIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M9 4v16" />
  </Icon>
)
// Semantic per-table icons: an office building for companies, a person for
// contacts, a funnel for a sales pipeline.
const CompaniesIcon = () => (
  <Icon>
    <path d="M3 21h18" />
    <path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
    <path d="M10 8h.01M14 8h.01M10 12h.01M14 12h.01M10 16h.01M14 16h.01" />
  </Icon>
)
const ContactsIcon = () => (
  <Icon>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" />
  </Icon>
)
const PipelineIcon = () => (
  <Icon>
    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
  </Icon>
)

/**
 * Tables are user-created, so choose a semantic icon from the table's name and
 * fall back to the generic table glyph for anything unrecognized.
 */
export function iconForTable(name: string): ReactNode {
  const n = name.toLowerCase()
  const has = (...keys: string[]) => keys.some((k) => n.includes(k))
  if (has('compan', 'account', 'organ', 'business', 'vendor', 'supplier')) return <CompaniesIcon />
  if (has('contact', 'people', 'person', 'lead', 'customer')) return <ContactsIcon />
  if (has('pipeline', 'deal', 'opportun', 'sales', 'funnel', 'stage')) return <PipelineIcon />
  return <TableIcon />
}
