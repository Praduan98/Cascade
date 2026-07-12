# Cascade — Handover

This document describes the Cascade submission: what it is, what is built, what is
out of scope, how to run it, and how to verify it. All facts below are derived from
the repository as committed.

---

## 1. What this is

Cascade is the **frontend + design deliverable** for a GTM (go-to-market) data
enrichment product. It is a **Next.js 14 App Router** application that runs entirely
on a **typed, in-process mock** — there is **no backend** in this submission.

Every data call in the UI goes through a single API accessor, `getApi()`, which
returns a `MockApi`. `MockApi` implements the **`CascadeApi` contract interface**
(the same interface a real backend would satisfy) and persists its state to the
browser's `localStorage`. Because the UI is written against the interface — not the
mock — the mock can be swapped for a real HTTP client with no UI changes (see
[§6 Out of scope](#6-pending--out-of-scope)).

- Framework-agnostic domain logic and the API contract live in packages; the app is
  a thin presentation layer over them.
- The app **opens signed-out** on the sign-in screen; sign-in is a mock (no real
  accounts or email).
- State is seeded on first load and survives reloads via `localStorage`
  (key `cascade:store:v1`, schema version `6`; a version mismatch discards stored
  data and reseeds).

---

## 2. Tech stack

| Area | Choice | Version |
|---|---|---|
| Package manager | pnpm (workspaces monorepo) | `10.33.0` (pinned via `packageManager`) |
| Runtime | Node.js | `>=20` (`engines.node`) |
| Framework | Next.js (App Router) | `14.2.15` |
| UI runtime | React / react-dom | `18.3.1` |
| Language | TypeScript | `5.6.3` |
| Data/query | @tanstack/react-query · zustand · zod · papaparse | `5.59.15` · `5.0.0` · `3.23.8` · `5.4.1` |
| Data grid | @glideapps/glide-data-grid | `6.0.3` |
| UI primitives | Radix UI (dialog/dropdown/popover/tooltip) | `1.1.x` |
| Unit tests | Vitest | `2.1.3` |
| E2E / a11y | @playwright/test · @axe-core/playwright | `1.48.0` · `4.10.1` |

---

## 3. Monorepo layout

pnpm workspace with globs `apps/*` and `packages/*` — one app and four packages:

| Package | Role |
|---|---|
| `apps/web` | The Next.js frontend (package name `web`). Consumes all four packages. |
| `packages/core` | Framework-agnostic domain layer: domain types, the **column-type registry (15 types)**, typed filters + sorting, clipboard parser, templating, structured-output, and the formula evaluator. |
| `packages/data` | API layer: the **`CascadeApi` contract**, the **`MockApi`** implementation, the fetch-backed **`HttpApi`**, the run engines (enrichment / ai / agent / http), seed data, plans/templates, and the `Store` (localStorage persistence). |
| `packages/grid` | Glide Data Grid integration: design-token → canvas theme mapper, typed cell renderers, windowed data provider, optimistic inline editing. |
| `packages/ui` | Presentational primitives + theming: `ThemeProvider`, buttons/pills/tags, design tokens — built on Radix UI. |

The `CascadeApi` contract is a REST-shaped, fully-async, workspace-scoped interface
composed of **21 namespaces**: `auth, workspaces, members, tables, columns, records,
cells, views, audit, enrichment, ai, agent, http, formula, automation, integration,
templates, onboarding, credits, billing, platform`. `MockApi` implements all of them.

---

## 4. What's built (Phases 1–4)

Every feature below is backed by an actual route **and** an implemented `MockApi`
namespace (not just an interface stub).

### Phase 1 — Foundation (tables, grid, workspaces, auth, RBAC)
- **Auth**: mock sign-in / sign-up, magic link, and demo user switching.
- **Workspaces & members**: list/create workspaces; invite/update-role/remove members
  with pending invites.
- **RBAC**: 4-role ladder `viewer < member < admin < owner` with capability predicates
  (write, manage members, view audit, manage workspace). A **separate** platform-role
  ladder (`support < admin`) governs the superadmin panel.
- **Tables & data grid**: table CRUD + duplicate; columns add/retype/reorder/remove;
  records add/count/bulk-delete/reorder; cell edits with last-write-wins conflict
  detection; saved views; audit log. Grid supports **15 column types**, inline editing,
  and CSV import/export.

### Phase 2 — Enrichment engine
- **Waterfall enrichment columns** with multi-step provider configs.
- **Provider catalog** (6 seeded: People Data Labs, Apollo.io, Hunter.io, Prospeo,
  ZeroBounce, LeadMagic) with BYO / platform credentials (write-only, masked keys).
- **Estimate → run** with per-run and budget caps, per-cell provenance, cache stats,
  and a live event stream (cell / run / budget) via `subscribe()`.
- **Credits & usage**: workspace balance, budget/per-run caps, ledger, and consumption
  breakdowns (by provider/column/table/model). Cost/margin is redacted for non-admins.
- Routes: **`/providers`**, **`/usage`**.

### Phase 3 — Intelligence & automation
- **AI columns** (`ai` type + `api.ai`): 3 models — Claude Haiku 4.5 (default),
  GPT-4o mini, Gemini 2.0 Flash — sharing the enrichment credit machinery.
- **Web-research agent columns** (`agent` type + `api.agent`): objective/max-steps/
  max-pages config with source citations.
- **HTTP columns** (`http` type + `api.http`): templated per-row request with JSON-path
  response mapping and write-only secrets.
- **Formula columns** (`formula` type + `api.formula`): synchronous computed values
  (no credits), with expression validation and table recompute.
- **Automations** (admin-gated): schedule / row-event triggers + actions, run history,
  inbound webhooks (url + secret shown once), outbound webhooks.
- **Integrations** (admin-gated): CRM connect + two-way sync with field mapping/dedupe,
  Slack notify, and a unified cross-source activity feed.
- Routes: **`/automations`**, **`/integrations`**.

### Phase 4 — SaaS productization
- **Billing** (owner-gated): 4 plan tiers (Free / Starter / Growth / Scale) + 3 credit
  packs; per-workspace summary (plan, balance, usage, overage, next charge, seats);
  change-plan, purchase-credits, invoices. Consumption derives from the Phase-2 ledger.
- **Superadmin platform panel** (`/admin`, separate platform session): cross-tenant
  workspace management (suspend / deactivate user / comp credits / override plan),
  invoice refunds, business analytics (MRR/ARR/COGS/margin/conversion/mix/trend), and a
  platform audit log.
- **Templates library**: 5 curated recipes that instantiate into fully-configured
  tables (columns + enrichment/AI/agent config).
- **Onboarding**: guided first-run state (get/complete/skip/reset), surfaced as a
  dedicated `/onboarding` page and an in-shell `OnboardingGate`.
- **Outbound sequencers** (`api.integration.sequencers`): connect, campaigns, push with
  field mapping + filter; surfaced as a **Sequencers** section on `/integrations`.
- Routes: **`/billing`**, **`/templates`**, **`/onboarding`**, **`/admin/*`**.

---

## 5. Routes & demo sign-in

**25 pages** across four groups (route groups `(app)` and `(auth)` add no URL segment):

- **Auth (public):** `/sign-in`, `/sign-up`, `/magic-link`, `/verify`
- **Marketing:** `/welcome`
- **App (auth-gated):** `/home`, `/tables`, `/tables/[tableId]`, `/members`, `/audit`,
  `/settings`, `/providers`, `/usage`, `/billing`, `/automations`, `/integrations`,
  `/templates`, `/onboarding`
- **Superadmin (separate platform session):** `/admin`, `/admin/login`,
  `/admin/workspaces`, `/admin/audit`
- **Dev/demo:** `/kitchen-sink` (component gallery), `/grid-demo`
- **Root `/`:** auth gate → `/welcome` if signed in, else `/sign-in`

### Demo sign-in
The app opens on **`/sign-in`** (signed out). Three ways in:
1. **Mock SSO** — "Continue with Google" / "Continue with Microsoft" sign you in as the
   workspace **owner** (`aitools@insightstap.com`).
2. **Magic link** — enter a work email; in the demo the link "opens instantly" via an
   *Open the sign-in link* button.
3. **One-click demo accounts** — pick any of the four seeded roles.

Post-sign-in flow: **`/sign-in` → `/welcome` (landing) → `/home` (dashboard)**.

**Seeded tenant users** (one per role, InsightsTap workspace):

| Role | Name | Email |
|---|---|---|
| Owner | Aarav Shah | `aitools@insightstap.com` |
| Admin | Marcus Chen | `marcus.chen@insightstap.com` |
| Member | Dana Whitfield | `dana.whitfield@insightstap.com` |
| Viewer | Sam Okoye | `sam.okoye@insightstap.com` (intentionally unverified) |

**Superadmin panel** uses its own separate login at **`/admin/login`** with staff
accounts `ops@sdtcdigital.com` (Platform Admin) and `support@sdtcdigital.com` (Support).

> To reset all demo state, clear the `cascade:store:v1` key from the browser's
> localStorage (or use a fresh/incognito window).

---

## 6. Pending / out of scope

**A real backend is not implemented — the data layer is the mock.** What exists to make
the future swap cheap:

- **REST + SSE contract** — `packages/data/CONTRACT.md`. Explicitly a proposal for a
  backend team to build against; it documents every endpoint, the error taxonomy, and
  the SSE stream envelope (reconnect + `Last-Event-ID` backfill).
- **`HttpApi` client** — `packages/data/src/httpApi.ts`. A complete, fetch-backed
  implementation of the same `CascadeApi` interface the UI already uses. It maps non-2xx
  responses onto the error taxonomy (`401→UnauthorizedError`, `402→BudgetError`,
  `403→ForbiddenError`, `404→NotFoundError`, `409→ConflictError`, `422→ValidationError`),
  clears the bearer token on 401, and multiplexes run-status over one SSE connection.

**How the swap actually works (accurate):** `getApi()` currently returns `MockApi`
unconditionally. Going live is a **dependency-injection** change — call
`setApi(new HttpApi({ baseUrl, … }))` at startup (or change the one line in `getApi()`),
and point it at the deployed API.

> ⚠️ **Note:** there is **no `NEXT_PUBLIC_API_MODE` env flag** in this repo — the swap
> seam is `getApi()` / `setApi()` injection, not an environment toggle. `HttpApi` is
> exported but is not constructed anywhere in the app (only in its unit test).
> `.env.example` mentions `NEXT_PUBLIC_API_BASE_URL`, but it is commented out and not
> read by any runtime code yet.

Also deferred per the FSD (`All_phase_doc/`): "own-data" ingestion and **real** external
provider / AI / CRM / Slack calls — all currently simulated by the mock engines.

---

## 7. How to run

**Prerequisites:** Node.js `>=20` and pnpm `10.33.0`
(`corepack enable` — or `npm i -g pnpm@10.33.0`).

```bash
# 1. Install (reproducible from the committed lockfile)
pnpm install --frozen-lockfile

# 2. Dev server → http://localhost:3000
pnpm dev

# 3. Production build + serve
pnpm build       # next build
pnpm start       # next start
```

**Environment:** none required — the app runs fully on the mock. Optional:
`cp .env.example apps/web/.env.local` (defines `NEXT_PUBLIC_APP_NAME=Cascade`;
`NEXT_PUBLIC_API_BASE_URL` is a placeholder for a future real backend).

Then open **http://localhost:3000** and sign in with any demo account (see §5).

---

## 8. How to verify

```bash
# Type-check every workspace (5 projects)
pnpm -r typecheck

# Unit + integration tests — 186 passing (core 27 · data 109 · web 50)
pnpm -r test

# Production build (all routes)
pnpm --filter web build
```

**Optional — accessibility / e2e (Playwright):** the browser is not bundled, so install
it first.

```bash
pnpm --filter web exec playwright install chromium
pnpm --filter web e2e   # 14 axe checks: 7 routes × {light, dark}, on port 3210
```

A clean-state dry run (extract only committed files, then install/typecheck/test/build)
passes green end-to-end.

---

## 9. Documentation map

| Path | What it is |
|---|---|
| `README.md` | Project overview + quick start. |
| `HANDOVER.md` | This document. |
| `packages/data/CONTRACT.md` | The REST + SSE backend contract (proposal). |
| `design/README.md` | Design system & architecture. |
| `docs/DESIGN_AUDIT.md` | Design-quality audit. |
| `All_phase_doc/Cascade_FSD_00_Overview.md` | Program overview & phasing index. |
| `All_phase_doc/Cascade_FSD_Phase_1_Foundation.md` | Phase 1 spec. |
| `All_phase_doc/Cascade_FSD_Phase_2_Enrichment_Engine.md` | Phase 2 spec. |
| `All_phase_doc/Cascade_FSD_Phase_3_Intelligence_Automation.md` | Phase 3 spec. |
| `All_phase_doc/Cascade_FSD_Phase_4_SaaS_Productization.md` | Phase 4 spec. |
