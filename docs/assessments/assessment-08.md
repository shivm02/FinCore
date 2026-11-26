# Assessment 08 — Payment and notification integrations

## Objective & Implementation Location
- **Primary Path:** `apps/api/src/modules/payments/paymentIntegration.js`
- **Summary:** Sandbox payment intents, HMAC-SHA256 signed webhook verification with replay timestamp window, provider event ID deduplication, mismatched/failed settlement handling, reconciliation, and sandbox email/SMS notifications.

## Verification & Evidence
- Run `make test` from the repository root (see captured live output in `docs/evidence/TEST_RUN_EVIDENCE.txt`).
- All simulated balances and provider integrations operate strictly in sandbox mode; no real funds or credentials are used.
