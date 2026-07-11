// Subscription plan catalog + credit packs (Phase 4). The DATA layer owns the
// concrete list (data-driven so plans change without code — FR-4.6); the Plan
// *type* lives in @cascade/core. Mirrors PROVIDERS / AI_MODELS.

import type { Plan } from '@cascade/core'

/** One-off credit top-up packs (bulk-discounted). */
export const CREDIT_PACKS: { id: string; credits: number; amountUsd: number }[] = [
  { id: 'pack_5k', credits: 5_000, amountUsd: 50 },
  { id: 'pack_25k', credits: 25_000, amountUsd: 200 },
  { id: 'pack_100k', credits: 100_000, amountUsd: 700 },
]

export const PLANS: Plan[] = [
  {
    id: 'plan_free',
    tier: 'free',
    name: 'Free',
    priceUsdMonthly: 0,
    includedCredits: 200,
    seatLimit: 2,
    overagePolicy: 'block',
    overageUsdPerCredit: 0,
    entitlements: { aiColumns: false, prioritySupport: false, sso: false },
    blurb: 'Kick the tires on a single table.',
    features: ['200 credits / month', '2 seats', 'Enrichment waterfalls', 'CSV import & export'],
  },
  {
    id: 'plan_starter',
    tier: 'starter',
    name: 'Starter',
    priceUsdMonthly: 99,
    includedCredits: 5_000,
    seatLimit: 3,
    overagePolicy: 'block',
    overageUsdPerCredit: 0,
    entitlements: { aiColumns: true, prioritySupport: false, sso: false },
    blurb: 'For a founder-led GTM motion.',
    features: ['5,000 credits / month', '3 seats', 'AI columns', 'Email verification'],
  },
  {
    id: 'plan_growth',
    tier: 'growth',
    name: 'Growth',
    priceUsdMonthly: 299,
    includedCredits: 20_000,
    seatLimit: 10,
    overagePolicy: 'bill',
    overageUsdPerCredit: 0.02,
    entitlements: { aiColumns: true, prioritySupport: true, sso: false },
    blurb: 'For a scaling revenue team.',
    features: ['20,000 credits / month', '10 seats', 'Overage billing', 'Priority support'],
  },
  {
    id: 'plan_scale',
    tier: 'scale',
    name: 'Scale',
    priceUsdMonthly: 799,
    includedCredits: 60_000,
    seatLimit: 25,
    overagePolicy: 'bill',
    overageUsdPerCredit: 0.015,
    entitlements: { aiColumns: true, prioritySupport: true, sso: true },
    blurb: 'For a data-driven org at volume.',
    features: ['60,000 credits / month', '25 seats', 'SSO (SAML)', 'Volume overage rate'],
  },
]

const BY_ID = new Map(PLANS.map((p) => [p.id, p] as const))

export function planById(id: string): Plan | undefined {
  return BY_ID.get(id)
}

export function planByTier(tier: Plan['tier']): Plan | undefined {
  return PLANS.find((p) => p.tier === tier)
}
