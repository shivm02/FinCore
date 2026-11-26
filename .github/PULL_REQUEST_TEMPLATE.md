## Summary
- Assessment / Ticket ID:
- Change type: `feat` | `fix` | `security` | `hotfix` | `docs` | `refactor`

## Financial Integrity & Migration Checklist
- [ ] No binary floating-point used for monetary amounts (`NUMERIC(19,4)` / `Decimal` / integer minor units).
- [ ] Double-entry invariant (`SUM(debits) == SUM(credits)`) verified by automated tests.
- [ ] Database migrations are backward-compatible and include rollback notes.
- [ ] Idempotency and concurrency edge cases tested.
- [ ] No secrets, real credentials, or real financial/PII data committed.

## Verification Evidence
- Automated tests run and passing:
- Screenshots / logs attached:
