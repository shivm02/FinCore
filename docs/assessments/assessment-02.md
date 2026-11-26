# Assessment 02 — Financial REST APIs

## Objective & Implementation Location
- **Primary Path:** `apps/api/src/app.js`
- **Summary:** Modular REST API covering auth, wallets, beneficiaries, transfers, payment intents, webhooks, reversals, disputes, statements, ledger invariant checks, and audit logs with consistent safe error envelopes.

## Verification & Evidence
- Run `make test` from the repository root (see captured live output in `docs/evidence/TEST_RUN_EVIDENCE.txt`).
- All simulated balances and provider integrations operate strictly in sandbox mode; no real funds or credentials are used.
