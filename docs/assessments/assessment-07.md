# Assessment 07 — Transfer consistency engine

## Objective & Implementation Location
- **Primary Path:** `apps/api/src/modules/ledger/ledgerEngine.js`
- **Summary:** Atomic double-entry transfers, deterministic lock ordering (deadlock-free), optimistic version checks, idempotency key SHA-256 payload conflict detection, explicit state transitions, and balance/hold enforcement.

## Verification & Evidence
- Run `make test` from the repository root (see captured live output in `docs/evidence/TEST_RUN_EVIDENCE.txt`).
- All simulated balances and provider integrations operate strictly in sandbox mode; no real funds or credentials are used.
