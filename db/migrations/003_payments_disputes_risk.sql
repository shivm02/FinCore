-- Migration 003: Payment Intents, Webhook Deduplication, Disputes, Reconciliation, Risk Alerts, Statements
-- Author: FinCore Engineering | Assessments 02, 03, 06, 08

BEGIN;

CREATE TYPE payment_intent_status AS ENUM ('requires_confirmation', 'processing', 'succeeded', 'failed', 'canceled', 'refunded');
CREATE TYPE dispute_status AS ENUM ('open', 'under_review', 'resolved_refunded', 'resolved_rejected', 'escalated');
CREATE TYPE risk_severity AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE risk_alert_status AS ENUM ('open', 'investigating', 'dismissed', 'confirmed_action');

CREATE TABLE payment_intents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id),
    wallet_id           UUID NOT NULL REFERENCES wallets(id),
    provider            VARCHAR(60) NOT NULL DEFAULT 'stripe_sandbox',
    provider_intent_id  VARCHAR(128) UNIQUE,
    idempotency_key     VARCHAR(128) UNIQUE,
    amount              NUMERIC(19, 4) NOT NULL CHECK (amount > 0),
    currency            CHAR(3) NOT NULL DEFAULT 'USD',
    status              payment_intent_status NOT NULL DEFAULT 'requires_confirmation',
    transaction_id      UUID REFERENCES transactions(id),
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE provider_webhook_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider            VARCHAR(60) NOT NULL,
    provider_event_id   VARCHAR(128) NOT NULL UNIQUE,
    event_type          VARCHAR(100) NOT NULL,
    signature_valid     BOOLEAN NOT NULL,
    payload             JSONB NOT NULL,
    processed           BOOLEAN NOT NULL DEFAULT FALSE,
    processed_at        TIMESTAMPTZ,
    error_message       TEXT,
    received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_unprocessed ON provider_webhook_events(processed, received_at);

CREATE TABLE disputes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id      UUID NOT NULL REFERENCES transactions(id),
    raised_by           UUID NOT NULL REFERENCES users(id),
    assigned_to         UUID REFERENCES users(id),
    reason_code         VARCHAR(60) NOT NULL,
    description         TEXT NOT NULL,
    disputed_amount     NUMERIC(19, 4) NOT NULL CHECK (disputed_amount > 0),
    status              dispute_status NOT NULL DEFAULT 'open',
    resolution_notes    TEXT,
    refund_txn_id       UUID REFERENCES transactions(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_disputes_status ON disputes(status, created_at DESC);

CREATE TABLE reconciliation_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider            VARCHAR(60) NOT NULL,
    period_start        TIMESTAMPTZ NOT NULL,
    period_end          TIMESTAMPTZ NOT NULL,
    total_records       INTEGER NOT NULL DEFAULT 0,
    matched_count       INTEGER NOT NULL DEFAULT 0,
    mismatch_count      INTEGER NOT NULL DEFAULT 0,
    total_discrepancy   NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    status              VARCHAR(30) NOT NULL DEFAULT 'completed',
    run_by              UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE risk_alerts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES users(id),
    transaction_id      UUID REFERENCES transactions(id),
    risk_score          NUMERIC(5, 2) NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
    severity            risk_severity NOT NULL,
    flags               JSONB NOT NULL DEFAULT '[]'::jsonb,
    decision_support    TEXT NOT NULL DEFAULT 'Decision support only — requires human review; not proof of fraud.',
    status              risk_alert_status NOT NULL DEFAULT 'open',
    reviewed_by         UUID REFERENCES users(id),
    reviewed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_risk_alerts_status_sev ON risk_alerts(status, severity, created_at DESC);

CREATE TABLE statements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id           UUID NOT NULL REFERENCES wallets(id),
    period_start        DATE NOT NULL,
    period_end          DATE NOT NULL,
    opening_balance     NUMERIC(19, 4) NOT NULL,
    closing_balance     NUMERIC(19, 4) NOT NULL,
    total_debits        NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    total_credits       NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    total_fees          NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    interest_earned     NUMERIC(19, 4) NOT NULL DEFAULT 0.0000,
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (wallet_id, period_start, period_end)
);

COMMIT;
