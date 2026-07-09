# Cascade — Functional Specification Document
## Phase 1: Foundation — Data Tables, Grid, Workspaces & Auth

| Field | Value |
|---|---|
| Phase | 1 of 4 |
| Depends on | Nothing (foundation) |
| Enables | Phase 2 (Enrichment), Phase 3 (Automation), Phase 4 (SaaS) |
| Audience | Internal — SDTC Digital / InsightsTap |
| Version | 1.0 (Draft) |
| Date | July 2026 |

---

### 1. Phase Overview

Phase 1 builds the container that every later capability plugs into: a multi-tenant workspace model and a spreadsheet-style data table. There is no enrichment, no AI, and no automation in this phase. The goal is a solid, fast, editable data grid with typed columns, CSV import/export, filtering, sorting, saved views, and workspace-scoped access control, sitting on a schema designed so that enrichment columns and async cell states can be added in Phase 2 without rework.

Getting the data model and the grid right here is the single largest determinant of the whole program's success. The grid is the product's face; the schema is its spine.

---

### 2. Scope

#### 2.1 In scope

- Authentication (email/password and passwordless magic link) and session management.
- Workspaces with tenant isolation via PostgreSQL row-level security.
- Workspace roles and basic RBAC: Owner, Admin, Member, Viewer.
- Member invitations by email.
- Tables: create, rename, duplicate, delete, list within a workspace.
- Records (rows): add, edit, delete, bulk delete, reorder.
- Columns: add, rename, retype, reorder, resize, delete, freeze/pin.
- Column types: Text, Long text, Number, Currency, Boolean, Single-select, Multi-select, Date, URL, Email, Phone.
- The data grid: virtualized rendering, inline editing, keyboard navigation, copy/paste, multi-cell selection, basic undo/redo.
- CSV import with a column-mapping step and type inference; CSV export of the current view.
- Views: filtering (by column, multiple conditions), sorting (multi-column), column show/hide, and saved named views per table.
- Append-only audit log for table, column, record, and membership changes.

#### 2.2 Out of scope (deferred)

- Enrichment, providers, waterfalls, credits (Phase 2).
- AI columns, web-research agent, HTTP columns, formulas beyond simple display, triggers, scheduling, webhooks, CRM sync (Phase 3).
- Billing, self-serve signup, subscription plans, superadmin panel, templates, outbound sequencing, own scrapers (Phase 4).
- Real-time multi-user co-editing (cursors/live merge). Phase 1 supports concurrent access with last-write-wins and a conflict warning; live collaboration is a later consideration.

---

### 3. User Stories & Acceptance Criteria

Story IDs use the pattern `US-1.x`. Acceptance criteria (AC) are written to be directly testable.

---

**US-1.1 — Sign up and create a workspace**
As a new user, I want to create an account and a workspace, so that I have an isolated space to build tables.

Acceptance criteria:
- Given valid details, when I sign up, then an account is created and I am taken into a newly created default workspace.
- Sign-up supports both email/password and passwordless magic link.
- Passwords are stored only as salted hashes; plaintext is never persisted or logged.
- A verification email is sent; unverified accounts can sign in but see a persistent "verify email" prompt.
- Duplicate email registration is rejected with a clear, non-enumerating message.

**US-1.2 — Sign in and stay signed in securely**
As a returning user, I want to sign in and maintain a session, so that I can resume work without re-authenticating constantly.

Acceptance criteria:
- Valid credentials or a valid magic link establish an authenticated session.
- Sessions expire after a configured idle period and can be revoked server-side.
- Invalid credentials return a generic failure that does not reveal whether the email exists.
- Signing out invalidates the session token immediately.

**US-1.3 — Invite teammates and assign roles**
As a Workspace Admin, I want to invite people by email and assign a role, so that my team can collaborate with appropriate permissions.

Acceptance criteria:
- I can invite by email and select a role (Admin, Member, Viewer) at invite time.
- The invitee receives an email with a link that adds them to the workspace on acceptance.
- Pending invitations are listed and can be revoked or resent.
- An email already a member of the workspace cannot be re-invited (clear message).
- Only Owner and Admin can send or revoke invitations.

