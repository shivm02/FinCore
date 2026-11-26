# Assessment 15 — Financial incident simulation

## Objective & Implementation Location
- **Primary Path:** `docs/incidents/INCIDENT_REPORT_001.md & apps/api/tests/capstone-incident.test.js`
- **Summary:** Automated simulation and full postmortem covering duplicate payment events, mismatched settlement, unbalanced ledger attempts, concurrency/latency, and suspicious activity alerts with proof of recovery.

## Verification & Evidence
- Run `make test` from the repository root (see captured live output in `docs/evidence/TEST_RUN_EVIDENCE.txt`).
- All simulated balances and provider integrations operate strictly in sandbox mode; no real funds or credentials are used.
