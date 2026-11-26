-- Migration 001: Core Identity, RBAC, Sessions, MFA Simulation, and Immutable Audit Trail
-- Author: FinCore Engineering | Assessment 03 & 04

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE user_role AS ENUM (
    'customer',
    'support_agent',
    'operations_analyst',
    'finance_administrator',
    'platform_administrator'
);

CREATE TYPE user_status AS ENUM ('active', 'suspended', 'locked', 'closed');

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    full_name       VARCHAR(160) NOT NULL,
    phone_number    VARCHAR(32),
    role            user_role NOT NULL DEFAULT 'customer',
    status          user_status NOT NULL DEFAULT 'active',
    mfa_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    mfa_secret_hash TEXT,
    failed_logins   INTEGER NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
    locked_until    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash  TEXT NOT NULL UNIQUE,
    ip_address          INET,
    user_agent          TEXT,
    mfa_verified_at     TIMESTAMPTZ,
    reauth_verified_at  TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ NOT NULL,
    revoked_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_active ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE mfa_challenges (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     VARCHAR(40) NOT NULL CHECK (purpose IN ('login', 'transfer_confirm', 'sensitive_action')),
    code_hash   TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    attempts    INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mfa_user_purpose ON mfa_challenges(user_id, purpose, created_at DESC);

CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id   UUID REFERENCES users(id),
    actor_role      user_role,
    action          VARCHAR(100) NOT NULL,
    resource_type   VARCHAR(60) NOT NULL,
    resource_id     VARCHAR(100),
    request_id      VARCHAR(64) NOT NULL,
    ip_address      INET,
    outcome         VARCHAR(20) NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_actor_time ON audit_logs(actor_user_id, created_at DESC);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id, created_at DESC);
CREATE INDEX idx_audit_logs_request_id ON audit_logs(request_id);

-- Enforce immutability on audit_logs
CREATE OR REPLACE FUNCTION prevent_row_mutation() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Table % is append-only; % operations are prohibited', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_immutable
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation();

COMMIT;
