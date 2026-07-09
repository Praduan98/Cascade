# Cascade — Functional Specification Document (FSD)
## 00. Program Overview & Phasing Index

| Field | Value |
|---|---|
| Product (working codename) | **Cascade** (rename at productization; codename reflects the waterfall enrichment core) |
| Product type | GTM data enrichment & prospecting platform (a lean Clay alternative) |
| Build model | In-house SaaS first, productized for external customers in Phase 4 |
| Audience for this document | Internal — SDTC Digital / InsightsTap engineering, QA, and PM |
| Prepared by | SDTC Digital (InsightsTap) — Engineering |
| Technical owner | Swarnendu De (CTO) |
| Version | 1.0 (Draft) |
| Date | July 2026 |

---

### 1. Purpose

This FSD specifies a lean-core Clay alternative for internal use, engineered so it can later be turned into a commercial multi-tenant SaaS. It is split into four self-contained phase documents. Each phase file carries its own scope, user stories, acceptance criteria, functional requirements, data model additions, technical notes, and an indicative effort table.

The guiding product decisions (agreed upfront):

1. **Lean core first.** We are not chasing full Clay parity. Phase 1 and Phase 2 deliver the two things that actually make Clay valuable: a spreadsheet-style data grid and a multi-provider enrichment waterfall. Everything else stacks on top.
2. **In-house first, SaaS later.** Phases 1 to 3 are an internal operator tool for our own lead-gen and delivery work. Phase 4 productizes it (self-serve signup, usage-based billing, superadmin, outbound push).
3. **Third-party providers first, own data later.** Enrichment begins by orchestrating external provider APIs (with cost passthrough). We build our own scrapers only in Phase 4 to reduce provider dependency and margin leakage.

---

### 2. What Clay does (condensed), and how we decompose it

Clay's capability surface, distilled to the pieces that matter for phasing:

- **Tables + grid.** A spreadsheet paradigm: workbooks contain tables; tables contain records (rows) and columns (typed cells). This is the primary interaction surface. → **Phase 1**
- **Waterfall enrichment.** Ordered provider fallback: run provider A, and only if it returns nothing, run provider B, then C, to maximize coverage and minimize spend. Per-cell async status. → **Phase 2**
- **Provider ecosystem.** 150+ integrated data sources for people, company, email, phone, technographic, and intent data. We start with a small, high-value subset. → **Phase 2**
- **AI columns + Claygent.** LLM-powered columns and a web-research agent that browses/scrapes and returns structured data from a prompt. → **Phase 3**
- **Automation & integrations.** HTTP columns, formulas, triggers, scheduling, webhooks, CRM push/pull, Slack. → **Phase 3**
- **Credit metering + billing + templates + outbound + collaboration.** Usage-based credits, superadmin, plan tiers, recipe templates, sequencer push. → **Phase 4**

---

### 3. Phase map

| Phase | Title | Core outcome | Indicative effort (D / Dev / QA / PM) | Phase total |
|---|---|---|---|---|
| 1 | Foundation: Data Tables, Grid, Workspaces & Auth | The container: multi-tenant workspaces and an editable, virtualized data grid with typed columns, CSV in/out, views. | 60 / 320 / 76 / 38 | ~494h |
| 2 | Enrichment Engine: Providers & Waterfall | The differentiator: pluggable provider adapters, waterfall orchestration, async per-cell status, credit metering, caching. | 50 / 360 / 82 / 41 | ~533h |
| 3 | Intelligence & Automation | AI columns, a web-research agent (Claygent alternative), HTTP/formula columns, triggers, webhooks, CRM sync. | 40 / 340 / 76 / 38 | ~494h |
| 4 | SaaS Productization | Self-serve signup, usage-based billing, superadmin panel, templates, outbound push, first own-data scrapers. | 70 / 420 / 98 / 49 | ~637h |
| | **Program total (indicative)** | | **220 / 1,440 / 332 / 166** | **~2,158h** |

QA is fixed at 20% of Design+Dev; PM at 10% of Design+Dev, per studio standard. Figures above are planning-level ranges for sequencing decisions, not a line-item estimate. A detailed per-feature estimate is a separate deliverable produced once Phase 1 scope is locked.

---

### 4. Roles / personas (referenced across all phases)

| Role | Description | Introduced |
|---|---|---|
| **Member** | Operator who builds tables, runs enrichment, works the data. Our RevOps/lead-gen and delivery teams internally; the paying end user externally. | Phase 1 |
| **Workspace Admin** | Manages workspace members, roles, provider API keys, and credit budget for their workspace. | Phase 1 |
| **Workspace Owner** | Billing and ownership authority for a workspace (external SaaS). Superset of Admin. | Phase 1 (rights expanded in Phase 4) |
| **Developer / Integrator** | Uses the platform API, webhooks, and HTTP columns to integrate external systems. | Phase 3 |
| **Platform Superadmin** | SDTC staff. Cross-workspace management, subscription oversight, refunds/comps, platform analytics. Non-negotiable SaaS scope. | Phase 4 |

---

### 5. Target technical stack (internal reference)

Production stack per studio standard: FastAPI (Python) for the API and orchestration, Next.js for the frontend, Supabase/PostgreSQL for data and auth with row-level security for tenant isolation, Redis for caching and rate-limit state, Celery for background enrichment jobs, Docker and AWS for deployment, and Claude / OpenAI / Gemini for AI columns. Provider integrations begin with a small adapter set (Phase 2); the data grid uses a virtualized commercial or permissively licensed grid component (evaluated in Phase 1, see that file). Billing/metering tooling is selected in Phase 4.

Detailed tooling shortlists (mature vs emerging, with trade-offs) for the grid component, provider APIs, orchestration engine, AI-research stack, and billing/metering live inside the relevant phase files.

---

### 6. Cross-cutting non-functional requirements (apply to every phase)

- **Tenant isolation.** No workspace can read or write another workspace's data. Enforced at the database layer (RLS), not only in application code. Verified by automated tests in every phase.
- **Auditability.** All destructive and billing-relevant actions are written to an append-only audit log.
- **Cost safety.** No feature may spend provider or LLM credits without an explicit, metered, attributable deduction. Runaway spend is prevented by budget caps and confirmations.
- **Performance.** The grid remains responsive (interaction under ~150ms for common actions) at the row counts specified per phase.
- **Observability.** Every external provider/LLM call is logged with latency, cost, status, and the record it belongs to.

---

### 7. How to read the phase files

Each file follows the same structure: Overview, Scope (in/out), User Stories & Acceptance Criteria (the core of the spec), Functional Requirements, Data Model Additions, Technical Notes, Dependencies & Assumptions, Non-Functional Requirements, and Indicative Effort. Acceptance criteria are written to be directly convertible into QA test cases.

- `Cascade_FSD_Phase_1_Foundation.md`
- `Cascade_FSD_Phase_2_Enrichment_Engine.md`
- `Cascade_FSD_Phase_3_Intelligence_Automation.md`
- `Cascade_FSD_Phase_4_SaaS_Productization.md`