**US-1.4 — Role-based permissions are enforced**
As a Workspace Owner, I want roles to gate actions, so that Viewers cannot alter data and only trusted roles can manage the workspace.

Acceptance criteria:
- Viewer: can open tables and views, can export, cannot create/edit/delete records, columns, or tables.
- Member: full data and table CRUD, cannot manage members or workspace settings.
- Admin: everything a Member can do, plus member management and workspace settings.
- Owner: everything an Admin can do, plus transfer ownership and delete the workspace.
- Any action attempted above a user's role is rejected server-side (not only hidden in the UI) and returns an authorization error.

**US-1.5 — Workspace data isolation (security-critical)**
As a Workspace Owner, I want my data to be invisible to other workspaces, so that tenant data never leaks.

Acceptance criteria:
- A user who is a member of Workspace A cannot read, list, or mutate any table, record, column, view, or audit entry belonging to Workspace B, via UI or API.
- Isolation is enforced at the database layer using row-level security keyed on workspace, not solely in application code.
- An automated test suite attempts cross-workspace access on every entity type and all attempts fail.
- Object IDs are non-sequential/unguessable so that isolation does not rely on obscurity alone.

**US-1.6 — Create, rename, duplicate, and delete a table**
As a Member, I want to manage tables in my workspace, so that I can organize different datasets.

Acceptance criteria:
- I can create a table with a name; it appears immediately in the workspace table list.
- I can rename a table inline; the new name persists and is reflected everywhere.
- I can duplicate a table, copying its columns and (optionally) its records.
- I can delete a table; deletion asks for confirmation and writes an audit entry.
- Table names must be unique within a workspace; a duplicate name is rejected with a clear message.

**US-1.7 — Add and configure typed columns**
As a Member, I want to add columns with specific types, so that data is structured and validated.

Acceptance criteria:
- I can add a column and choose from: Text, Long text, Number, Currency, Boolean, Single-select, Multi-select, Date, URL, Email, Phone.
- Single-select and Multi-select let me define options with labels and colors.
- Each type validates input on entry (for example, Email rejects strings without a valid email shape; Number rejects non-numeric input).
- I can rename a column and reorder columns by drag.
- I can change a column's type; the system warns when a conversion may lose or coerce data and requires confirmation.
- I can pin/freeze a column so it remains visible while scrolling horizontally.

**US-1.8 — Add, edit, and delete records inline**
As a Member, I want to edit data directly in the grid, so that working with rows feels like a spreadsheet.

Acceptance criteria:
- I can add a new blank row and a new row via a persistent add-row affordance at the bottom.
- I can edit a cell inline; edits commit on blur or Enter and persist to the backend.
- I can select and delete one or multiple rows, with confirmation for multi-delete.
- Invalid input for a typed cell is rejected inline with a visible validation message and does not persist.
- Keyboard navigation works: arrow keys move the active cell, Enter commits and moves down, Tab commits and moves right, Escape cancels the edit.

**US-1.9 — Copy, paste, and fill**
As a Member, I want to copy and paste ranges, so that I can move data quickly like in a spreadsheet.

Acceptance criteria:
- I can select a contiguous range of cells and copy it.
- I can paste a copied range into a compatible target range; type validation applies per target column.
- Pasting multi-line clipboard content (for example from Excel/Sheets) maps into rows and columns correctly.
- Paste into a Viewer session is blocked.

**US-1.10 — Undo and redo**
As a Member, I want to undo recent changes, so that mistakes are recoverable.

Acceptance criteria:
- Undo reverses the last data action (cell edit, row add/delete, paste) within the current session.
- Redo reapplies an undone action.
- The undo history depth is at least the last 20 actions in a session.
- Undo/redo is available by keyboard shortcut and by visible controls.

**US-1.11 — Import a CSV with column mapping**
As a Member, I want to import a CSV and map its columns, so that I can bring existing lists into a table.

