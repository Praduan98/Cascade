# Cascade — Functional Specification Document
## Phase 2: Enrichment Engine — Providers & Waterfall Orchestration

| Field | Value |
|---|---|
| Phase | 2 of 4 |
| Depends on | Phase 1 (tables, grid, cell.meta_json, workspaces, RBAC) |
| Enables | Phase 3 (AI/automation reuse the enrichment execution and metering layer) |
| Audience | Internal — SDTC Digital / InsightsTap |
| Version | 1.0 (Draft) |
| Date | July 2026 |

---

### 1. Phase Overview

Phase 2 delivers the capability that makes Cascade worth building: enrichment columns backed by third-party data providers, orchestrated as waterfalls. A waterfall runs providers in a defined order and only falls through to the next provider when the previous one returns nothing for a row, which is how coverage is maximized while spend is minimized. Every run executes asynchronously with visible per-cell status, is rate-limited and retried, deducts internal credits against a tracked provider cost, and caches results so the same lookup is not paid for twice.

This phase uses third-party providers only. Own scrapers are deliberately deferred to Phase 4. The provider layer is built as a set of interchangeable adapters behind one internal interface so that adding, removing, or reordering providers (including our own later) does not touch the orchestration engine.

---

### 2. Scope

#### 2.1 In scope

- A pluggable provider adapter framework (one internal contract; many provider implementations).
- An initial provider set covering the core enrichment jobs (people, company, email find, email verify, phone). Named candidates in Technical Notes; exact launch set confirmed at design.
- An **enrichment column** type: maps input columns to a provider (or a waterfall) and writes returned fields into output cells.
- A **waterfall builder**: an ordered list of providers with per-step input mapping and fall-through conditions.
- Asynchronous execution via background jobs with per-cell status: Queued, Running, Success, Empty (no data), Failed.
- Per-provider rate limiting, timeouts, and retry with backoff.
- Credit metering: internal credit deduction per successful billable call, with the underlying provider cost recorded for margin tracking.
- Workspace credit balance and a usage view.
- Result caching and de-duplication with configurable freshness (TTL).
- Run controls: run selected rows, run whole table, run only empty cells, and auto-run on new rows.
- Provider API key management (platform-managed keys, and workspace bring-your-own keys where a provider supports it).
- Enrichment run history and per-cell provenance (which provider supplied a value, when, at what cost).

#### 2.2 Out of scope (deferred)

- AI/LLM columns and the web-research agent (Phase 3).
- HTTP columns, formulas, triggers, scheduling, webhooks, CRM sync (Phase 3).
- Own/first-party scrapers (Phase 4).
- Customer-facing billing and credit purchase (Phase 4); Phase 2 meters and deducts credits internally but does not sell them.

---

### 3. User Stories & Acceptance Criteria

Story IDs use the pattern `US-2.x`.

---

**US-2.1 — Add a single-provider enrichment column**
As a Member, I want to add a column that enriches from one provider, so that I can append data such as a company's employee count or a person's email.

Acceptance criteria:
- I can add an enrichment column and select one provider and one of its enrichment operations (for example, "company enrichment," "find work email").
- I map the required input(s) from existing columns (for example, Company Domain, or First name + Last name + Company).
- I select which returned fields are written, and into which output columns (created if needed).
- The column configuration is saved and re-runnable.
- If required inputs are missing for a row, that row's cell shows Empty with a reason ("missing input: domain") and consumes no credit.

**US-2.2 — Build a multi-provider waterfall**
As a Member, I want to chain providers in a fallback order, so that I get the highest coverage at the lowest cost.

Acceptance criteria:
- I can add an ordered list of provider steps to a single enrichment column.
- For each step I map inputs and select output fields.
- A step runs for a row only if the prior steps returned no usable value for that row (fall-through on empty).
- As soon as a step returns a usable value for a row, later steps do not run for that row and are not charged.
- I can reorder, add, and remove steps; changes apply to subsequent runs.
- The per-cell result records which step/provider supplied the value.

**US-2.3 — Configure fall-through and match conditions**
As a Member, I want to control when a waterfall falls through, so that low-confidence results do not block better providers.

Acceptance criteria:
- Fall-through defaults to "previous step returned empty."
- I can optionally require a minimum confidence or a non-empty specific field before accepting a step's result (for example, accept only if an email is returned and marked deliverable).
- If a step returns data below the acceptance condition, the waterfall continues to the next step, and the rejected result is not written.
- Acceptance conditions are visible in the column configuration.

