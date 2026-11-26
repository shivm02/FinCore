# Assessment 03 — Double-entry ledger database

## Objective & Implementation Location
- **Primary Path:** `db/migrations/`
- **Summary:** PostgreSQL migrations with NUMERIC(19,4) precision, append-only immutability triggers (`trg_ledger_entries_immutable`, `trg_audit_logs_immutable`), deferred balance-sum trigger (`trg_ledger_entries_balanced`), synthetic seed, and `db/scripts/verify_schema.py`.

## Verification & Evidence
- Run `make test` from the repository root (see captured live output in `docs/evidence/TEST_RUN_EVIDENCE.txt`).
- All simulated balances and provider integrations operate strictly in sandbox mode; no real funds or credentials are used.
