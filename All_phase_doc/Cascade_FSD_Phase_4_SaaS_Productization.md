# Cascade — Functional Specification Document
## Phase 4: SaaS Productization — Billing, Superadmin, Outbound & Own-Data

| Field | Value |
|---|---|
| Phase | 4 of 4 |
| Depends on | Phases 1 to 3 (full internal platform: tables, enrichment, AI/automation, internal credit metering) |
| Enables | Commercial launch to external customers |
| Audience | Internal — SDTC Digital / InsightsTap |
| Version | 1.0 (Draft) |
| Date | July 2026 |

---

### 1. Phase Overview

Phase 4 turns the internal platform into a commercial multi-tenant SaaS. It adds self-serve signup and subscription plans, usage-based billing on top of the credit metering built in Phase 2, the platform superadmin panel (non-negotiable SaaS scope), a templates/recipes library so new users reach value quickly, outbound push to sequencing tools so enriched lists become campaigns, and the first own-data scrapers to reduce third-party dependency and protect margin.

By this phase the credit ledger, provider cost tracking, and per-operation metering already exist. Phase 4's billing work is primarily about selling and collecting against that meter, not rebuilding it.

---

### 2. Scope

#### 2.1 In scope

- **Self-serve signup and subscription plans:** public registration, tiered plans, plan selection and management via Stripe.
- **Usage-based billing:** credit packs and included monthly credits, metered consumption billed against the Phase 2 ledger, overage handling, invoices.
- **In-app billing surfaces:** credit balance, top-up/purchase, usage against plan, invoice history, upgrade/downgrade/cancel.
- **Superadmin / platform panel (non-negotiable):** cross-workspace user and workspace management, subscription oversight, refunds and comps, support tooling, platform analytics (MRR, churn, conversion, provider cost vs revenue margin), platform-level RBAC, and platform audit logs.
- **Templates / recipes library:** pre-built table + waterfall (+ AI/agent) templates users can instantiate.
- **Outbound push:** send enriched lists to sequencing tools (for example, Instantly, Smartlead, HeyReach), and/or export-ready outputs for campaigns.
- **Own-data sources (first scrapers):** begin first-party company/people search and enrichment to supplement or replace third-party providers within the existing waterfall framework.
- **Onboarding flow:** guided first-run experience to a working table.
- **Collaboration/sharing polish:** finalize permissions and sharing appropriate for external customers.

#### 2.2 Out of scope (deferred / future)

- Full replacement of all third-party providers with own data. Phase 4 introduces first-party scrapers as additional waterfall steps; broad coverage parity is an ongoing program.
- Native full email-sending infrastructure with deliverability tooling (warmup, inbox rotation). Phase 4 pushes to established sequencers rather than rebuilding that stack.
- Advanced enterprise features (SSO/SAML, granular custom roles, data residency options) unless prioritized later.
- A general visual automation canvas (still out of scope; the column-level automation from Phase 3 stands).

---

### 3. User Stories & Acceptance Criteria

Story IDs use the pattern `US-4.x`. New role: **Platform Superadmin** (SDTC staff).

---

**US-4.1 — Self-serve signup and plan selection**
As a prospective customer, I want to sign up and choose a plan, so that I can start using Cascade without sales involvement.

Acceptance criteria:
- A public signup flow creates an account, a workspace, and puts the user on a selected or default plan.
- Plans and their included credits, limits, and prices are presented clearly before selection.
- Paid plan selection collects payment via Stripe; the workspace's plan and entitlements update on successful payment.
- A free/trial entry path (if offered) is supported with its defined limits.
- Failed payment does not grant paid entitlements and shows a clear recovery path.

**US-4.2 — Purchase and consume credits (usage-based billing)**
As a Workspace Owner, I want to buy credits and have usage billed, so that I pay for what I enrich.

Acceptance criteria:
- Each plan includes a monthly credit allotment; consumption draws down the Phase 2 credit ledger.
- I can purchase additional credit packs; purchased credits are added to the balance and reflected immediately.
- Overage beyond included credits is handled per plan rules (blocked, or billed as overage) and the behavior is clearly communicated.
- Credit deductions from enrichment, AI, and agent operations (Phases 2 to 3) are the single source of truth for billing consumption.
- Billing consumption reconciles exactly with the ledger; there is no separate, divergent usage count.