**US-2.4 — Run enrichment on selected rows**
As a Member, I want to run enrichment on a chosen set of rows, so that I control spend and scope.

Acceptance criteria:
- I can select specific rows and trigger enrichment for one enrichment column or all enrichment columns.
- Before a run that will consume credits, I see an estimated maximum credit cost and must confirm.
- The run executes asynchronously; I can keep working while it runs.
- Each targeted cell transitions through Queued to Running to a terminal state.

**US-2.5 — Run enrichment on the whole table**
As a Member, I want to enrich an entire table, so that I can process a full list.

Acceptance criteria:
- I can trigger a run across all rows for a given enrichment column.
- A pre-run summary shows the number of rows to be processed and the estimated maximum cost, requiring confirmation.
- The run respects "only empty cells" if I select that option, skipping already-populated cells and charging nothing for them.
- Progress (processed vs total, succeeded/empty/failed counts) is visible during the run.

**US-2.6 — See live per-cell status**
As a Member, I want each cell to show its enrichment status, so that I know what is happening without guessing.

Acceptance criteria:
- Each enrichment cell shows one of: Queued, Running, Success, Empty, Failed.
- Status updates in near real time as jobs progress (no manual refresh needed).
- A Failed cell exposes the failure reason on hover/click (for example, "provider timeout," "rate limited," "invalid input").
- An Empty cell indicates no data was found (distinct from Failed).
- Statuses survive a page reload (they are persisted, not only in-memory).

**US-2.7 — Auto-run enrichment on new rows**
As a Member, I want new rows to enrich automatically, so that I do not have to trigger runs manually as data arrives.

Acceptance criteria:
- I can enable auto-run on an enrichment column.
- When a new row is added (manually, by paste, or by CSV import) and its required inputs are present, its enrichment cells are queued automatically.
- Auto-run respects the workspace credit budget and any configured caps (see US-2.11).
- Auto-run can be disabled per column at any time.

**US-2.8 — Rate limits, timeouts, and retries are handled**
As a Member, I want transient provider issues handled automatically, so that runs complete reliably without me babysitting them.

Acceptance criteria:
- Each provider has a configured request rate limit that the engine never exceeds, queuing calls as needed.
- A call that exceeds its timeout is treated as a transient failure and retried with exponential backoff up to a configured maximum.
- Persistent failures after retries mark the cell Failed with the reason, without failing the entire run.
- Rate-limit responses from a provider (for example, HTTP 429) trigger backoff, not immediate failure.
- No transient failure double-charges credits.

**US-2.9 — Result caching prevents duplicate spend**
As a Workspace Admin, I want identical lookups to be served from cache, so that we do not pay providers twice for the same data.

Acceptance criteria:
- Given the same provider, operation, and normalized input, a repeat request within the freshness window returns the cached result and consumes no provider cost.
- Cache freshness (TTL) is configurable per provider/operation and has a sensible default.
- A cache hit is recorded distinctly in run history (so cache savings are measurable).
- I can force a fresh fetch that bypasses cache for a specific run when needed (with the associated cost shown).

**US-2.10 — Credit consumption is tracked and visible**
As a Workspace Admin, I want to see credit usage, so that I can manage spend.

Acceptance criteria:
- Every billable provider call deducts internal credits from the workspace balance at a defined rate per operation.
- A usage view shows credits consumed over time, broken down by table, by column, and by provider.
- The current workspace credit balance is visible.
- Cache hits and skipped/empty-input rows consume zero credits and are shown as such.

**US-2.11 — Budget caps prevent runaway spend**
As a Workspace Admin, I want to cap spend, so that a large or looping run cannot burn the budget unexpectedly.

Acceptance criteria:
- I can set a per-run maximum and a per-workspace credit budget.
- A run that would exceed the per-run maximum is blocked before execution with a clear message; I can raise the cap and retry.
- When the workspace budget is exhausted, further billable enrichment is paused and the workspace is notified; non-billable actions continue.
- Auto-run (US-2.7) stops queuing when a cap is reached.

**US-2.12 — Provider cost and margin visibility (admin)**
As a Workspace Admin, I want to see the real provider cost behind credits, so that internal margin and pricing can be reasoned about.

