# Cascade — Functional Specification Document
## Phase 3: Intelligence & Automation — AI Columns, Web Research Agent, Triggers & Integrations

| Field | Value |
|---|---|
| Phase | 3 of 4 |
| Depends on | Phase 1 (tables/grid/RBAC) and Phase 2 (execution, per-cell status, metering, caching) |
| Enables | Phase 4 (SaaS): these capabilities become sellable features and consume billable credits |
| Audience | Internal — SDTC Digital / InsightsTap |
| Version | 1.0 (Draft) |
| Date | July 2026 |

---

### 1. Phase Overview

Phase 3 adds intelligence and orchestration on top of the enrichment engine. It introduces AI columns (LLM-powered cells that reference other columns), a web-research agent that browses and scrapes the open web and returns structured, sourced data from a prompt (our equivalent of Clay's Claygent), an HTTP/API column for arbitrary REST calls, a formula/conditional-logic column, and the automation layer: triggers, scheduling, inbound and outbound webhooks, CRM push/pull, and Slack notifications.

Crucially, all of this runs on the Phase 2 execution, per-cell status, metering, caching, and rate-limiting layer. An LLM call and an agent run are treated as metered, cached, retryable operations, exactly like a provider call. This keeps cost control and reliability uniform across the product.

---

### 2. Scope

#### 2.1 In scope

- **AI column:** a prompt-driven column that references other cells and writes an LLM-generated result (text or structured fields), using Claude / OpenAI / Gemini.
- **Structured output:** enforce a defined output schema so AI columns can populate multiple typed fields reliably.
- **Web-research agent column:** given an entity and a research prompt, browse/search/scrape the web, extract requested fields, and return them with source citations.
- **HTTP/API column:** call an external REST endpoint per row, map request inputs from cells, and parse the JSON response into output cells.
- **Formula column:** compute values from other columns with conditional logic (if/then), string and number operations, and references.
- **Triggers and scheduling:** run enrichment/AI/agent columns on a schedule or in response to row events (row added, cell changed).
- **Inbound webhook:** an endpoint per table that creates records from posted data.
- **Outbound webhook:** post row/cell data to an external URL when a condition is met (row added, cell reaches a value).
- **CRM integrations:** push records to and pull records from HubSpot, Salesforce, and Pipedrive.
- **Slack notifications:** notify a channel on run completion or when a threshold/condition is met.
- **Cost controls for AI/agent:** budget caps and confirmations extended to LLM and agent operations.

#### 2.2 Out of scope (deferred)

- Customer-facing billing/credit purchase and plan tiers (Phase 4); Phase 3 meters AI/agent credits internally using the Phase 2 ledger.
- Superadmin panel, templates library, outbound sequencing to email tools, own scrapers (Phase 4).
- A full visual workflow/automation builder. Phase 3 provides column-level triggers and webhooks, not a general drag-and-drop automation canvas.

---

### 3. User Stories & Acceptance Criteria

Story IDs use the pattern `US-3.x`.

---

**US-3.1 — Add an AI column with a prompt that references cells**
As a Member, I want an AI column that uses a prompt referencing other columns, so that I can generate or transform data per row.

Acceptance criteria:
- I can add an AI column, write a prompt, and insert references to other columns (for example, `{{Company Name}}`, `{{Job Title}}`) that are substituted per row at run time.
- I can select the model (Claude / OpenAI / Gemini) and it has a sensible default.
- Running the column produces a result per row, written to the output cell, using the Phase 2 async status states (Queued/Running/Success/Empty/Failed).
- Rows with missing referenced inputs show Empty with a reason and consume no credits.
- Each AI cell records the model used and the credit/cost, viewable in provenance.

**US-3.2 — Enforce structured output from an AI column**
As a Member, I want an AI column to return multiple typed fields reliably, so that I can populate several columns from one prompt without parsing free text.

Acceptance criteria:
- I can define an output schema (named fields with types) for an AI column.
- The system enforces the schema so the model returns valid, parseable structured data; malformed output is repaired or retried, not written raw.
- Each schema field maps to its own output cell/column.
- If the model cannot produce a valid field value, that field is Empty with a reason while valid fields still populate.

**US-3.3 — Research the web with an AI agent column**
As a Member, I want an agent that researches the web from a prompt, so that I can gather data no static provider offers (for example, "what does this company sell," "recent funding news").

Acceptance criteria:
- I can add a web-research agent column, provide a research prompt referencing cells (for example, the company domain/name), and define the structured fields I want back.
- The agent searches and/or fetches web pages relevant to the entity and extracts the requested fields.
- The result includes source references (URLs) for the returned data.
- The agent returns structured output per the defined fields (ties to US-3.2 behavior).
- Runs use async per-cell status; failures (no sources found, extraction failed, timeout) are reported distinctly.
- Agent runs are metered as billable operations and respect budget caps (US-3.11).

**US-3.4 — Control agent cost and depth**
As a Workspace Admin, I want to bound how much the agent does per row, so that research does not spend unpredictably.

Acceptance criteria:
- I can set limits on agent work per row (for example, maximum pages fetched or maximum search/extraction steps).
- Before a bulk agent run, I see an estimated maximum cost and must confirm.
- The agent stops at the configured limit and returns what it found rather than continuing unbounded.
- Per-row agent cost is recorded and visible in usage (reusing Phase 2 metering).

**US-3.5 — Call an external API with an HTTP column**
As a Developer/Integrator, I want a column that calls a REST endpoint per row, so that I can integrate any external data source or service.

Acceptance criteria:
- I can configure method, URL, headers, and body, with cell references substituted per row.
- I can map fields from the JSON response into output cells using a path expression.
- Requests run asynchronously with per-cell status and are rate-limited and retried like provider calls.
- Secrets used in headers (for example, API keys) are stored securely and not exposed in the UI after entry.
- Non-2xx responses mark the cell Failed with the status code and a message.

**US-3.6 — Compute values with a formula column**
As a Member, I want formula columns with conditional logic, so that I can derive fields without external calls.

Acceptance criteria:
- I can write a formula referencing other columns using string, number, date, and boolean operations and if/then/else logic.
- The formula recomputes when a referenced cell changes.
- Formula errors (for example, referencing a non-existent column, type mismatch) are shown clearly in the cell and do not crash the table.
- Formula columns consume no external credits.

**US-3.7 — Schedule automatic runs**
As a Member, I want columns to run on a schedule, so that data refreshes without manual triggering.

Acceptance criteria:
- I can schedule an enrichment, AI, or agent column to run at a defined interval (for example, daily, weekly).
- Scheduled runs honor "only empty" and cost caps as configured.
- I can see the next scheduled run time and the last run outcome.
- I can pause or delete a schedule.
- Scheduled runs respect the workspace budget and stop when it is exhausted.

**US-3.8 — Trigger runs on row events**
As a Member, I want runs to fire when data changes, so that automation reacts to new or updated rows.

Acceptance criteria:
- I can configure a column to run when a new row is added or when a specified source cell changes value.
- The triggered run targets only the affected row(s).
- Event-triggered runs honor cost caps and the workspace budget.
- Triggers can be enabled/disabled per column.

**US-3.9 — Ingest records via an inbound webhook**
As a Developer/Integrator, I want to post data into a table, so that external systems can add records automatically.

Acceptance criteria:
- Each table can expose a unique, secret inbound webhook URL.
- Posting a valid payload creates a record with fields mapped to columns per a defined mapping.
- The endpoint authenticates the caller (secret token or signature) and rejects unauthorized posts.
- Malformed payloads return a clear error and create no record.
- Newly created rows can trigger auto-run/enrichment per existing configuration (ties to US-2.7 / US-3.8).

**US-3.10 — Send data out via an outbound webhook**
As a Developer/Integrator, I want to post row data to an external URL on a condition, so that Cascade can notify or feed other systems.

Acceptance criteria:
- I can configure an outbound webhook that fires when a row is added or when a cell reaches a specified condition.
- The payload includes the selected fields for the row and is delivered to the configured URL.
- Delivery failures are retried with backoff and logged; repeated failures are surfaced.
- Deliveries are recorded in history with status.

**US-3.11 — Cost caps extend to AI and agent operations**
As a Workspace Admin, I want AI and agent spend bounded, so that intelligent features cannot overrun the budget.

Acceptance criteria:
- Per-run maximums and the workspace budget from Phase 2 apply to AI columns and agent columns.
- A run that would exceed the per-run maximum is blocked with a clear message before execution.
- When the workspace budget is exhausted, AI/agent runs pause and the workspace is notified.
- Scheduled and event-triggered AI/agent runs stop queuing when a cap is reached.

**US-3.12 — Push records to a CRM**
As a Member, I want to push enriched records to our CRM, so that sales can act on them.

Acceptance criteria:
- I can connect a CRM (HubSpot, Salesforce, or Pipedrive) to the workspace via its authorization flow.
- I can map table columns to CRM object fields (for example, Contact/Company properties).
- I can push selected rows or the whole table; each push reports created/updated/failed counts.
- Duplicate handling is defined (create vs update by a chosen key) and applied.
- Push results and any per-record errors are recorded in history.

**US-3.13 — Pull records from a CRM**
As a Member, I want to import CRM records into a table, so that I can enrich existing CRM data.

Acceptance criteria:
- I can pull records from a connected CRM into a table using a filter/segment where supported.
- CRM fields map to columns; the source record identifier is retained for later push-back.
- Pulled rows can be enriched and pushed back, updating the original CRM records (ties to US-3.12 duplicate handling).
- The pull reports how many records were imported.

**US-3.14 — Notify Slack on completion or condition**
As a Member, I want Slack alerts, so that the team knows when runs finish or thresholds are met.

Acceptance criteria:
- I can connect Slack to the workspace and choose a channel.
- I can configure a notification on run completion (with a summary: counts, credits used) or when a condition is met (for example, "N new deliverable emails found").
- Notifications are delivered to the chosen channel.
- Notification configuration can be edited or removed.

**US-3.15 — Provenance and history for AI, agent, HTTP, and automation**
As a Workspace Admin, I want visibility into AI/agent/HTTP runs and automation events, so that results are explainable and issues are debuggable.

Acceptance criteria:
- AI and agent cells record the model/agent used, cost, and (for the agent) source URLs, viewable per cell.
- HTTP columns record request status per row.
- Trigger, schedule, webhook, CRM, and Slack events are recorded in history with timestamps and outcomes.
- History is viewable by Admin/Owner and respects tenant isolation.

---

### 4. Functional Requirements (supplementary)

- **FR-3.1** AI, agent, and HTTP operations execute on the Phase 2 layer: async jobs, per-cell status, retries/backoff, rate limiting, caching, and atomic credit metering. No parallel execution path is created.
- **FR-3.2** Structured output enforcement is centralized so AI columns and the agent share one schema-validation/repair mechanism.
- **FR-3.3** Prompt templating (cell references, substitution) is one shared subsystem used by AI columns, the agent, HTTP columns, and outbound webhooks.
- **FR-3.4** LLM and agent results are cached on (model, resolved prompt, relevant inputs) with configurable TTL, so repeated identical requests do not re-spend (reusing Phase 2 caching). Caching for the agent accounts for freshness needs of web data.
- **FR-3.5** All external credentials (LLM keys, CRM tokens, Slack tokens, HTTP secrets) are encrypted at rest and never returned to the client in plaintext.
- **FR-3.6** Automation (triggers, schedules, webhooks) cannot bypass budget caps or tenant isolation.

---

### 5. Data Model Additions (introduced this phase)

- **ai_column_config** (id, column_id, provider_model, prompt_template, output_schema_json, cache_ttl)
- **agent_column_config** (id, column_id, prompt_template, output_schema_json, max_steps, max_pages, cache_ttl)
- **http_column_config** (id, column_id, method, url_template, headers_json, body_template, response_mapping_json, secret_ref)
- **formula_column_config** (id, column_id, expression)
- **automation** (id, workspace_id, table_id, type[schedule|row_event], target_column_id, config_json, is_enabled, next_run_at, last_run_at)
- **webhook_inbound** (id, table_id, secret, mapping_json, is_enabled)
- **webhook_outbound** (id, table_id, condition_json, url, fields_json, is_enabled)
- **crm_connection** (id, workspace_id, provider, encrypted_token, config_json)
- **crm_sync_run** (id, crm_connection_id, direction[push|pull], counts_json, started_at, finished_at)
- **slack_connection** (id, workspace_id, encrypted_token, default_channel)
- **integration_event** (id, workspace_id, source, detail_json, status, created_at) — unified log for webhook/CRM/Slack/automation events.

AI/agent/HTTP results continue to write per-cell provenance into `cell.meta_json` and reuse the Phase 2 `credit_ledger`, `enrichment_cache`, and status machinery.

---

### 6. Technical Notes (internal)

**LLM integration.** Route AI columns to Claude / OpenAI / Gemini via a thin provider abstraction so models are swappable and metered uniformly. Use a structured-output/validation layer to guarantee schema-valid results:
- **instructor** (Python) or **Pydantic AI** for schema-enforced LLM outputs against Pydantic models. Both are current and practical; instructor is widely used, Pydantic AI is newer but well-supported. Either satisfies FR-3.2.
- Consider **BAML** or **Outlines** as alternatives for stricter structured generation if needed; treat as emerging.

**Web-research agent (Claygent equivalent).** Compose a search/fetch/extract stack rather than building a browser from scratch:
- Web fetch/scrape to clean content: **Firecrawl** (LLM-friendly page-to-markdown, handles rendering) is a strong mature-enough default. Alternatives: **Apify**, **Browserbase** or **Browserless** (headless browser infra), **ScrapingBee**.
- Search/retrieval: **Exa**, **Tavily**, or **Serper** (Google results API) to find relevant pages for an entity.
- Orchestration of the agent loop: keep it deliberately bounded (search, fetch top sources, extract with an LLM under a schema). **LangGraph** or **Pydantic AI** can structure the loop; a lean custom loop is acceptable and easier to cost-bound. Enforce the per-row step/page caps from US-3.4.
Recommendation: Firecrawl + a search API (Exa or Serper) + instructor/Pydantic AI extraction, with a bounded custom agent loop. Return source URLs with every result.

**HTTP/formula columns.** HTTP columns reuse the provider execution path (rate limit, retry, status). Formula evaluation uses a safe, sandboxed expression evaluator; no arbitrary code execution.

**Automation.** Schedules run via a periodic scheduler feeding the Celery execution layer (for example, Celery beat or an equivalent), keyed on `automation.next_run_at`. Row-event triggers hook the record/cell mutation path from Phase 1/2 and enqueue targeted runs. Inbound webhooks are authenticated FastAPI endpoints; outbound webhooks and CRM/Slack calls reuse retry/backoff and are logged to `integration_event`.

**CRM connectors.** Use each CRM's official API and OAuth flow (HubSpot, Salesforce, Pipedrive). Store tokens encrypted; handle token refresh. Map fields configurably; define duplicate strategy (create vs update by key) explicitly per US-3.12.

**Caching web/LLM results.** Reuse Phase 2 caching with appropriate TTLs. LLM results for deterministic prompts cache well; agent/web results need shorter freshness windows because the underlying web data changes.

---

### 7. Dependencies & Assumptions

- Phase 2 is complete: execution layer, per-cell status, credit ledger, caching, rate limiting.
- LLM provider accounts/keys (Claude, OpenAI, Gemini) and the chosen web-scrape/search services are provisioned.
- CRM developer apps (HubSpot, Salesforce, Pipedrive) and a Slack app are registered for OAuth.
- LLM and scrape/search pricing feeds into the same data-driven cost configuration as providers, so credit rates for AI/agent operations are configurable.
- Legal/ToS review covers web-scraping via the chosen tools and any CRM data handling.

---

### 8. Non-Functional Requirements

- **Cost integrity:** AI/agent/HTTP operations metered atomically; caps enforced (US-3.4, US-3.11).
- **Determinism where possible:** structured output enforced so AI columns are reliable, not free-text guesses (US-3.2).
- **Explainability:** agent results carry source citations (US-3.3, US-3.15).
- **Reliability:** automation and integrations retry transient failures and log outcomes; one failure does not cascade.
- **Security:** all third-party credentials encrypted at rest and never surfaced in plaintext; inbound webhooks authenticated; tenant isolation re-verified for all new entities.

---

### 9. Indicative Effort (planning-level)

| Discipline | Hours | Basis |
|---|---|---|
| Design | 40 | AI/agent column UX, schema builder, automation and integration configuration surfaces |
| Development | 340 | AI columns, structured output, web-research agent, HTTP/formula columns, scheduler/triggers, inbound/outbound webhooks, HubSpot/Salesforce/Pipedrive connectors, Slack |
| QA | 76 | 20% of Design+Dev; includes structured-output reliability, agent cost-bounding, webhook auth, CRM sync correctness |
| PM | 38 | 10% of Design+Dev |
| **Total** | **~494** | Indicative; CRM connector count is a swing factor |

Each additional CRM or third-party connector beyond the three named is incremental and estimated separately once the connector pattern is finalized.
