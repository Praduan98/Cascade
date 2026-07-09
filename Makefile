# Cascade — Phase 1 frontend developer tasks.
# Frontend + design only: no backend, no Docker. Runs on Node/pnpm.
SHELL := /bin/bash
export PATH := $(HOME)/.local/bin:$(PATH)

.DEFAULT_GOAL := help

.PHONY: help install dev build start typecheck lint test e2e fonts kitchen clean
help: ## List targets
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install workspace deps (pnpm)
	pnpm install

dev: ## Run the Next.js dev server (http://localhost:3000)
	pnpm --filter web dev

build: ## Production build of the web app
	pnpm --filter web build

start: ## Serve the production build
	pnpm --filter web start

typecheck: ## Typecheck all workspaces
	pnpm -r typecheck

lint: ## Lint all workspaces
	pnpm -r lint

test: ## Unit tests (vitest) across workspaces
	pnpm -r test

e2e: ## Playwright end-to-end tests
	pnpm --filter web e2e

fonts: ## Regenerate woff2 files from design/src/fonts.css
	node packages/ui/fonts/extract.mjs

kitchen: ## Reminder: component gallery route
	@echo "run 'make dev' then open http://localhost:3000/kitchen-sink"

clean: ## Remove build artifacts and installs
	rm -rf node_modules apps/web/.next packages/*/node_modules apps/web/node_modules
