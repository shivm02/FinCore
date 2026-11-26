# Git & Change Governance Policy (Assessment 10)

## 1. Branching Strategy
- `main`: Protected production branch. Requires 2 approving reviews (including CODEOWNERS for ledger/migrations/calculations), passing CI checks, signed commits, and linear history. Direct pushes are blocked.
- `develop`: Integration branch for staging validation.
- `feat/<scope>-<short-desc>`: Feature branches off `develop`.
- `hotfix/<incident-id>-<short-desc>`: Emergency branches cut directly from the latest `vX.Y.Z` tag on `main`.

## 2. Semantic Commits & Versioning
All commits follow Conventional Commits (`commitlint.config.js`), e.g.:
- `feat(ledger): enforce deferred double-entry balance trigger`
- `fix(transfers): guard concurrent debit race with deterministic lock ordering`
- `security(webhooks): reject replayed provider events using unique constraint`

Releases are tagged with Semantic Versioning (`v1.0.0`, `v1.0.1` for hotfixes).

## 3. Migration Review Protocol
1. Every SQL file in `db/migrations/` is immutable once merged to `main`.
2. Corrections require a new forward migration (`004_...sql`) and a documented rollback procedure.
3. CI runs `python3 db/scripts/verify_schema.py` on every PR.

## 4. Safe Hotfix Workflow (Demonstrated in Repo History)
1. Branch from `main` tag `v1.0.0`: `git checkout -b hotfix/inc-001-webhook-timestamp v1.0.0`
2. Write failing regression test reproducing the defect.
3. Implement minimal surgical fix and verify all tests pass.
4. Open PR to `main` with expedited security/finance review, merge, tag `v1.0.1`, and cherry-pick back to `develop`.
