.PHONY: help install setup dev build lint db-migrate db-reset db-types db-seed \
       agents-setup agents-dev agents-docker agents-docker-down \
       generate-content generate-practice-problems \
       cli-health cli-generate-lesson cli-seed-practice-problems \
       setup-all dev-all clean

# —— Help ——

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# —— Next.js ——

install: ## Install Node dependencies
	pnpm install

setup: install## Full Next.js setup (install + schema + seed)
	@echo "\n✅ Next.js setup complete. Add your keys to .env using secrets-sync command, then run: make dev"

dev: ## Start Next.js dev server
	pnpm dev

build: ## Production build
	pnpm build

lint: ## Run ESLint
	pnpm lint

# —— Database ——

db-migrate: ## Apply pending Supabase migrations
	supabase db push

db-reset: ## Reset local Supabase database
	supabase db reset

db-types: ## Regenerate Supabase TypeScript types
	npx supabase gen types typescript --project-id "xyhkkzuomlzfqfkdyoor" --schema public > src/types/supabase.ts


db-seed: ## Seed questions and lessons
	pnpm db:seed

# —— Agno Agents ——

agents-setup: ## Set up the Python agent service (create venv + install deps)
	cd agents && python3 -m venv .venv && \
		. .venv/bin/activate && \
		pip install -e .
	@if [ ! -f agents/.env ]; then cp agents/.env.example agents/.env; echo "\n⚠️  Created agents/.env from .env.example — fill in your keys"; fi
	@echo "\n✅ Agent setup complete."

agents-dev: ## Run the agent service locally (no Docker)
	cd agents && . .venv/bin/activate && uvicorn main:app --reload --port 8080

agents-docker: ## Start the agent service via Docker Compose
	docker compose up --build -d

agents-docker-down: ## Stop the agent service
	docker compose down

generate-content: ## Run SAT content generation workflow (topics → subtopics → problems)
	cd agents && . .venv/bin/activate && python -m cli.main generate-content

generate-practice-problems: ## Run practice problems generation workflow (topics → subtopics → problems)
	cd agents && . .venv/bin/activate && python seed_all_practice_problems.py

cli-health: ## Check agent service status (local Python, no server needed)
	cd agents && . .venv/bin/activate && python -m cli.main health

cli-generate-lesson: ## Generate a lesson — pass args via ARGS="--question-text ... --correct-answer ... --category ... --explanation ..."
	cd agents && . .venv/bin/activate && python -m cli.main generate-lesson $(ARGS)

cli-seed-practice-problems: ## Seed practice problems — pass args via ARGS="--topic ... --subtopic ... [--subject math] [--count 60]"
	cd agents && . .venv/bin/activate && python -m cli.main seed-practice-problems $(ARGS)

# —— Combined ——

setup-all: setup agents-setup ## Full setup for both Next.js and agents
	@echo "\n✅ All services set up. Configure .env.local and agents/.env, then run: make dev-all"

dev-all: ## Start both Next.js and the agent service concurrently
	@echo "Starting agent service..."
	@cd agents && . .venv/bin/activate && uvicorn main:app --reload --port 8080 &
	@echo "Starting Next.js..."
	@pnpm dev

clean: ## Remove build artifacts and generated files
	rm -rf .next node_modules agents/.venv agents/__pycache__

# ─── Secrets CLI (auto-generated) ────────────────────────────────────────────

.PHONY: secrets-login secrets-logout secrets-whoami secrets-switch secrets-list secrets-sync

secrets-login:
	npx @superset-signal/secrets login

secrets-logout:
	npx @superset-signal/secrets logout

secrets-whoami:
	npx @superset-signal/secrets whoami

secrets-switch:
	npx @superset-signal/secrets switch

secrets-list:
	npx @superset-signal/secrets list

secrets-sync:
	npx @superset-signal/secrets sync
# ─── End Secrets CLI ─────────────────────────────────────────────────────────