**US-4.3 — View balance, usage, and invoices**
As a Workspace Owner, I want billing visibility, so that I can manage cost and reconcile charges.

Acceptance criteria:
- I can see current credit balance, credits included this period, and credits consumed (with the Phase 2 breakdowns by table/column/provider).
- I can see invoice history and download invoices.
- Usage displayed in-app matches what is billed.
- Upcoming renewal date and expected charge are visible.

**US-4.4 — Upgrade, downgrade, or cancel**
As a Workspace Owner, I want to change my plan, so that billing matches my needs.

Acceptance criteria:
- I can upgrade or downgrade; entitlements and pricing adjust per defined proration rules.
- I can cancel; access continues until the end of the paid period, after which entitlements drop to the free/limited tier or are suspended per policy.
- Plan changes are reflected in Stripe and in-app consistently.
- Downgrades that exceed the lower plan's limits are handled with a clear message (for example, over-limit workspaces are prompted to reduce usage).

**US-4.5 — Superadmin: manage workspaces and users**
As a Platform Superadmin, I want cross-workspace management, so that I can operate and support the platform.

Acceptance criteria:
- I can list, search, and open any workspace and its members.
- I can view a workspace's plan, credit balance, usage, and status.
- I can suspend or reactivate a workspace and deactivate a user, with each action written to the platform audit log.
- Superadmin access is restricted to authorized SDTC staff and is separate from workspace roles.
- Superadmin actions respect a documented policy on customer-data access and are fully audited.

**US-4.6 — Superadmin: subscription oversight, refunds, and comps**
As a Platform Superadmin, I want to manage billing situations, so that I can handle support and exceptions.

Acceptance criteria:
- I can view a workspace's subscription and billing status.
- I can issue a refund or apply complimentary credits/plan adjustments, with a required reason.
- Every refund/comp is recorded in the platform audit log with actor, amount, reason, and timestamp.
- Refunds reconcile with Stripe; comped credits appear correctly in the workspace's ledger.

**US-4.7 — Superadmin: platform analytics**
As a Platform Superadmin, I want platform metrics, so that I can track business health and margin.

Acceptance criteria:
- I can see MRR, active/churned workspaces, conversion (trial/free to paid), and credit consumption trends.
- I can see aggregate provider/LLM cost vs revenue (margin), using the cost data captured since Phase 2.
- Metrics are date-range filterable.
- Analytics are visible only to Superadmin.

**US-4.8 — Platform RBAC and audit**
As a Platform Superadmin, I want platform-level roles and an audit trail, so that internal access is controlled and accountable.

Acceptance criteria:
- Platform roles gate superadmin capabilities (for example, support vs full-admin) per a defined matrix.
- All superadmin actions (workspace suspend, user deactivate, refund, comp, data access) write to an append-only platform audit log.
- The platform audit log is viewable by authorized platform roles and cannot be edited or deleted in-app.

**US-4.9 — Bootstrap a table from a template**
As a Member, I want to start from a template, so that I reach a working setup quickly.

Acceptance criteria:
- I can browse a library of templates (table structure plus pre-configured enrichment waterfalls and, where relevant, AI/agent columns).
- Instantiating a template creates a table with the columns and configured columns ready to run.
- Templates that consume credits when run make that clear before the user runs them.
- The template library is curated and can be extended by SDTC over time.

**US-4.10 — Push a list to an outbound sequencer**
As a Member, I want to send enriched contacts to a sequencing tool, so that lists become live campaigns.

Acceptance criteria:
- I can connect a supported sequencer (for example, Instantly, Smartlead, HeyReach) via its API/authorization.
- I can map columns to the sequencer's expected fields and push selected rows to a chosen campaign/list.
- The push reports created/failed counts and records the result in history.
- Only rows meeting a chosen condition (for example, verified-deliverable email) can be pushed if I set that filter.

**US-4.11 — Enrich from a first-party (own) data source**
As a Member, I want to use Cascade's own company/people search, so that I depend less on third-party providers.