Acceptance criteria:
- Each billable call records the actual provider cost (or best-known cost) alongside the internal credit deduction.
- An admin view shows aggregate provider cost vs credits consumed for a period.
- This cost data is visible only to Admin/Owner, not to Member/Viewer.
- Cost figures are attributable down to the provider and operation level.

**US-2.13 — Manage provider API keys**
As a Workspace Admin, I want to configure provider credentials, so that enrichment can authenticate to providers.

Acceptance criteria:
- Platform-managed provider keys work out of the box for supported providers without workspace configuration.
- For providers that support it, a workspace can supply its own API key (bring-your-own), and usage on that key is attributed to the workspace and not charged internal provider cost.
- Keys are stored encrypted at rest and are never returned in plaintext to the client after entry.
- An invalid or revoked key surfaces a clear configuration error rather than silent failures on every row.

**US-2.14 — Email verification within a waterfall**
As a Member, I want found emails verified, so that lists have deliverable addresses.

Acceptance criteria:
- I can add a verification step (for example, an email-verification provider) after an email-finding step in a waterfall.
- The verification result (for example, Deliverable, Risky, Undeliverable, Unknown) is written to an output cell.
- I can configure the waterfall to accept only verified-deliverable emails, falling through to the next finder otherwise (ties to US-2.3).
- Verification consumes credits per the metering rules and is cached like other operations.

**US-2.15 — Enrichment run history and provenance**
As a Workspace Admin, I want a history of enrichment runs and per-cell provenance, so that results are explainable and auditable.

Acceptance criteria:
- Each run records who triggered it, when, the scope (rows/columns), counts by outcome, credits consumed, and provider cost.
- For any enriched cell, I can see which provider/step supplied the value, at what time, and at what cost (or "from cache").
- Run history is retained and viewable by Admin/Owner.
- Provenance data is written to the reserved cell metadata from Phase 1 (`cell.meta_json`).

**US-2.16 — Re-run and refresh stale data**
As a Member, I want to refresh enrichment, so that outdated values can be updated.

Acceptance criteria:
- I can re-run enrichment on selected rows or the whole column, choosing to refresh all cells or only empty/failed ones.
- Refreshing beyond the cache freshness window fetches new data and charges accordingly; within the window it serves cache unless I force a fresh fetch.
- Previous values are overwritten only on a successful new result; a failed refresh leaves the prior value intact and marks the attempt in history.

---

### 4. Functional Requirements (supplementary)

- **FR-2.1** All providers implement one internal adapter contract: given normalized inputs, return normalized outputs plus status, confidence (where available), raw cost, and provider metadata. Orchestration code depends only on this contract, never on a specific provider.
- **FR-2.2** The orchestration engine is provider-agnostic: waterfall ordering, fall-through, acceptance conditions, retries, rate limiting, caching, and metering are implemented once, above the adapter layer.
- **FR-2.3** Input normalization (for example, domain cleaning, name casing, email lowercasing) is applied before cache keys are computed and before provider calls, so caching and de-duplication are effective.
- **FR-2.4** Every billable call is metered atomically with its credit deduction; a call and its charge cannot diverge (no charge without a recorded call; no successful billable call without a charge).
- **FR-2.5** Per-cell state is persisted so status and provenance survive reloads and are queryable for history.
- **FR-2.6** Background execution scales horizontally: adding workers increases throughput without code change; rate limits are enforced globally per provider, not per worker.

---

### 5. Data Model Additions (introduced this phase)

- **provider** (id, key, name, category, default_rate_limit, default_ttl, cost_config_json, supports_byo_key)
- **provider_credential** (id, workspace_id, provider_id, encrypted_key, is_platform_managed, created_at)
- **enrichment_column_config** (id, column_id, steps_json) — `steps_json` is the ordered waterfall: each step has provider_id, operation, input_mapping, output_mapping, acceptance_condition.
- **enrichment_run** (id, workspace_id, table_id, triggered_by, scope_json, status, counts_json, credits_consumed, provider_cost, started_at, finished_at)
- **enrichment_cell_result** (id, cell_id, run_id, provider_id, step_index, status, value_json, confidence, credits, provider_cost, from_cache, fetched_at) — provenance; also mirrored into `cell.meta_json`.
- **enrichment_cache** (id, cache_key, provider_id, operation, result_json, cost, fetched_at, expires_at)
- **credit_ledger** (id, workspace_id, delta, reason, run_id, balance_after, created_at) — internal metering ledger (customer billing added in Phase 4).

