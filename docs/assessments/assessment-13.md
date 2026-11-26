# Assessment 13 — Financial API contracts

## Objective & Implementation Location
- **Primary Path:** `docs/api/openapi.yaml & fincore.postman_collection.json`
- **Summary:** OpenAPI 3.1 specification and importable Postman v2.1 collection documenting transaction lifecycle, fixed-point decimals, idempotency headers, webhook signatures, error codes, and test-mode setup.

## Verification & Evidence
- Run `make test` from the repository root (see captured live output in `docs/evidence/TEST_RUN_EVIDENCE.txt`).
- All simulated balances and provider integrations operate strictly in sandbox mode; no real funds or credentials are used.
