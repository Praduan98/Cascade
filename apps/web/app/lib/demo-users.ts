// The four seeded demo identities, one per role in the primary workspace. Used
// by the sign-in screen and the "switch user" affordance so the demo can jump
// between owner / admin / member / viewer to exercise role gating end to end.
import { SEED_IDS } from '@cascade/data'

export interface DemoUser {
  id: string
  name: string
  email: string
  /** Their role in the primary (InsightsTap) workspace. */
  roleLabel: string
  /** Seeded verification state (the viewer is intentionally unverified). */
  verified: boolean
}

export const DEMO_USERS: DemoUser[] = [
  { id: SEED_IDS.U.owner, name: 'Aarav Shah', email: 'aitools@insightstap.com', roleLabel: 'Owner', verified: true },
  { id: SEED_IDS.U.admin, name: 'Marcus Chen', email: 'marcus.chen@insightstap.com', roleLabel: 'Admin', verified: true },
  { id: SEED_IDS.U.member, name: 'Dana Whitfield', email: 'dana.whitfield@insightstap.com', roleLabel: 'Member', verified: true },
  { id: SEED_IDS.U.viewer, name: 'Sam Okoye', email: 'sam.okoye@insightstap.com', roleLabel: 'Viewer', verified: false },
]
