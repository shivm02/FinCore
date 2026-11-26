# Assessment 12 — Ledger and payment testing

## Objective & Implementation Location
- **Primary Path:** `apps/api/tests/ & services/analytics/tests/`
- **Summary:** Automated suites proving insufficient funds, duplicate requests, 10 concurrent transfers, reversals, webhook replay, rounding boundaries, failed/mismatched settlements, and global ledger balance invariants.

## Verification & Evidence
- Run `make test` from the repository root (see captured live output in `docs/evidence/TEST_RUN_EVIDENCE.txt`).
- All simulated balances and provider integrations operate strictly in sandbox mode; no real funds or credentials are used.
