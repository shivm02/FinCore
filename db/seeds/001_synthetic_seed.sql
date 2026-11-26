-- Synthetic Seed Data (NO REAL FUNDS OR REAL CREDENTIALS)
-- Password hashes are scrypt placeholders generated for local sandbox testing only.

BEGIN;

INSERT INTO users (id, email, password_hash, full_name, role) VALUES
  ('11111111-1111-4111-8111-111111111101', 'alice.customer@fincore.sim', 'scrypt$sandbox$alice_hash', 'Alice Mercer (Synthetic)', 'customer'),
  ('11111111-1111-4111-8111-111111111102', 'bob.customer@fincore.sim', 'scrypt$sandbox$bob_hash', 'Bob Nair (Synthetic)', 'customer'),
  ('11111111-1111-4111-8111-111111111103', 'sam.support@fincore.sim', 'scrypt$sandbox$support_hash', 'Samira Support', 'support_agent'),
  ('11111111-1111-4111-8111-111111111104', 'olivia.ops@fincore.sim', 'scrypt$sandbox$ops_hash', 'Olivia Ops Analyst', 'operations_analyst'),
  ('11111111-1111-4111-8111-111111111105', 'fiona.finance@fincore.sim', 'scrypt$sandbox$finance_hash', 'Fiona Finance Admin', 'finance_administrator'),
  ('11111111-1111-4111-8111-111111111106', 'pat.admin@fincore.sim', 'scrypt$sandbox$admin_hash', 'Pat Platform Admin', 'platform_administrator')
ON CONFLICT (email) DO NOTHING;

-- System clearing, fee revenue, and customer liability accounts
INSERT INTO accounts (id, account_code, owner_user_id, name, type, currency, is_system) VALUES
  ('22222222-2222-4222-8222-222222222200', 'SYS-CLEARING-USD', NULL, 'Simulated Clearing Settlement Account', 'asset', 'USD', TRUE),
  ('22222222-2222-4222-8222-222222222201', 'SYS-FEE-REV-USD', NULL, 'Platform Transfer Fee Revenue', 'revenue', 'USD', TRUE),
  ('22222222-2222-4222-8222-222222222211', 'WAL-ALICE-USD', '11111111-1111-4111-8111-111111111101', 'Alice Primary Simulated Wallet', 'liability', 'USD', FALSE),
  ('22222222-2222-4222-8222-222222222212', 'WAL-BOB-USD', '11111111-1111-4111-8111-111111111102', 'Bob Primary Simulated Wallet', 'liability', 'USD', FALSE)
ON CONFLICT (account_code) DO NOTHING;

INSERT INTO wallets (id, user_id, account_id, label, currency, cached_balance) VALUES
  ('33333333-3333-4333-8333-333333333311', '11111111-1111-4111-8111-111111111101', '22222222-2222-4222-8222-222222222211', 'Primary USD Wallet (Simulated)', 'USD', 2500.0000),
  ('33333333-3333-4333-8333-333333333312', '11111111-1111-4111-8111-111111111102', '22222222-2222-4222-8222-222222222212', 'Primary USD Wallet (Simulated)', 'USD', 1000.0000)
ON CONFLICT (account_id) DO NOTHING;

COMMIT;
