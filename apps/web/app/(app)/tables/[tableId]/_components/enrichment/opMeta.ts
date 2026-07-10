import type { EnrichmentOperation, Provider } from '@cascade/core'
import type { ProviderRef } from '@cascade/ui'

/** UI metadata for each provider operation: its input + output field names. */
export const OP_META: Record<EnrichmentOperation, { label: string; inputs: string[]; outputs: string[] }> = {
  person_enrich: { label: 'Person enrich', inputs: ['domain', 'first_name', 'last_name'], outputs: ['email'] },
  company_enrich: { label: 'Company enrich', inputs: ['domain'], outputs: ['employees'] },
  find_email: { label: 'Find email', inputs: ['domain', 'full_name'], outputs: ['email'] },
  verify_email: { label: 'Verify email', inputs: ['email'], outputs: ['deliverable'] },
  find_phone: { label: 'Find phone', inputs: ['domain', 'full_name'], outputs: ['phone'] },
}

export const ACCEPTANCE_LABEL: Record<string, string> = {
  empty: 'accept any result',
  nonEmptyField: 'accept if field is non-empty',
  minConfidence: 'accept above confidence',
  verifyDeliverable: 'accept only if deliverable',
}

/** The operations a provider offers (keys of its cost config). */
export function providerOperations(provider: Provider): EnrichmentOperation[] {
  return Object.keys(provider.costConfig) as EnrichmentOperation[]
}

/** Map a data-layer Provider to the UI's plain ProviderRef. */
export function toProviderRef(provider: Provider): ProviderRef {
  return { glyph: provider.glyph, name: provider.name, color: provider.monoColor }
}
