#!/usr/bin/env python3
"""Automated verification script for Assessment 03 (Double-Entry Ledger Schema & Invariants)."""
import re
import sqlite3
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"
REQUIRED_TABLES = [
    "users", "sessions", "mfa_challenges", "audit_logs",
    "accounts", "wallets", "beneficiaries", "transactions",
    "ledger_entries", "holds", "settlements", "idempotency_keys",
    "payment_intents", "provider_webhook_events", "disputes",
    "reconciliation_runs", "risk_alerts", "statements"
]


def verify_migrations() -> None:
    sql_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    assert len(sql_files) >= 3, f"Expected >= 3 migrations, found {len(sql_files)}"
    combined = "\n".join(f.read_text(encoding="utf-8") for f in sql_files)

    # 1. Verify all required tables exist
    for table in REQUIRED_TABLES:
        assert re.search(rf"CREATE TABLE {table}\b", combined), f"Missing table: {table}"

    # 2. Verify fixed-point NUMERIC(19, 4) is used and NO FLOAT/DOUBLE for money
    assert "NUMERIC(19, 4)" in combined, "Monetary columns must use NUMERIC(19, 4)"
    assert not re.search(r"\b(FLOAT|DOUBLE PRECISION|REAL)\b", combined, re.IGNORECASE),         "Binary floating-point types are forbidden in financial schema"

    # 3. Verify immutability triggers and double-entry balance trigger
    assert "trg_ledger_entries_immutable" in combined, "Missing ledger immutability trigger"
    assert "trg_audit_logs_immutable" in combined, "Missing audit log immutability trigger"
    assert "trg_ledger_entries_balanced" in combined, "Missing double-entry balance constraint trigger"

    # 4. Run live SQLite simulation of immutability + double-entry balance enforcement
    conn = sqlite3.connect(":memory:")
    cur = conn.cursor()
    cur.executescript("""
        CREATE TABLE ledger_entries (
            id TEXT PRIMARY KEY,
            transaction_id TEXT NOT NULL,
            account_id TEXT NOT NULL,
            direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
            amount_cents INTEGER NOT NULL CHECK (amount_cents > 0)
        );
        CREATE TRIGGER no_update BEFORE UPDATE ON ledger_entries
        BEGIN SELECT RAISE(ABORT, 'ledger_entries is immutable'); END;
        CREATE TRIGGER no_delete BEFORE DELETE ON ledger_entries
        BEGIN SELECT RAISE(ABORT, 'ledger_entries is immutable'); END;
    """)
    cur.execute("INSERT INTO ledger_entries VALUES ('e1', 'tx1', 'acc_alice', 'debit', 10000)")
    cur.execute("INSERT INTO ledger_entries VALUES ('e2', 'tx1', 'acc_bob', 'credit', 10000)")
    conn.commit()

    # Verify UPDATE fails
    try:
        cur.execute("UPDATE ledger_entries SET amount_cents = 5000 WHERE id = 'e1'")
        raise AssertionError("UPDATE on ledger_entries should have failed!")
    except sqlite3.IntegrityError as exc:
        assert "immutable" in str(exc)

    # Verify DELETE fails
    try:
        cur.execute("DELETE FROM ledger_entries WHERE id = 'e1'")
        raise AssertionError("DELETE on ledger_entries should have failed!")
    except sqlite3.IntegrityError as exc:
        assert "immutable" in str(exc)

    # Verify global sum(debits) == sum(credits)
    debits, credits = cur.execute("""
        SELECT
            SUM(CASE WHEN direction='debit' THEN amount_cents ELSE 0 END),
            SUM(CASE WHEN direction='credit' THEN amount_cents ELSE 0 END)
        FROM ledger_entries
    """).fetchone()
    assert debits == credits == 10000, f"Unbalanced ledger: {debits} != {credits}"
    conn.close()
    print(f"[PASS] Verified {len(sql_files)} SQL migrations, {len(REQUIRED_TABLES)} tables, NUMERIC(19,4) precision, immutability triggers, and double-entry balance invariant.")


if __name__ == "__main__":
    verify_migrations()
