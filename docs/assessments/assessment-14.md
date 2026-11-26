# Assessment 14 — Secure deployment and recovery

## Objective & Implementation Location
- **Primary Path:** `infra/nginx/, infra/monitoring/, infra/scripts/`
- **Summary:** HTTPS TLS 1.3 Nginx reverse proxy with rate limiting, private DB/analytics isolation, Prometheus alert rules, AES-256 encrypted backup script (`backup_db.sh`), and automated restore drill (`restore_drill.sh`).

## Verification & Evidence
- Run `make test` from the repository root (see captured live output in `docs/evidence/TEST_RUN_EVIDENCE.txt`).
- All simulated balances and provider integrations operate strictly in sandbox mode; no real funds or credentials are used.
