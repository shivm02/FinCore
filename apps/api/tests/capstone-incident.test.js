'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFinCoreRuntime } = require('../src/app');

test('Capstone Challenge & Assessment 15: concurrent transfers, duplicate webhooks, failed/mismatched settlement, reversal & recovery', async () => {
  const rt = createFinCoreRuntime({ webhookSecret: 'whsec_capstone_secret' });
  const aliceW = rt.ledger.createWallet({ userId: 'alice', label: 'Alice', initialDeposit: '500.0000' });
  const bobW = rt.ledger.createWallet({ userId: 'bob', label: 'Bob', initialDeposit: '200.0000' });

  // 1. Concurrent transfers + duplicate retry key
  const [t1, t2, t3] = await Promise.all([
    rt.ledger.transfer({ actorUserId: 'alice', sourceWalletId: aliceW.id, destWalletId: bobW.id, amount: '100.0000', idempotencyKey: 'cap-idem-same' }),
    rt.ledger.transfer({ actorUserId: 'alice', sourceWalletId: aliceW.id, destWalletId: bobW.id, amount: '100.0000', idempotencyKey: 'cap-idem-same' }),
    rt.ledger.transfer({ actorUserId: 'alice', sourceWalletId: aliceW.id, destWalletId: bobW.id, amount: '50.0000', idempotencyKey: 'cap-idem-diff' }),
  ]);
  assert.equal(t1.transaction.id, t2.transaction.id);
  assert.notEqual(t1.transaction.id, t3.transaction.id);
  // Alice: 500 - 100 - 50 = 350; Bob: 200 + 100 + 50 = 350
  assert.equal(rt.ledger.serializeWallet(rt.ledger.wallets.get(aliceW.id)).balance, '350.0000');
  assert.equal(rt.ledger.serializeWallet(rt.ledger.wallets.get(bobW.id)).balance, '350.0000');

  // 2. Duplicate payment webhook replay
  const piOk = rt.payments.createPaymentIntent({ userId: 'alice', walletId: aliceW.id, amount: '120.0000', idempotencyKey: 'cap-pi-ok' });
  const rawOk = JSON.stringify({ id: 'evt_cap_001', type: 'payment_intent.succeeded', data: { providerIntentId: piOk.providerIntentId, settledAmount: '120.0000' } });
  const sigOk = rt.payments.signWebhookPayload(rawOk);
  const w1 = await rt.payments.handleProviderWebhook({ rawBody: rawOk, signatureHeader: sigOk });
  const w2 = await rt.payments.handleProviderWebhook({ rawBody: rawOk, signatureHeader: sigOk });
  assert.equal(w1.status, 'settled');
  assert.equal(w2.status, 'duplicate_ignored');
  assert.equal(rt.ledger.serializeWallet(rt.ledger.wallets.get(aliceW.id)).balance, '470.0000');

  // 3. Failed settlement
  const piFail = rt.payments.createPaymentIntent({ userId: 'alice', walletId: aliceW.id, amount: '80.0000', idempotencyKey: 'cap-pi-fail' });
  const rawFail = JSON.stringify({ id: 'evt_cap_fail', type: 'payment_intent.payment_failed', data: { providerIntentId: piFail.providerIntentId, failureReason: 'insufficient_provider_funds' } });
  const failRes = await rt.payments.handleProviderWebhook({ rawBody: rawFail, signatureHeader: rt.payments.signWebhookPayload(rawFail) });
  assert.equal(failRes.status, 'failed_recorded');
  assert.equal(rt.ledger.serializeWallet(rt.ledger.wallets.get(aliceW.id)).balance, '470.0000'); // untouched!

  // 4. Mismatched provider settlement (expected 200, provider reports 190 -> flagged, NOT silently posted)
  const piMis = rt.payments.createPaymentIntent({ userId: 'bob', walletId: bobW.id, amount: '200.0000', idempotencyKey: 'cap-pi-mismatch' });
  const rawMis = JSON.stringify({ id: 'evt_cap_mismatch', type: 'payment_intent.succeeded', data: { providerIntentId: piMis.providerIntentId, settledAmount: '190.0000' } });
  const misRes = await rt.payments.handleProviderWebhook({ rawBody: rawMis, signatureHeader: rt.payments.signWebhookPayload(rawMis) });
  assert.equal(misRes.status, 'settlement_mismatch_flagged');
  assert.equal(misRes.settlement.discrepancyAmount, '-10.0000');

  // Reconciliation report surfaces both failed and mismatched events
  const recon = rt.payments.reconcileProviderEvents([
    { providerEventId: 'evt_cap_001', amount: '120.0000' },
    { providerEventId: 'evt_cap_mismatch', amount: '190.0000' },
  ]);
  assert.equal(recon.matchedCount, 1);
  assert.equal(recon.mismatchCount, 1);

  // 5. Reversal restores original balances & ledger stays 100% balanced
  await rt.ledger.reverseTransaction({ actorUserId: 'finance_admin', transactionId: t3.transaction.id, reason: 'Capstone reversal test' });
  assert.equal(rt.ledger.serializeWallet(rt.ledger.wallets.get(aliceW.id)).balance, '520.0000');
  assert.equal(rt.ledger.serializeWallet(rt.ledger.wallets.get(bobW.id)).balance, '300.0000');

  const inv = rt.ledger.verifyLedgerInvariant();
  assert.equal(inv.balanced, true);
  assert.equal(inv.globalDebits, inv.globalCredits);
});