---

### 6. Technical Notes (internal)

**Provider set (confirm launch subset at design).** Choose a small, high-coverage set across the core jobs, favoring providers with solid APIs, documented pricing/credit models, and clear terms:
- People/company firmographic: **People Data Labs**, **Apollo.io API** (note plan/API tier constraints), **Coresignal**.
- Email finding: **Prospeo**, **Findymail**, **Hunter.io**, **LeadMagic**, **Dropcontact**, **Datagma**.
- Email verification: **ZeroBounce** or **NeverBounce**.
- Phone: providers offering mobile/phone lookup (for example, **LeadMagic**, **Prospeo** where offered) — validate coverage and terms.
- Company web data at scale: **Bright Data** for structured web datasets where appropriate.

Explicitly avoid dependencies with known legal/continuity risk. Proxycurl (a LinkedIn data API) shut down and should not be built on; treat any LinkedIn-derived data source with caution on terms of use and continuity, and note that own-scraper work in Phase 4 must be assessed for compliance separately.

**Orchestration engine.** Background execution runs on **Celery** with Redis as broker/result backend (studio-standard, mature, fits FastAPI + async external calls). Evaluate at design whether a durable workflow engine adds enough value for the waterfall's retry/fall-through semantics:
- **Celery** — mature, well understood, our default; we implement retry/backoff, rate limiting, and per-cell status ourselves.
- **Hatchet** — newer, Postgres-backed durable task queue with good retry/concurrency primitives; promising if we want durable step orchestration without heavy infrastructure. Emerging; assess stability.
- **Temporal** — very robust durable workflows with built-in retries and state; heavier to operate and a larger conceptual footprint. Mature but likely more than a lean core needs at this stage.
Recommendation: build Phase 2 on Celery; revisit a durable engine only if waterfall complexity or reliability needs demand it.

**Rate limiting and caching.** Enforce global per-provider rate limits using Redis-backed counters/token buckets so limits hold across all workers. Cache keyed on (provider, operation, normalized input) with per-operation TTL. Cache hits and forced-fresh fetches are both recorded for measurable savings.

**Metering.** The credit ledger is append-only. A billable call and its ledger deduction are written together; reconciliation checks that recorded provider calls and ledger entries agree. Provider cost is captured per call for margin reporting (US-2.12) and reused when customer billing is added in Phase 4.

**Reuse in Phase 3.** AI columns and the web-research agent in Phase 3 run on this same execution, status, metering, and caching layer. Design these abstractions to treat "an LLM call" or "an agent run" as just another metered, cached, rate-limited operation.

---

### 7. Dependencies & Assumptions

- Phase 1 is complete: tables, typed columns, the grid with async-capable cell rendering, workspaces, RBAC, and the reserved `cell.meta_json`.
- Accounts and API keys with the selected providers are provisioned before integration testing.
- Provider pricing and credit models are volatile; cost configuration is data-driven so rate changes are a config update, not a code change.
- Legal review of provider terms is completed for the launch set before production use.

---

### 8. Non-Functional Requirements

- **Cost integrity:** no billable call without an atomic, attributable credit deduction; caps enforced (US-2.4, US-2.10, US-2.11).
- **Reliability:** transient failures retried with backoff; one row's failure never fails a whole run (US-2.8).
- **Performance/throughput:** the engine sustains high-volume runs within provider rate limits and scales by adding workers (FR-2.6).
- **Real-time feedback:** per-cell status updates without manual refresh and persists across reload (US-2.6).
- **Security:** provider keys encrypted at rest, never returned in plaintext (US-2.13); tenant isolation from Phase 1 continues to hold for all new entities and is re-tested.

---

### 9. Indicative Effort (planning-level)

| Discipline | Hours | Basis |
|---|---|---|
| Design | 50 | Waterfall builder UX, per-cell status system, credit/usage views, provider config |
| Development | 360 | Adapter framework, initial provider integrations, orchestration engine, rate limiting, retries, caching, metering ledger, run history, auto-run |
| QA | 82 | 20% of Design+Dev; includes cost-integrity, fall-through correctness, rate-limit, and cache tests |
| PM | 41 | 10% of Design+Dev |
| **Total** | **~533** | Indicative; sensitive to the number of launch providers |

Adding providers beyond the launch subset is incremental (one adapter each) and can be estimated per provider once the adapter contract is finalized.
