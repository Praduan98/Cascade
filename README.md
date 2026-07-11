# Cascade — Frontend (Phases 1–4)

A lean, operator-first **GTM data-enrichment platform** (a Clay alternative). This
repository is the **complete four-phase frontend** — from the Phase 1 spreadsheet-style
data grid, through Phase 2 enrichment, Phase 3 AI / agent / HTTP / formula columns plus
automation & integrations, to Phase 4 billing, a superadmin panel, templates & onboarding
— all built faithfully on the **Deep Current** design system.

> **Scope:** frontend + design only. **The real backend is not wired.** The app runs on a
> typed **mock data layer** (`@cascade/data`, in-memory + `localStorage`) that implements
> the `CascadeApi` interface. A real **`HttpApi`** implementation of that *same* interface
> — plus an SSE-based per-cell status transport — now also exists, with **`CONTRACT.md`**
> as the backend spec, but the app still runs entirely on the mock. See
> [Data layer](#data-layer).

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Key routes:
- `/` — landing · `/kitchen-sink` — component gallery
- `/tables` → open a table → the live data grid · `/members` · `/audit` · `/settings`
- `/grid-demo` — the grid seeded with **100,000 rows** (virtualization demo)
- `/providers` · `/usage` — enrichment providers & credit usage *(Phase 2)*
- `/automations` · `/integrations` — schedules/triggers/webhooks & CRM/Slack *(Phase 3)*
- `/billing` · `/templates` · `/onboarding` — plans & credits, template library, setup *(Phase 4)*
- `/admin` — separate **superadmin** panel with its own platform identity *(Phase 4)*

Sign-in offers **demo accounts** (Owner / Admin / Member / Viewer) to exercise the
role model. Data persists to `localStorage`; clear it to reset to seed.

## Monorepo layout

```
apps/web/            Next.js 14 App Router application (all four phases)
packages/
  core/              domain model · 15-column-type registry (validate/coerce/CSV/
                     filter/sort) · typed filters · multi-sort · clipboard parser
  data/              CascadeApi contract + MockApi (localStorage) AND HttpApi
                     (fetch + SSE status transport); CONTRACT.md REST spec; the
                     enrichment / AI / agent / HTTP / formula engines; billing +
                     platform; seed + 100k generator
  ui/                design-system component library (CSS Modules on the token layer)
  grid/              Glide Data Grid integration: token→canvas theme mapper, typed
                     cell renderers + StatusCell, windowed provider, undo/redo, copy/paste
design/              the "Deep Current" design system + architecture (source of truth)
All_phase_doc/       the four-phase Functional Spec (reference)
```

## What's built

### Phase 1 — the grid foundation
- **Auth & workspaces** — sign in / up / magic-link / verify (mock), workspace switcher,
  role-aware app shell.
- **RBAC** — Owner / Admin / Member / Viewer, gated in the UI and enforced by the mock API
  (viewers are read-only). *(True DB-level tenant isolation is a backend concern, explicitly
  out of this frontend's scope.)*
- **Tables** — create / rename / duplicate / delete.
- **The grid** — virtualized to 100k rows, inline editing (optimistic, conflict-aware),
  keyboard nav, **copy/paste**, **undo/redo** (visible controls + ⌘Z/⇧⌘Z), frozen columns,
  add-row.
- **Typed columns** — Text, Long text, Number, Currency, Boolean, Single/Multi-select
  (labelled colours), Date, URL, Email, Phone — with editors, validation, and
  retype-with-coercion warnings.
- **Views** — filter builder (AND/OR, typed operators), multi-sort, column show/hide,
  **saved views** + an undeletable default, live filtered row count, `?view=` URL.
- **CSV** — import wizard (upload → map → infer → validate → chunked progress) and
  current-view export (available to viewers).
- **Members & audit** — invitations, pending list, role management; append-only audit
  viewer (Admin/Owner).
- **Theme** — dark-first with a fully-designed light theme (no-flash toggle, persisted).

### Phase 2 — enrichment engine
Enrichment columns fed by mock providers, an async enrichment engine driving the per-cell
status system (Queued / Running / Success / Empty / Failed / Cached), live cell updates as
runs complete, and credit metering. Routes: `/providers`, `/usage` (`api.enrichment`).

### Phase 3 — AI columns & automation
- **AI, agent, HTTP, and formula columns** — four new column types (registry now **15
  types**) on a shared operation-runner pipeline with templating + structured output.
  `api.ai` / `api.agent` / `api.http` / `api.formula`.
- **Automation** — schedules, triggers, and webhooks (`/automations`, `api.automation`).
- **Integrations** — CRM & Slack connectors (`/integrations`, `api.integration`).

### Phase 4 — SaaS spine & growth
- **Billing** — plans, credit packs, a one-ledger balance / consumption model, and budgets
  (`/billing`; `api.billing` + `api.credits`).
- **Superadmin** — a separate `/admin` panel with its own platform identity (`api.platform`).
- **Templates & onboarding** — a template library and guided setup (`/templates`,
  `/onboarding`; `api.templates` + `api.onboarding`).

## Data layer

Everything talks to a single **`CascadeApi`** interface
([`packages/data/src/api.ts`](packages/data/src/api.ts)) obtained via `getApi()`. Two
implementations exist:

- **`MockApi`** *(default — what runs today)* — an in-memory store persisted to
  `localStorage`, with realistic seed data, role guards, last-write-wins conflicts, an audit
  log, and the 100k-row generator.
- **`HttpApi`** — a real, fetch-backed implementation of the *same* interface that maps 1:1
  onto the REST endpoints in **[`packages/data/CONTRACT.md`](packages/data/CONTRACT.md)**,
  with per-cell status delivered over a single per-workspace **SSE** connection (reconnect +
  `Last-Event-ID` backfill). It is configured with `NEXT_PUBLIC_API_BASE_URL`.

The real backend is **not wired**: `getApi()` unconditionally returns the mock. Swapping to
`HttpApi` is currently a one-line change in
[`packages/data/src/index.ts`](packages/data/src/index.ts) (or via `setApi()`), not an
environment toggle. `CONTRACT.md` is the spec the backend team implements against; the
TypeScript `CascadeApi` interface is the source of truth.

## Design system

The visual language lives in [`design/`](design/) — tokens, typography (Bricolage
Grotesque · Hanken Grotesk · JetBrains Mono), and the component/architecture reference.
`design/src/tokens.css` is ported verbatim into `packages/ui/styles/tokens.css`; fonts
are extracted to `next/font/local` (`make fonts`). The status system
(Queued/Running/Success/Empty/Failed/Cached) and the "gold = money only" rule established
here drive the Phase 2+ enrichment, AI, agent, and HTTP columns.

## Tech stack

Next.js 14 (App Router) · React 18 · TypeScript (strict) · pnpm workspaces · CSS Modules
+ CSS-variable token layer (no Tailwind) · Glide Data Grid · Radix (overlays) · TanStack
Query · Zustand · Zod · SSE (HttpApi status transport) · Vitest · Playwright.

## Verify

```bash
pnpm -r typecheck     # all 5 workspace projects (4 packages + web)
pnpm -r test          # core 27 + data 109 + web 50 = 186 tests
pnpm --filter web build
```

*(Only `core`, `data`, and `web` define a `test` script; `grid` and `ui` are typecheck-only.)*

---
SDTC Digital · InsightsTap — Cascade frontend (Phases 1–4), 2026.
