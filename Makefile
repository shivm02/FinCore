.PHONY: help up down test test-api test-analytics test-db verify-all backup restore-drill

help:
	@echo "FinCore Project 02 Commands:"
	@echo "  make up            - Start full Docker Compose stack"
	@echo "  make down          - Stop Docker Compose stack"
	@echo "  make test          - Run all API, Python analytics, and DB verification tests"
	@echo "  make test-api      - Run Node.js API & ledger consistency tests"
	@echo "  make test-analytics- Run Python Decimal calculation & FastAPI risk tests"
	@echo "  make test-db       - Verify PostgreSQL migration schema & invariants"
	@echo "  make backup        - Run encrypted backup script"
	@echo "  make restore-drill - Run restore drill verification"

up:
	docker compose up --build -d

down:
	docker compose down

test: test-db test-api test-analytics

test-db:
	python3 db/scripts/verify_schema.py

test-api:
	node --test apps/api/tests/*.test.js

test-analytics:
	PYTHONPATH=services/analytics python3 -m unittest discover -s services/analytics/tests -v

backup:
	./infra/scripts/backup_db.sh

restore-drill:
	./infra/scripts/restore_drill.sh
