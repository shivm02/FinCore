# FinCore — Digital Wallet, Ledger & Payment Processing Platform (Project 02)

> **EDUCATIONAL SIMULATION NOTICE:** All accounts, balances, transfers, payment intents, webhooks, and risk alerts in FinCore are 100% synthetic. No real funds, banking credentials, or PII are used.

## Overview
FinCore is a full-stack simulated digital finance platform built for **Orion LMS — Project 02**, covering all **15 mandatory hands-on assessments** and the **Domain-Specific Capstone Challenge**.

## Repository Structure
- `apps/web/` — Next.js App Router + TypeScript + Tailwind CSS + TanStack Query + Zod frontend (Assessment 01)
- `apps/api/` — Node.js / Express modular REST API, Auth/RBAC, Double-Entry Ledger Engine, Payment/Webhook Integrations & Test Suites (Assessments 02, 04, 07, 08, 12, 15)
- `services/analytics/` — Python 3.11 + FastAPI + Pydantic `Decimal` Financial Calculations & Risk Analytics Service (Assessments 05, 06)
- `db/` — PostgreSQL migrations, immutability & balance triggers, synthetic seed, and schema verifier (Assessment 03)
- `infra/` & `docker-compose*.yml` — Hardened non-root containers, Nginx TLS 1.3 proxy, Prometheus alert rules, encrypted backup & restore drills (Assessments 09, 14)
- `.github/` & `docs/governance/` — CODEOWNERS, PR/Hotfix templates, semantic commit rules, GitHub Actions CI/CD security pipelines (Assessments 10, 11)
- `docs/api/` — OpenAPI 3.1 specification & Postman v2.1 collection (Assessment 13)
- `docs/architecture/`, `docs/incidents/`, `docs/assessments/`, `docs/evidence/` — Architecture/ER diagrams, Incident Postmortem, all 15 Assessment READMEs, and captured live test evidence.

## Quick Start & Verification
1. **Copy environment template:**
   ```bash
   cp .env.example .env
   ```
2. **Run all automated verification suites locally (zero external DB needed for unit/engine suites):**
   ```bash
   make test
   ```
3. **Run encrypted backup & restore drill:**
   ```bash
   BACKUP_ENCRYPTION_PASSPHRASE="local-drill-key" bash infra/scripts/backup_db.sh
   BACKUP_ENCRYPTION_PASSPHRASE="local-drill-key" bash infra/scripts/restore_drill.sh
   ```
4. **Launch full containerized stack (PostgreSQL + Redis + FastAPI + Express API + Worker + Next.js):**
   ```bash
   docker compose up --build -d
   ```

## Disclosed Sandbox Mocks & Limitations
- **Payment Provider & Notifications (`Assessment 08`):** Implemented as deterministic sandbox adapters with real HMAC-SHA256 signature verification, replay windows, and event deduplication; no live Stripe/Twilio/SMTP accounts are called.
- **Database Runtime in Unit Tests:** `db/migrations/*.sql` contains full PostgreSQL 16 DDL, triggers, and constraints for Docker/production deployment; `apps/api` tests run against the exact same double-entry invariant engine in memory so CI and local learners can verify concurrency, idempotency, and invariants rapidly without external dependencies.
- **Risk Analytics (`Assessment 06`):** Uses synthetic rule-based scoring explicitly marked as decision support only, not proof of fraud.

## All 15 Mandatory Assessments Index
See `docs/assessments/assessment-01.md` through `docs/assessments/assessment-15.md` for per-assessment design notes and verification steps.
