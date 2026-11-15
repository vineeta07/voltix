.PHONY: setup dev api web test lint e2e up down audit

setup:            ## install backend and frontend dependencies
	cd backend && uv venv .venv && uv pip install -e ".[dev]"
	cd frontend && npm ci

api:              ## API with the built-in simulator and demo data (SQLite)
	cd backend && VOLTIX_SIMULATE=1 VOLTIX_SEED_DEMO=1 VOLTIX_DEV_LOGIN=1 \
		.venv/bin/uvicorn app.main:app --reload --port 8000

web:              ## web app on http://localhost:3000
	cd frontend && npm run dev

test:             ## backend unit and integration tests
	cd backend && .venv/bin/python -m pytest -q

lint:             ## ruff, mypy, eslint, tsc
	cd backend && .venv/bin/ruff check app tests ../edge ../tools && .venv/bin/mypy app
	cd frontend && npx eslint src e2e && npx tsc --noEmit

e2e:              ## Playwright, 390 px and 1440 px (needs `make api` and `make web` running)
	cd frontend && npx playwright test --trace off

audit:            ## dependency vulnerability scan
	cd backend && .venv/bin/pip-audit
	cd frontend && npm audit --audit-level=high

up:               ## full stack in Docker
	docker compose up --build -d

down:
	docker compose down
