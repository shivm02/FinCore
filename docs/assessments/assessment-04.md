# Assessment 04 — Financial identity and authorization

## Objective & Implementation Location
- **Primary Path:** `apps/api/src/modules/auth/authService.js`
- **Summary:** scrypt password hashing (never plaintext), HS256 JWT access/refresh tokens with revocation, MFA simulation challenge/verify, 5-role RBAC matrix, resource ownership checks, sensitive-action reauthentication, and immutable audit trail.

## Verification & Evidence
- Run `make test` from the repository root (see captured live output in `docs/evidence/TEST_RUN_EVIDENCE.txt`).
- All simulated balances and provider integrations operate strictly in sandbox mode; no real funds or credentials are used.