Acceptance criteria:
- One or more first-party sources (own company/people search and enrichment) are available as steps within the existing waterfall framework, alongside third-party providers.
- Own-source results carry provenance ("Cascade data") like any provider and are metered per their defined credit rate.
- Own sources participate in waterfalls (ordering, fall-through, acceptance conditions) with no change to the orchestration engine.
- Data quality/coverage of own sources is monitored so waterfalls can prefer the cheapest sufficient source.

**US-4.12 — Guided onboarding to first value**
As a new customer, I want guided onboarding, so that I can build and run my first enrichment quickly.

Acceptance criteria:
- First run presents a short guided path: create or import a table, add an enrichment/waterfall (or pick a template), run it, see results.
- Onboarding surfaces how credits work and where to see usage.
- Onboarding can be skipped and revisited.
- Completion leads to a working table with real results.

**US-4.13 — Cost/margin guardrails per plan**
As a Platform Superadmin, I want plan-level guardrails, so that no plan can be operated at a loss through excessive metered usage.

Acceptance criteria:
- Each plan defines included credits and overage behavior; metered consumption cannot silently exceed entitlements without either blocking or billing.
- Provider/LLM cost per operation remains visible to the platform so pricing can be tuned (reuses Phase 2 cost data).
- Alerts surface workspaces whose usage pattern approaches negative margin under their plan.

**US-4.14 — Sharing and permissions for external customers**
As a Workspace Owner, I want appropriate sharing and permissions, so that my team collaborates safely on a paid workspace.

Acceptance criteria:
- The Phase 1 role model (Owner/Admin/Member/Viewer) is confirmed and, where needed, refined for external use.
- Seat/member limits per plan are enforced; exceeding them prompts an upgrade.
- Sharing respects tenant isolation; no share mechanism can expose data across workspaces.

---

### 4. Functional Requirements (supplementary)

- **FR-4.1** Billing consumption derives solely from the Phase 2 credit ledger; there is exactly one usage source of truth, and invoices reconcile to it.
- **FR-4.2** The superadmin panel is a distinct, access-controlled surface; superadmin capability is never granted through workspace roles.
- **FR-4.3** All superadmin and billing-exception actions are audited append-only (US-4.6, US-4.8).
- **FR-4.4** Own-data sources implement the Phase 2 provider adapter contract so they slot into waterfalls with no orchestration change (FR-2.1/FR-2.2 continue to hold).
- **FR-4.5** Outbound sequencer connectors reuse the Phase 3 integration pattern (auth storage, retry/backoff, event logging).
- **FR-4.6** Plan entitlements (credits, seats, feature access) are data-driven so plans can be adjusted without code changes.

---

### 5. Data Model Additions (introduced this phase)

- **plan** (id, name, price, included_credits, seat_limit, entitlements_json, overage_policy)
- **subscription** (id, workspace_id, plan_id, stripe_subscription_id, status, current_period_end)
- **credit_purchase** (id, workspace_id, credits, amount, stripe_payment_id, created_at)
- **invoice** (id, workspace_id, stripe_invoice_id, amount, period, status, created_at)
- **platform_user** (id, email, platform_role) — SDTC staff, separate from workspace `user`.
- **platform_audit_log** (id, platform_user_id, action, target_type, target_id, detail_json, created_at)
- **template** (id, name, category, definition_json, is_published) — table + column/waterfall/AI configuration.
- **sequencer_connection** (id, workspace_id, provider, encrypted_token, config_json)
- **sequencer_push_run** (id, sequencer_connection_id, campaign_ref, counts_json, created_at)
- **own_source** (registered as a `provider` row from Phase 2, category "first_party") plus supporting data stores for scraped datasets.

Billing reuses the Phase 2 `credit_ledger` as the consumption source of truth; `plan`/`subscription`/`credit_purchase` govern what feeds and draws that ledger.

---

### 6. Technical Notes (internal)

