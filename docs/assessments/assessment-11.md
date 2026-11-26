# Assessment 11 — Secure financial CI/CD

## Objective & Implementation Location
- **Primary Path:** `.github/workflows/`
- **Summary:** GitHub Actions workflows for tests, Gitleaks secret scanning, npm/pip dependency audits, Trivy container image scanning, build provenance attestation, staging smoke gate, manual production approval, and rollback guard.

## Verification & Evidence
- Run `make test` from the repository root (see captured live output in `docs/evidence/TEST_RUN_EVIDENCE.txt`).
- All simulated balances and provider integrations operate strictly in sandbox mode; no real funds or credentials are used.
