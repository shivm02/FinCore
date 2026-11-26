# Assessment 05 — Python financial calculations

## Objective & Implementation Location
- **Primary Path:** `services/analytics/app/calculations/engine.py`
- **Summary:** Pure `decimal.Decimal` fee, accrued interest, statement, and reconciliation calculations rejecting binary floats, supporting ROUND_HALF_EVEN / ROUND_HALF_UP boundaries, and precision benchmark.

## Verification & Evidence
- Run `make test` from the repository root (see captured live output in `docs/evidence/TEST_RUN_EVIDENCE.txt`).
- All simulated balances and provider integrations operate strictly in sandbox mode; no real funds or credentials are used.
