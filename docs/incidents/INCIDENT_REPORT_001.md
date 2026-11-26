# Financial Incident Simulation & Postmortem Report (Assessment 15)

**Incident Suite ID:** INC-FINCORE-2026-001  
**Environment:** FinCore Simulated Staging Stack (No Real Funds)  
**Verification Test:** `apps/api/tests/capstone-incident.test.js` & `services/analytics/tests/test_calculations_and_risk.py`

## 1. Simulated Incident Scenarios Covered
| Scenario | Trigger / Fault Injected | Detection Signal | Root Cause / Guard | Corrective Action & Proof of Recovery |
|---|---|---|---|---|
| **A. Duplicate Payment Webhook** | Provider re-sent `evt_cap_001` (`payment_intent.succeeded`) twice with valid HMAC signature | `duplicate_ignored` status logged; `provider_webhook_events.provider_event_id` unique key | Network retry from payment provider | Deduplication table returns cached outcome without second credit; wallet balance verified at exact single credit (`470.0000`). |
| **B. Mismatched Provider Settlement** | Expected `200.0000`, provider settled `190.0000` (`evt_cap_mismatch`) | `settlement_mismatch_flagged` + reconciliation report `mismatchCount: 1` | Upstream fee deduction or partial settlement | Blocked automatic ledger credit; flagged discrepancy `-10.0000` for Finance Admin reconciliation queue. |
| **C. Unbalanced Ledger Attempt** | Faulty posting with Debit `10.0000` vs Credit `9.0000` | `422 UNBALANCED_LEDGER_ATTEMPT` + PostgreSQL deferred trigger `trg_ledger_entries_balanced` + Prometheus `LedgerImbalanceDetected` | Application bug attempting single-sided or unequal posting | Rejected atomically before commit; `verifyLedgerInvariant()` confirms `balanced: true` (`globalDebits === globalCredits`). |
| **D. Elevated Latency & Concurrency Race** | 10 concurrent `$30` transfers on `$100` wallet | Deterministic account mutex ordering + `HighTransferLatencyP95` alert threshold (>500ms) | Parallel user clicks / retry storm | Exactly 3 transfers posted (`$90`), 7 safely rejected with `422 INSUFFICIENT_FUNDS`, zero deadlocks, zero overdraft. |
| **E. Suspicious Activity Alert** | Synthetic user submits `$5,500` to new beneficiary with 9 txns/1h & 4 failed attempts | FastAPI `/api/v1/risk/evaluate` returns `severity: critical`, score `100.0` | Automated velocity + anomaly rule match | Queued for Operations Analyst review with explicit decision-support disclaimer (not proof of fraud). |

## 2. Timeline & Proof of Recovery
1. **T+00:00** — Incident simulation initiated via `node --test apps/api/tests/capstone-incident.test.js`.
2. **T+00:01** — Concurrent transfer burst, duplicate webhook replay, failed settlement, and mismatched settlement injected.
3. **T+00:02** — Reversal executed by Finance Admin (`transaction.reversed` audit entry appended; original ledger rows untouched).
4. **T+00:03** — Global invariant check (`GET /api/v1/ledger/invariant`) verified `balanced: true` with `0.0000` discrepancy.
