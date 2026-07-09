# Cascade — Phase 1 Frontend

A lean, operator-first **GTM data-enrichment platform** (a Clay alternative). This
repository is the **Phase 1 frontend** — the foundation: a spreadsheet-style data
grid with typed columns, views, CSV, and workspace/RBAC UI — built faithfully on the
**Deep Current** design system.

> **Scope:** frontend + design only. There is no backend. The app runs on a typed
> **mock data layer** (`@cascade/data`, in-memory + `localStorage`) that implements a
> REST-shaped contract, so a real API can replace it later with no UI rework.

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Key routes:
- `/` — landing · `/kitchen-sink` — component gallery
- `/tables` → open a table → the live data grid · `/members` · `/audit` · `/settings`
- `/grid-demo` — the grid seeded with **100,000 rows** (virtualization demo)

Sign-in offers **demo accounts** (Owner / Admin / Member / Viewer) to exercise the
role model. Data persists to `localStorage`; clear it to reset to seed.

## Monorepo layout

```
apps/web/            Next.js 14 App Router application
packages/
  core/              domain model · 11-column-type registry (validate/coerce/CSV/
                     filter/sort) · typed filters · multi-sort · clipboard parser
  data/              CascadeApi contract + MockApi (localStorage, role guards,
                     last-write-wins conflicts, audit, seed + 100k generator)
  ui/                design-system component library (CSS Modules on the token layer)
  grid/              Glide Data Grid integration: token→canvas theme mapper, 11 typed
                     cell renderers + StatusCell, windowed provider, undo/redo, copy/paste
design/              the "Deep Current" design system + architecture (source of truth)
All_phase_doc/       the four-phase Functional Spec (reference)
```

## What's built (Phase 1 stories)

- **Auth & workspaces** — sign in / up / magic-link / verify (mock), workspace
  switcher, role-aware app shell.
- **RBAC** — Owner / Admin / Member / Viewer, gated in the UI and enforced by the
  mock API (viewers are read-only). *(True DB-level tenant isolation is a backend
  concern, explicitly out of this frontend's scope.)*
- **Tables** — create / rename / duplicate / delete.
- **The grid** — virtualized to 100k rows, inline editing (optimistic, conflict-aware),
  keyboard nav, **copy/paste**, **undo/redo** (visible controls + ⌘Z/⇧⌘Z), frozen
  columns, add-row.
- **11 typed columns** — Text, Long text, Number, Currency, Boolean, Single/Multi-select
  (labelled colours), Date, URL, Email, Phone — with editors, validation, and
  retype-with-coercion warnings.
- **Views** — filter builder (AND/OR, typed operators), multi-sort, column show/hide,
  **saved views** + an undeletable default, live filtered row count, `?view=` URL.
- **CSV** — import wizard (upload → map → infer → validate → chunked progress) and
  current-view export (available to viewers).
- **Members & audit** — invitations, pending list, role management; append-only audit
  viewer (Admin/Owner).
- **Theme** — dark-first with a fully-designed light theme (no-flash toggle, persisted).

## Design system

The visual language lives in [`design/`](design/) — tokens, typography (Bricolage
Grotesque · Hanken Grotesk · JetBrains Mono), and the component/architecture reference.
`design/src/tokens.css` is ported verbatim into `packages/ui/styles/tokens.css`; fonts
are extracted to `next/font/local` (`make fonts`). The status system
(Queued/Running/Success/Empty/Failed/Cached) and the "gold = money only" rule carry
forward for Phase 2 enrichment.

## Tech stack

Next.js 14 (App Router) · React 18 · TypeScript (strict) · pnpm workspaces · CSS Modules
+ CSS-variable token layer (no Tailwind) · Glide Data Grid · Radix (overlays) · TanStack
Query · Zustand · Zod · Vitest · Playwright.

## Verify

```bash
pnpm -r typecheck     # all 5 packages
pnpm -r test          # core 27 + data 12 = 39 tests
pnpm --filter web build
```

---
SDTC Digital · InsightsTap — Cascade Phase 1 (frontend), 2026.
