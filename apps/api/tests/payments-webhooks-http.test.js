'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFinCoreRuntime } = require('../src/app');

async function reqJson(baseUrl, path, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

test('Assessment 02 & 08: Full HTTP lifecycle, signed webhook verification, replay deduplication & safe errors', async () => {
  const runtime = createFinCoreRuntime({ webhookSecret: 'whsec_test_secret_123' });
  const server = runtime.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Health checks
    const live = await reqJson(baseUrl, '/health/live');
    assert.equal(live.status, 200);
    assert.equal(live.data.simulationMode, true);

    // Register & login with MFA
    await reqJson(baseUrl, '/api/v1/auth/register', {
      method: 'POST',
      body: { email: 'http.alice@fincore.sim', password: 'StrongPassword!2026', fullName: 'Alice HTTP' },
    });
    const login = await reqJson(baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'http.alice@fincore.sim', password: 'StrongPassword!2026' },
    });
    const mfa = await reqJson(baseUrl, '/api/v1/auth/mfa/verify', {
      method: 'POST',
      body: { challengeId: login.data.challengeId, code: login.data.simulatedOtp },
    });
    const authHeaders = { Authorization: `Bearer ${mfa.data.accessToken}` };

    // Create wallet & payment intent
    const wRes = await reqJson(baseUrl, '/api/v1/wallets', {
      method: 'POST',
      headers: authHeaders,
      body: { label: 'Main USD', currency: 'USD', initialDeposit: '100.0000' },
    });
    assert.equal(wRes.status, 201);
    const walletId = wRes.data.wallet.id;

    const piRes = await reqJson(baseUrl, '/api/v1/payment-intents', {
      method: 'POST',
      headers: { ...authHeaders, 'Idempotency-Key': 'idem-pi-0001' },
      body: { walletId, amount: '250.0000', currency: 'USD' },
    });
    assert.equal(piRes.status, 201);
    const providerIntentId = piRes.data.paymentIntent.providerIntentId;

    // 1. Unsigned / tampered webhook is rejected with 401
    const payload = JSON.stringify({
      id: 'evt_sandbox_001',
      type: 'payment_intent.succeeded',
      data: { providerIntentId, settledAmount: '250.0000' },
    });
    const badSig = await reqJson(baseUrl, '/api/v1/webhooks/provider', {
      method: 'POST',
      headers: { 'X-FinCore-Signature': 't=1700000000,v1=deadbeef' },
      body: payload,
    });
    assert.equal(badSig.status, 401);
    assert.equal(badSig.data.error.stack, undefined); // never expose stack traces

    // 2. Valid HMAC-signed webhook settles deposit & sends sandbox notification
    const sig = runtime.payments.signWebhookPayload(payload);
    const ok1 = await reqJson(baseUrl, '/api/v1/webhooks/provider', {
      method: 'POST',
      headers: { 'X-FinCore-Signature': sig },
      body: payload,
    });
    assert.equal(ok1.status, 200);
    assert.equal(ok1.data.status, 'settled');

    // 3. Replaying the exact same webhook event ID is deduplicated (balance NOT credited twice)
    const ok2 = await reqJson(baseUrl, '/api/v1/webhooks/provider', {
      method: 'POST',
      headers: { 'X-FinCore-Signature': sig },
      body: payload,
    });
    assert.equal(ok2.status, 200);
    assert.equal(ok2.data.status, 'duplicate_ignored');

    // Verify final balance is 100 + 250 = 350.0000 (not 600!)
    const stmt = await reqJson(baseUrl, `/api/v1/statements/${walletId}`, { headers: authHeaders });
    assert.equal(stmt.status, 200);
    assert.equal(stmt.data.statement.closingBalance, '350.0000');
    assert.equal(runtime.payments.notifications.sentMessages.length, 1);
    assert.equal(runtime.ledger.verifyLedgerInvariant().balanced, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