Acceptance criteria:
- I can upload a CSV and see a preview of the first rows.
- I can map each CSV column to a new or existing table column and choose the target type.
- The importer infers a sensible default type per column, which I can override.
- Rows failing validation are reported per row with the reason; I can choose to import valid rows only or cancel.
- Import runs without freezing the UI for files up to at least 50,000 rows, showing progress.
- On completion, the row count and any skipped-row summary are shown, and an audit entry is written.

**US-1.12 — Export the current view to CSV**
As a Member, I want to export what I see, so that I can share or reuse the data.

Acceptance criteria:
- Export produces a CSV reflecting the current view's visible columns, active filters, and sort order.
- Column headers in the export match the display names.
- Multi-select values export in a documented, consistent delimiter format.
- Export is available to Viewers.

**US-1.13 — Filter records**
As a Member, I want to filter rows by conditions, so that I can focus on a subset.

Acceptance criteria:
- I can add one or more filter conditions on any column using type-appropriate operators (for example, Text: contains/equals/is empty; Number: >, <, between; Date: before/after/between; Select: is/is any of).
- Multiple conditions combine with AND and OR grouping.
- Filters apply live and the visible row count updates.
- Clearing filters restores the full record set.

**US-1.14 — Sort records**
As a Member, I want to sort by one or more columns, so that I can order data meaningfully.

Acceptance criteria:
- I can sort ascending or descending on a column.
- I can add secondary sorts; sort priority is visible and reorderable.
- Sorting respects column type (numeric, date, and text sort correctly, not lexicographically for numbers).

**US-1.15 — Save and switch views**
As a Member, I want to save named views, so that I can reuse filter/sort/column configurations.

Acceptance criteria:
- I can save the current filter set, sort set, and column visibility/order as a named view on the table.
- I can switch between saved views; switching applies that configuration.
- I can rename and delete saved views.
- A default/unfiltered view is always available and cannot be deleted.

**US-1.16 — Large-table performance**
As a Member, I want the grid to stay fast with many rows, so that large lists remain workable.

Acceptance criteria:
- With at least 100,000 rows loaded in a table, scrolling remains smooth (no perceptible freeze) via row virtualization.
- Opening a table and rendering the first screen completes within about 2 seconds on a standard connection for a table of that size.
- Common cell interactions (select, begin edit, commit) respond within about 150ms.
- Memory usage remains stable during extended scrolling (no unbounded growth).

**US-1.17 — Audit trail of changes**
As a Workspace Admin, I want an audit log, so that I can see who changed what.

Acceptance criteria:
- Creating, renaming, or deleting tables and columns, deleting records in bulk, importing CSVs, and changing memberships each write an append-only audit entry.
- Each entry records actor, action, target, timestamp, and workspace.
- Audit entries cannot be edited or deleted through the application.
- Admins and Owners can view the workspace audit log; Members and Viewers cannot.

---

### 4. Functional Requirements (supplementary)

- **FR-1.1** The system supports at least the 11 column types listed in scope, each with server-side and client-side validation.
- **FR-1.2** The schema stores cell values in a form that preserves type and can later carry per-cell metadata (source, status, timestamp) without migration of existing data. This is a hard requirement because Phase 2 attaches enrichment state to cells.
- **FR-1.3** All list and read endpoints are workspace-scoped by default; there is no unscoped data-read path.
- **FR-1.4** CSV import is processed as a background operation for files above a threshold row count, with progress reporting.
- **FR-1.5** The grid component is selected against the criteria in Technical Notes and must support virtualization, custom cell renderers, and asynchronous per-cell visual states (needed in Phase 2).

---

### 5. Data Model Additions (introduced this phase)

Core entities (indicative; final column lists set at design):

