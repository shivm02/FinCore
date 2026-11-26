# Assessment 06 — FastAPI risk analytics

## Objective & Implementation Location
- **Primary Path:** `services/analytics/app/risk/scoring.py & app/main.py`
- **Summary:** FastAPI + Pydantic service scoring transaction velocity, cumulative volume, new-beneficiary anomalies, and operations summaries using synthetic data with mandatory decision-support disclaimer and service-token auth.

## Verification & Evidence
- Run `make test` from the repository root (see captured live output in `docs/evidence/TEST_RUN_EVIDENCE.txt`).
- All simulated balances and provider integrations operate strictly in sandbox mode; no real funds or credentials are used.
