'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LedgerEngine } = require('../src/modules/ledger/ledgerEngine');

test('Assessment 07 & 12: atomic transfer, idempotency replay, conflict, insufficient funds, and optimistic locking', async () => {
  const ledger = new LedgerEngine();
  const aliceW = ledger.createWallet({ userId: 'u-alice', label: 'Alice USD', initialDeposit: '500.0000' });
  const bobW = ledger.createWallet({ userId: 'u-bob', label: 'Bob USD', initialDeposit: '100.0000' });

  // 1. Transfer with fee
  const res1 = await ledger.transfer({
    actorUserId: 'u-alice',
    sourceWalletId: aliceW.id,
    destWalletId: bobW.id,
    amount: '100.0000',
    applyFee: true, // 25 bps of 100 = 0.25 -> min fee 0.50
    idempotencyKey: 'idem-transfer-001',
  });
  assert.equal(res1.idempotentReplay, false);
  assert.equal(res1.transaction.feeAmount, '0.5000');
  assert.equal(res1.sourceWallet.balance, '399.5000');
  assert.equal(res1.destWallet.balance, '200.0000');

  // 2. Exact duplicate idempotency key replays without double debit
  const replay = await ledger.transfer({
    actorUserId: 'u-alice',
    sourceWalletId: aliceW.id,
    destWalletId: bobW.id,
    amount: '100.0000',
    applyFee: true,
    idempotencyKey: 'idem-transfer-001',
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.transaction.id, res1.transaction.id);
  assert.equal(ledger.serializeWallet(ledger.wallets.get(aliceW.id)).balance, '399.5000');

  // 3. Reusing same idempotency key with DIFFERENT amount returns 409 conflict
  await assert.rejects(
    () => ledger.transfer({
      actorUserId: 'u-alice',
      sourceWalletId: aliceW.id,
      destWalletId: bobW.id,
      amount: '50.0000',
      applyFee: true,
      idempotencyKey: 'idem-transfer-001',
    }),
    (err) => err.code === 'IDEMPOTENCY_CONFLICT'
  );

  // 4. Insufficient funds rejected cleanly
  await assert.rejects(
    () => ledger.transfer({
      actorUserId: 'u-alice',
      sourceWalletId: aliceW.id,
      destWalletId: bobW.id,
      amount: '1000.0000',
      idempotencyKey: 'idem-transfer-overdraft',
    }),
    (err) => err.code === 'INSUFFICIENT_FUNDS'
  );

  // 5. Optimistic lock conflict rejected when stale version passed
  await assert.rejects(
    () => ledger.transfer({
      actorUserId: 'u-alice',
      sourceWalletId: aliceW.id,
      destWalletId: bobW.id,
      amount: '10.0000',
      expectedSourceVersion: 1,
      idempotencyKey: 'idem-stale-version',
    }),
    (err) => err.code === 'OPTIMISTIC_LOCK_CONFLICT'
  );

  // 6. Ledger entries are immutable & globally balanced
  assert.equal(Object.isFrozen(ledger.ledgerEntries[0]), true);
  const inv = ledger.verifyLedgerInvariant();
  assert.equal(inv.balanced, true);
  assert.equal(inv.globalDebits, inv.globalCredits);
});

test('Assessment 07 & 12: 10 concurrent transfers prevent double-spend and maintain balance invariant', async () => {
  const ledger = new LedgerEngine();
  const aliceW = ledger.createWallet({ userId: 'u-alice', label: 'Alice USD', initialDeposit: '100.0000' });
  const bobW = ledger.createWallet({ userId: 'u-bob', label: 'Bob USD', initialDeposit: '0.0000' });

  // Attempt 10 concurrent $30 transfers from a $100 wallet -> strictly 3 must succeed ($90), 7 must fail
  const attempts = Array.from({ length: 10 }, (_, i) =>
    ledger.transfer({
      actorUserId: 'u-alice',
      sourceWalletId: aliceW.id,
      destWalletId: bobW.id,
      amount: '30.0000',
      idempotencyKey: `idem-concurrent-tx-${i}`,
    })
  );

  const settled = await Promise.allSettled(attempts);
  const succeeded = settled.filter((r) => r.status === 'fulfilled');
  const rejected = settled.filter((r) => r.status === 'rejected');

  assert.equal(succeeded.length, 3);
  assert.equal(rejected.length, 7);
  assert.equal(ledger.serializeWallet(ledger.wallets.get(aliceW.id)).balance, '10.0000');
  assert.equal(ledger.serializeWallet(ledger.wallets.get(bobW.id)).balance, '90.0000');
  assert.equal(ledger.verifyLedgerInvariant().balanced, true);
});

test('Assessment 03 & 12: reversal posts offsetting entries without mutating originals & rejects unbalanced attempts', async () => {
  const ledger = new LedgerEngine();
  const aliceW = ledger.createWallet({ userId: 'u-alice', label: 'Alice USD', initialDeposit: '200.0000' });
  const bobW = ledger.createWallet({ userId: 'u-bob', label: 'Bob USD', initialDeposit: '50.0000' });

  const tx = await ledger.transfer({
    actorUserId: 'u-alice',
    sourceWalletId: aliceW.id,
    destWalletId: bobW.id,
    amount: '75.0000',
    idempotencyKey: 'idem-for-reversal-01',
  });
  const countBefore = ledger.ledgerEntries.length;

  const rev = await ledger.reverseTransaction({
    actorUserId: 'u-finance-admin',
    transactionId: tx.transaction.id,
    reason: 'Duplicate customer submission',
  });
  assert.equal(rev.originalTransaction.status, 'reversed');
  assert.equal(ledger.ledgerEntries.length, countBefore + 2); // appended, never deleted
  assert.equal(ledger.serializeWallet(ledger.wallets.get(aliceW.id)).balance, '200.0000');
  assert.equal(ledger.serializeWallet(ledger.wallets.get(bobW.id)).balance, '50.0000');

  // Unbalanced posting attempt is strictly rejected
  assert.throws(
    () => ledger._postBalancedEntries({
      type: 'transfer',
      currency: 'USD',
      amountUnits: 100000n,
      entries: [
        { accountId: aliceW.accountId, direction: 'debit', amountUnits: 100000n },
        { accountId: bobW.accountId, direction: 'credit', amountUnits: 90000n },
      ],
    }),
    (err) => err.code === 'UNBALANCED_LEDGER_ATTEMPT'
  );
  assert.equal(ledger.verifyLedgerInvariant().balanced, true);
});
