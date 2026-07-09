# Cascade — Phase 1 developer tasks.
# Local runtime is Postgres + Redis in Docker; backend runs on the host via uv.
SHELL := /bin/bash
UV := $(HOME)/.local/bin/uv
export PATH := $(HOME)/.local/bin:$(PATH)

.DEFAULT_GOAL := help

.PHONY: help
help: ## List targets
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ── Infra ────────────────────────────────────────────────────────────────────
.PHONY: up down logs psql redis-cli
up: ## Start Postgres + Redis (detached)
	docker compose up -d postgres redis
	@echo "waiting for healthy…" && sleep 2 && docker compose ps

down: ## Stop all containers
	docker compose down

nuke: ## Stop and delete DB/redis volumes (fresh start)
	docker compose down -v

logs: ## Tail infra logs
	docker compose logs -f postgres redis

psql: ## Open psql as the app (RLS-constrained) role
	docker compose exec postgres psql -U cascade_app -d cascade

psql-owner: ## Open psql as the schema owner
	docker compose exec postgres psql -U cascade_owner -d cascade

redis-cli: ## Open redis-cli
	docker compose exec redis redis-cli

# ── Backend ──────────────────────────────────────────────────────────────────
.PHONY: be-install be-dev worker migrate makemigration test test-isolation test-rbac seed100k
be-install: ## Install backend deps (uv)
	cd backend && $(UV) sync

be-dev: ## Run FastAPI (host, hot reload)
	cd backend && $(UV) run uvicorn app.main:app --reload --port 8000

worker: ## Run the Celery worker (host)
	cd backend && $(UV) run celery -A app.workers.celery_app worker -l info

migrate: ## Apply DB migrations (as owner)
	cd backend && $(UV) run alembic upgrade head

makemigration: ## Create a migration: make makemigration m="message"
	cd backend && $(UV) run alembic revision --autogenerate -m "$(m)"

test: ## Run the full backend test suite
	cd backend && $(UV) run pytest -q

test-isolation: ## Run only the cross-tenant RLS isolation suite (the gate)
	cd backend && $(UV) run pytest -q tests/isolation

test-rbac: ## Run only the RBAC matrix suite
	cd backend && $(UV) run pytest -q tests/rbac

seed100k: ## Seed a 100k-row table for perf testing
	cd backend && $(UV) run python -m app.scripts.seed_100k

# ── Frontend ─────────────────────────────────────────────────────────────────
.PHONY: fe-install fe-dev fe-build fe-test fe-e2e kitchen
fe-install: ## Install frontend deps (pnpm)
	pnpm install

fe-dev: ## Run the Next.js dev server
	pnpm --filter web dev

fe-build: ## Production build of the web app
	pnpm --filter web build

fe-test: ## Frontend unit tests (vitest)
	pnpm -r test

fe-e2e: ## Playwright end-to-end tests
	pnpm --filter web e2e

kitchen: ## Open the component kitchen-sink route
	@echo "run 'make fe-dev' then open http://localhost:3000/kitchen-sink"

# ── Meta ─────────────────────────────────────────────────────────────────────
.PHONY: walkthrough
walkthrough: ## End-to-end demo script (skeleton + full flow)
	cd backend && $(UV) run python -m app.scripts.walkthrough