- **workspace** (id, name, owner_user_id, created_at)
- **user** (id, email, hashed_password, email_verified, created_at)
- **membership** (id, workspace_id, user_id, role, status, invited_by, created_at)
- **table** (id, workspace_id, name, created_by, created_at)
- **column** (id, table_id, name, type, config_json, position, is_frozen, created_at) — `config_json` holds select options, currency code, etc.
- **record** (id, table_id, position, created_at, updated_at)
- **cell** (id, record_id, column_id, value_json, meta_json) — `meta_json` reserved now for Phase 2 enrichment state (source, status, cost, fetched_at); unused in Phase 1 but present.
- **view** (id, table_id, name, filters_json, sorts_json, column_state_json, is_default)
- **audit_log** (id, workspace_id, actor_user_id, action, target_type, target_id, detail_json, created_at)

The `cell.meta_json` reservation is deliberate: it lets Phase 2 record where a value came from and its async status per cell without restructuring the table.

---

### 6. Technical Notes (internal)

**Stack.** FastAPI (Python) API; Next.js frontend; Supabase/PostgreSQL with row-level security for tenant isolation; Redis for session/rate-limit support; Docker + AWS deployment. Auth can use Supabase Auth or a FastAPI-native JWT flow; if Supabase Auth is used, RLS policies key on the workspace claim.

**Grid component (decision required in this phase).** The grid is the highest-risk UI dependency. Evaluate, in order of fit:
- **Glide Data Grid** — canvas-rendered, extremely high row/column performance, custom cell types, good for async per-cell states. Mature, permissive license (Apache-2.0). Strong default recommendation for this use case.
- **AG Grid** — very mature and feature-rich; Community edition is free (MIT), several needed features (some filtering/grouping niceties) sit behind the paid Enterprise license. Excellent docs. Consider if we want batteries-included behavior and accept the Enterprise cost later.
- **TanStack Table + a virtualizer (TanStack Virtual)** — headless, MIT, maximum control, but we build the rendering, editing, and cell UX ourselves. More engineering effort; most flexible.
- Handsontable (licensing cost for commercial use), RevoGrid, Univer, Luckysheet are fallbacks/alternatives to note but not lead choices.

Recommendation: lead with Glide Data Grid for performance and permissive licensing, with TanStack Table as the fallback if we need fully custom rendering. Confirm during the design spike by prototyping 100k-row scroll plus a mocked async cell state.

**Tenant isolation.** RLS policies must be present on every tenant table and covered by automated negative tests. Application-layer scoping alone is not acceptable for US-1.5.

**Concurrency.** Phase 1 uses last-write-wins with an updated_at check; if a stale write is detected, the user is warned and shown the current value. Live co-editing is out of scope.

---

### 7. Dependencies & Assumptions

- No external data providers are required in Phase 1.
- Email delivery (for verification and invitations) requires a transactional email provider (for example, an AWS SES setup).
- Final choice of grid component is made during the Phase 1 design spike and locked before build.
- Design tokens follow the SDTC internal application style; this is an operator tool, so density and speed take priority over marketing polish.

---

### 8. Non-Functional Requirements

- **Security:** RLS-enforced isolation; hashed passwords; revocable sessions; unguessable IDs.
- **Performance:** targets per US-1.16 (100k rows smooth, first render ~2s, interactions ~150ms).
- **Reliability:** CSV import must not lose valid rows silently; every skipped row is reported.
- **Auditability:** append-only audit log per US-1.17.
- **Accessibility:** grid keyboard navigation per US-1.8 is a baseline, not optional.

---

### 9. Indicative Effort (planning-level)

| Discipline | Hours | Basis |
|---|---|---|
| Design | 60 | Grid UX, table/view interactions, import flow, design spike on grid component |
| Development | 320 | Auth, RLS multi-tenancy, grid integration, column types, CSV in/out, views, audit |
| QA | 76 | 20% of Design+Dev; includes cross-tenant isolation test suite and large-table performance testing |
| PM | 38 | 10% of Design+Dev |
| **Total** | **~494** | Indicative; refine after design spike |

QA and PM ratios are fixed per studio standard (QA 20%, PM 10% of Design+Dev). A detailed line-item estimate follows once the grid component and auth approach are locked.
