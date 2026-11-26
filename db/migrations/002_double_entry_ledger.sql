-- Migration 002: Double-Entry Ledger, Wallets, Beneficiaries, Holds, Settlements, Idempotency
-- Author: FinCore Engineering | Assessment 03 & 07
-- Monetary precision: NUMERIC(19, 4) — exact fixed-point decimal (never FLOAT/DOUBLE).

BEGIN;

CREATE TYPE account_type AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');
CREATE TYPE wallet_status AS ENUM ('active', 'frozen', 'closed');
CREATE TYPE txn_type AS ENUM ('transfer', 'deposit', 'withdrawal', 'fee', 'interest', 'refund', 'reversal', 'settlement');
CREATE TYPE txn_status AS ENUM ('pending', 'authorized', 'posted', 'settled', 'failed', 'reversed');
CREATE TYPE entry_direction AS ENUM ('debit', 'credit');
CREATE TYPE hold_status AS ENUM ('active', 'captured', 'released', 'expired');
CREATE TYPE settlement_status AS ENUM ('pending', 'matched', 'mismatched', 'failed', 'settled');

CREATE TABLE accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_code    VARCHAR(40) NOT NULL UNIQUE,
    owner_user_id   UUID REFERENCES users(id),
    name            VARCHAR(140) NOT NULL,
    type            account_type NOT NULL,
    currency        CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
    is_system       BOOLEAN NOT NULL DEFAULT FALSE,
    is_simulated    BOOLEAN NOT NULL DEFAULT TRUE,
    version         INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_accounts_owner ON accounts(owner_user_id);

CREATE TABLE wallets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id),
    account_id          UUID NOT NULL UNIQUE REFERENCES accounts(id),
    label               VARCHAR(100) NOT NULL,
    currency            CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
    status              wallet_status NOT NULL DEFAULT 'active',
    cached_balance      NUMERIC(19, 4) NOT NULL DEFAULT 0.0000 CHECK (cached_balance >= 0),
    held_balance        NUMERIC(19, 4) NOT NULL DEFAULT 0.0000 CHECK (held_balance >= 0),
    is_simulated        BOOLEAN NOT NULL DEFAULT TRUE,
    version             INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_wallet_available_non_negative CHECK (cached_balance >= held_balance)
);

CREATE INDEX idx_wallets_user_currency ON wallets(user_id, currency);

CREATE TABLE beneficiaries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id),
    nickname            VARCHAR(100) NOT NULL,
    recipient_name      VARCHAR(160) NOT NULL,
    target_account_code VARCHAR(40) NOT NULL,
    target_wallet_id    UUID REFERENCES wallets(id),
    currency            CHAR(3) NOT NULL DEFAULT 'USD',
    verified            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, target_account_code)
);

CREATE TABLE transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference           VARCHAR(64) NOT NULL UNIQUE,
    idempotency_key     VARCHAR(128) UNIQUE,
    type                txn_type NOT NULL,
    status              txn_status NOT NULL DEFAULT 'pending',
    currency            CHAR(3) NOT NULL DEFAULT 'USD',
    amount              NUMERIC(19, 4) NOT NULL CHECK (amount > 0),
    fee_amount          NUMERIC(19, 4) NOT NULL DEFAULT 0.0000 CHECK (fee_amount >= 0),
    initiated_by        UUID REFERENCES users(id),
    source_wallet_id    UUID REFERENCES wallets(id),
    dest_wallet_id      UUID REFERENCES wallets(id),
    related_txn_id      UUID REFERENCES transactions(id),
    description         TEXT,
    failure_reason      TEXT,
    posted_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_source_time ON transactions(source_wallet_id, created_at DESC);
CREATE INDEX idx_transactions_dest_time ON transactions(dest_wallet_id, created_at DESC);
CREATE INDEX idx_transactions_status ON transactions(status, created_at DESC);

CREATE TABLE ledger_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  UUID NOT NULL REFERENCES transactions(id),
    account_id      UUID NOT NULL REFERENCES accounts(id),
    direction       entry_direction NOT NULL,
    amount          NUMERIC(19, 4) NOT NULL CHECK (amount > 0),
    currency        CHAR(3) NOT NULL DEFAULT 'USD',
    balance_after   NUMERIC(19, 4),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ledger_entries_txn ON ledger_entries(transaction_id);
CREATE INDEX idx_ledger_entries_account_time ON ledger_entries(account_id, created_at DESC);

-- Ledger entries are strictly immutable (append-only; corrections must be new reversal/adjustment entries)
CREATE TRIGGER trg_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

-- Deferred constraint trigger: every posted transaction's debits MUST equal credits
CREATE OR REPLACE FUNCTION verify_transaction_balanced() RETURNS TRIGGER AS $$
DECLARE
    debit_sum  NUMERIC(19, 4);
    credit_sum NUMERIC(19, 4);
    entry_cnt  INTEGER;
BEGIN
    SELECT
        COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0),
        COUNT(*)
    INTO debit_sum, credit_sum, entry_cnt
    FROM ledger_entries
    WHERE transaction_id = NEW.transaction_id;

    IF entry_cnt < 2 OR debit_sum <> credit_sum THEN
        RAISE EXCEPTION 'Double-entry invariant violated for transaction %: debits=%, credits=%, entries=%',
            NEW.transaction_id, debit_sum, credit_sum, entry_cnt;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_ledger_entries_balanced
AFTER INSERT ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION verify_transaction_balanced();

CREATE TABLE holds (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id       UUID NOT NULL REFERENCES wallets(id),
    transaction_id  UUID REFERENCES transactions(id),
    amount          NUMERIC(19, 4) NOT NULL CHECK (amount > 0),
    currency        CHAR(3) NOT NULL DEFAULT 'USD',
    status          hold_status NOT NULL DEFAULT 'active',
    reason          VARCHAR(160) NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_holds_wallet_status ON holds(wallet_id, status);

CREATE TABLE settlements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id      UUID NOT NULL REFERENCES transactions(id),
    provider            VARCHAR(60) NOT NULL,
    provider_event_id   VARCHAR(128) NOT NULL UNIQUE,
    expected_amount     NUMERIC(19, 4) NOT NULL CHECK (expected_amount > 0),
    settled_amount      NUMERIC(19, 4) NOT NULL CHECK (settled_amount >= 0),
    currency            CHAR(3) NOT NULL DEFAULT 'USD',
    status              settlement_status NOT NULL DEFAULT 'pending',
    discrepancy_amount  NUMERIC(19, 4) GENERATED ALWAYS AS (settled_amount - expected_amount) STORED,
    settled_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE idempotency_keys (
    key             VARCHAR(128) PRIMARY KEY,
    user_id         UUID REFERENCES users(id),
    endpoint        VARCHAR(160) NOT NULL,
    request_hash    VARCHAR(64) NOT NULL,
    response_status INTEGER,
    response_body   JSONB,
    locked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at);

COMMIT;