**Billing and metering.** Stripe handles subscriptions, payment, and invoices. For usage-based credit billing on top of the Phase 2 ledger:
- **Stripe** (Billing, and Stripe usage/meter features) — mature, our default for subscriptions and payment.
- Dedicated usage-metering platforms if complexity grows: **Lago** (open-source, self-hostable), **Orb**, or **Metronome** — established options for usage-based billing at scale. Emerging/enterprise-leaning; adopt only if Stripe-native metering proves insufficient.
Recommendation: Stripe for subscriptions plus our own ledger as the metering truth, mapping consumption to Stripe for invoicing; evaluate Lago/Orb only if metering needs outgrow that.

**Superadmin panel.** Build as a separate, access-gated application area backed by `platform_user`/`platform_role`, never reachable via workspace roles. It surfaces cross-workspace management, subscription oversight, refunds/comps, support tooling, and the analytics in US-4.7. All actions are audited. Customer-data access by superadmins follows a documented policy and is logged.

**Analytics.** MRR, churn, conversion, and margin are computed from `subscription`, `invoice`, `credit_ledger`, and the provider/LLM cost captured since Phase 2. Provide date-range filtering. Keep queries off the transactional hot path (read replica or a lightweight reporting layer) as volume grows.

**Templates.** Store template definitions as serialized table+column configuration (`definition_json`) that the instantiation routine expands into real tables and configured columns. Curate an initial set (for example, "find company + waterfall email + verify," "research companies with the agent").

**Outbound sequencers.** Integrate via each tool's API (Instantly, Smartlead, HeyReach). Reuse Phase 3 connector patterns for auth, retry, and logging. Support pushing filtered rows (for example, verified-deliverable only).

**Own scrapers (first-party data).** Implement first-party company/people search/enrichment behind the Phase 2 adapter contract so they act as ordinary waterfall steps. Assess legal/ToS and compliance for each source independently before production. Prioritize sources where owning the data materially improves margin or coverage over third parties. Treat this as the start of an ongoing data program, not a one-off.

**Milestone/commercial note.** When this platform is scoped as a client-facing SaaS engagement, payment milestones follow the studio standard: front-heavy, with the final milestone the smallest invoice (about 10 to 15% of total) and the heaviest invoice mid-project. That structuring is a commercial/estimate concern handled in the proposal, not in this FSD.

---

### 7. Dependencies & Assumptions

- Phases 1 to 3 are complete and stable, especially the credit ledger and provider cost capture, which billing depends on entirely.
- A Stripe account and products/prices are configured for the plan set.
- Sequencer developer accounts (Instantly/Smartlead/HeyReach) are available for integration.
- First-party scraping sources have passed legal/ToS review before production use.
- Plan definitions (credits, seats, prices, overage behavior) are finalized by the business before build of billing surfaces.

---

### 8. Non-Functional Requirements

- **Billing correctness:** invoices reconcile exactly to the credit ledger; no divergent usage source (FR-4.1).
- **Access control:** superadmin strictly separated from workspace roles and fully audited (FR-4.2, US-4.8).
- **Margin protection:** provider/LLM cost visible per operation and per plan; guardrails prevent silent loss-making usage (US-4.13).
- **Isolation continuity:** all new SaaS surfaces (billing, templates, sequencers, superadmin) preserve tenant isolation and are re-tested.
- **Scalability:** analytics and metering scale with customer and usage growth without degrading the operator experience.

---

### 9. Indicative Effort (planning-level)

| Discipline | Hours | Basis |
|---|---|---|
| Design | 70 | Signup/billing surfaces, superadmin panel, templates gallery, onboarding, sequencer config |
| Development | 420 | Stripe subscriptions + usage billing on the ledger, superadmin (management/oversight/refunds/analytics/RBAC/audit), templates, sequencer connectors, first own-data sources, onboarding |
| QA | 98 | 20% of Design+Dev; includes billing reconciliation, superadmin access-control, refund/comp, and margin-guardrail testing |
| PM | 49 | 10% of Design+Dev |
| **Total** | **~637** | Indicative; own-data source count and billing complexity are the main swing factors |

Superadmin scope (user management, subscription oversight, support tools, refunds/comps, MRR/churn/conversion analytics, RBAC, audit logs) is treated as non-negotiable SaaS scope and is included above. Each additional own-data source or sequencer connector is incremental and estimated separately.
