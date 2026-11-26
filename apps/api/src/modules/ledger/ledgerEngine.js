'use strict';

const crypto = require('crypto');
const { AppError } = require('../../core/errors');
const { parseMoney, formatMoney, assertPositiveMoney, calculateFeeBps } = require('../../core/money');

const VALID_TRANSITIONS = Object.freeze({
  pending: new Set(['authorized', 'posted', 'failed']),
  authorized: new Set(['posted', 'failed']),
  posted: new Set(['settled', 'reversed']),
  settled: new Set(['reversed']),
  failed: new Set([]),
  reversed: new Set([]),
});

class AsyncKeyedMutex {
  constructor() {
    this.queues = new Map();
  }

  async acquireMany(keys, fn) {
    // Deterministic lexicographical ordering prevents deadlocks across concurrent multi-account transfers
    const ordered = [...new Set(keys)].sort();
    const releases = [];
    try {
      for (const key of ordered) {
        const prev = this.queues.get(key) || Promise.resolve();
        let release;
        const next = new Promise((resolve) => { release = resolve; });
        this.queues.set(key, prev.then(() => next));
        await prev;
        releases.push(() => {
          release();
          if (this.queues.get(key) === next) this.queues.delete(key);
        });
      }
      return await fn();
    } finally {
      for (const rel of releases.reverse()) rel();
    }
  }
}

class LedgerEngine {
  constructor({ authService } = {}) {
    this.authService = authService;
    this.mutex = new AsyncKeyedMutex();
    this.accounts = new Map();
    this.wallets = new Map();
    this.beneficiaries = new Map();
    this.transactions = new Map();
    this.ledgerEntries = []; // Append-only immutable array
    this.holds = new Map();
    this.disputes = new Map();
    this.idempotencyStore = new Map();

    // Seed system clearing & fee revenue accounts
    this.systemClearingAccount = this._createAccount({
      code: 'SYS-CLEARING-USD',
      name: 'Simulated Clearing Settlement Account',
      type: 'asset',
      currency: 'USD',
      isSystem: true,
    });
    this.systemFeeAccount = this._createAccount({
      code: 'SYS-FEE-REV-USD',
      name: 'Platform Transfer Fee Revenue',
      type: 'revenue',
      currency: 'USD',
      isSystem: true,
    });
  }

  _createAccount({ code, ownerUserId = null, name, type, currency = 'USD', isSystem = false }) {
    const id = crypto.randomUUID();
    const acc = {
      id,
      accountCode: code || `ACC-${id.slice(0, 8).toUpperCase()}`,
      ownerUserId,
      name,
      type,
      currency,
      isSystem,
      isSimulated: true,
      version: 1,
      createdAt: new Date().toISOString(),
    };
    this.accounts.set(id, acc);
    return acc;
  }

  createWallet({ userId, label, currency = 'USD', initialDeposit = '0.0000' }) {
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new AppError(400, 'INVALID_CURRENCY', 'Currency must be a 3-letter ISO code');
    }
    const account = this._createAccount({
      ownerUserId: userId,
      name: `${label} Ledger Account`,
      type: 'liability',
      currency,
      isSystem: false,
    });
    const walletId = crypto.randomUUID();
    const wallet = {
      id: walletId,
      userId,
      accountId: account.id,
      accountCode: account.accountCode,
      label: String(label || 'Primary Simulated Wallet').trim(),
      currency,
      status: 'active',
      balanceUnits: 0n,
      heldUnits: 0n,
      isSimulated: true,
      version: 1,
      createdAt: new Date().toISOString(),
    };
    this.wallets.set(walletId, wallet);

    const depositUnits = parseMoney(initialDeposit);
    if (depositUnits > 0n) {
      this._postBalancedEntries({
        type: 'deposit',
        currency,
        amountUnits: depositUnits,
        feeUnits: 0n,
        initiatedBy: userId,
        destWalletId: walletId,
        description: 'Initial simulated wallet funding',
        entries: [
          { accountId: this.systemClearingAccount.id, direction: 'debit', amountUnits: depositUnits },
          { accountId: account.id, direction: 'credit', amountUnits: depositUnits },
        ],
      });
      wallet.balanceUnits += depositUnits;
      wallet.version += 1;
    }

    return this.serializeWallet(wallet);
  }

  serializeWallet(w) {
    return {
      id: w.id,
      userId: w.userId,
      accountId: w.accountId,
      accountCode: w.accountCode,
      label: w.label,
      currency: w.currency,
      status: w.status,
      balance: formatMoney(w.balanceUnits),
      heldBalance: formatMoney(w.heldUnits),
      availableBalance: formatMoney(w.balanceUnits - w.heldUnits),
      isSimulated: true,
      simulationLabel: 'SIMULATED FUNDS — NOT REAL MONEY',
      version: w.version,
    };
  }

  addBeneficiary({ userId, nickname, recipientName, targetWalletId }) {
    const targetWallet = this.wallets.get(targetWalletId);
    if (!targetWallet) {
      throw new AppError(404, 'TARGET_WALLET_NOT_FOUND', 'Beneficiary target wallet does not exist');
    }
    const id = crypto.randomUUID();
    const beneficiary = {
      id,
      userId,
      nickname: String(nickname || recipientName).trim(),
      recipientName: String(recipientName).trim(),
      targetWalletId,
      targetAccountCode: targetWallet.accountCode,
      currency: targetWallet.currency,
      verified: true,
      createdAt: new Date().toISOString(),
    };
    this.beneficiaries.set(id, beneficiary);
    return beneficiary;
  }

  _postBalancedEntries({
    type,
    currency,
    amountUnits,
    feeUnits = 0n,
    initiatedBy = null,
    sourceWalletId = null,
    destWalletId = null,
    relatedTxnId = null,
    idempotencyKey = null,
    description = '',
    status = 'posted',
    entries,
  }) {
    if (!Array.isArray(entries) || entries.length < 2) {
      throw new AppError(422, 'UNBALANCED_LEDGER_ATTEMPT', 'A double-entry transaction requires at least 2 postings');
    }
    let debitSum = 0n;
    let creditSum = 0n;
    for (const e of entries) {
      if (e.amountUnits <= 0n) {
        throw new AppError(422, 'INVALID_ENTRY_AMOUNT', 'Ledger entry amount must be strictly positive');
      }
      if (!this.accounts.has(e.accountId)) {
        throw new AppError(422, 'INVALID_ACCOUNT_REF', `Account ${e.accountId} does not exist`);
      }
      if (e.direction === 'debit') debitSum += e.amountUnits;
      else if (e.direction === 'credit') creditSum += e.amountUnits;
      else throw new AppError(422, 'INVALID_DIRECTION', 'Ledger direction must be debit or credit');
    }
    if (debitSum !== creditSum) {
      throw new AppError(
        422,
        'UNBALANCED_LEDGER_ATTEMPT',
        `Double-entry invariant violated: debits (${formatMoney(debitSum)}) != credits (${formatMoney(creditSum)})`
      );
    }

    const txnId = crypto.randomUUID();
    const txn = {
      id: txnId,
      reference: `TXN-${txnId.slice(0, 12).toUpperCase()}`,
      idempotencyKey,
      type,
      status,
      currency,
      amount: formatMoney(amountUnits),
      amountUnits,
      feeAmount: formatMoney(feeUnits),
      feeUnits,
      initiatedBy,
      sourceWalletId,
      destWalletId,
      relatedTxnId,
      description,
      createdAt: new Date().toISOString(),
      postedAt: new Date().toISOString(),
    };
    this.transactions.set(txnId, txn);

    for (const e of entries) {
      this.ledgerEntries.push(Object.freeze({
        id: crypto.randomUUID(),
        transactionId: txnId,
        accountId: e.accountId,
        direction: e.direction,
        amount: formatMoney(e.amountUnits),
        amountUnits: e.amountUnits,
        currency,
        createdAt: txn.createdAt,
      }));
    }
    return this.serializeTransaction(txn);
  }

  serializeTransaction(t) {
    return {
      id: t.id,
      reference: t.reference,
      idempotencyKey: t.idempotencyKey,
      type: t.type,
      status: t.status,
      currency: t.currency,
      amount: t.amount,
      feeAmount: t.feeAmount,
      sourceWalletId: t.sourceWalletId,
      destWalletId: t.destWalletId,
      relatedTxnId: t.relatedTxnId,
      description: t.description,
      createdAt: t.createdAt,
    };
  }

  transitionTransaction(txnId, nextStatus) {
    const txn = this.transactions.get(txnId);
    if (!txn) throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found');
    const allowed = VALID_TRANSITIONS[txn.status];
    if (!allowed || !allowed.has(nextStatus)) {
      throw new AppError(409, 'INVALID_STATE_TRANSITION', `Cannot transition transaction from "${txn.status}" to "${nextStatus}"`);
    }
    txn.status = nextStatus;
    return this.serializeTransaction(txn);
  }

  async transfer({
    actorUserId,
    sourceWalletId,
    destWalletId,
    amount,
    idempotencyKey,
    description = 'Simulated wallet transfer',
    applyFee = false,
    expectedSourceVersion = null,
    requestId,
  }) {
    if (!idempotencyKey || String(idempotencyKey).trim().length < 8) {
      throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header (min 8 chars) is required for transfers');
    }
    if (sourceWalletId === destWalletId) {
      throw new AppError(400, 'SELF_TRANSFER_NOT_ALLOWED', 'Source and destination wallets must be different');
    }
    const amountUnits = assertPositiveMoney(amount, 'amount');
    const feeUnits = applyFee ? calculateFeeBps(amountUnits) : 0n;
    const totalDebitUnits = amountUnits + feeUnits;

    const payloadHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ sourceWalletId, destWalletId, amount: formatMoney(amountUnits), applyFee }))
      .digest('hex');

    // Lock idempotency key + both wallets in deterministic order
    const lockKeys = [`idem:${idempotencyKey}`, `wallet:${sourceWalletId}`, `wallet:${destWalletId}`];
    return this.mutex.acquireMany(lockKeys, async () => {
      const existingIdem = this.idempotencyStore.get(idempotencyKey);
      if (existingIdem) {
        if (existingIdem.requestHash !== payloadHash) {
          throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key already used with different transfer parameters');
        }
        return { ...existingIdem.response, idempotentReplay: true };
      }

      const source = this.wallets.get(sourceWalletId);
      const dest = this.wallets.get(destWalletId);
      if (!source || !dest) {
        throw new AppError(404, 'WALLET_NOT_FOUND', 'Source or destination wallet not found');
      }
      if (source.status !== 'active' || dest.status !== 'active') {
        throw new AppError(409, 'WALLET_INACTIVE', 'Both source and destination wallets must be active');
      }
      if (source.currency !== dest.currency) {
        throw new AppError(400, 'CURRENCY_MISMATCH', 'Cross-currency transfers require an FX conversion step');
      }
      if (expectedSourceVersion !== null && source.version !== expectedSourceVersion) {
        throw new AppError(409, 'OPTIMISTIC_LOCK_CONFLICT', 'Source wallet was modified concurrently; retry with latest version');
      }

      const available = source.balanceUnits - source.heldUnits;
      if (available < totalDebitUnits) {
        throw new AppError(422, 'INSUFFICIENT_FUNDS', 'Insufficient available simulated balance for transfer and fee');
      }

      const entries = [
        { accountId: source.accountId, direction: 'debit', amountUnits: totalDebitUnits },
        { accountId: dest.accountId, direction: 'credit', amountUnits },
      ];
      if (feeUnits > 0n) {
        entries.push({ accountId: this.systemFeeAccount.id, direction: 'credit', amountUnits: feeUnits });
      }

      const txn = this._postBalancedEntries({
        type: 'transfer',
        currency: source.currency,
        amountUnits,
        feeUnits,
        initiatedBy: actorUserId,
        sourceWalletId,
        destWalletId,
        idempotencyKey,
        description,
        status: 'posted',
        entries,
      });

      source.balanceUnits -= totalDebitUnits;
      source.version += 1;
      dest.balanceUnits += amountUnits;
      dest.version += 1;

      const response = {
        transaction: txn,
        sourceWallet: this.serializeWallet(source),
        destWallet: this.serializeWallet(dest),
        idempotentReplay: false,
      };
      this.idempotencyStore.set(idempotencyKey, { requestHash: payloadHash, response });

      if (this.authService) {
        this.authService.recordAudit({
          actorUserId,
          action: 'transfer.posted',
          resourceType: 'transaction',
          resourceId: txn.id,
          requestId,
          outcome: 'success',
          metadata: { amount: txn.amount, fee: txn.feeAmount, idempotencyKey },
        });
      }
      return response;
    });
  }

  async reverseTransaction({ actorUserId, transactionId, reason = 'Operational reversal', requestId }) {
    const orig = this.transactions.get(transactionId);
    if (!orig) throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'Original transaction not found');
    if (orig.status === 'reversed') {
      throw new AppError(409, 'ALREADY_REVERSED', 'Transaction has already been reversed');
    }
    if (orig.type !== 'transfer' && orig.type !== 'deposit') {
      throw new AppError(400, 'NOT_REVERSIBLE', `Transaction type "${orig.type}" cannot be reversed`);
    }

    const keys = [orig.sourceWalletId, orig.destWalletId].filter(Boolean).map((id) => `wallet:${id}`);
    return this.mutex.acquireMany(keys, async () => {
      if (orig.status === 'reversed') {
        throw new AppError(409, 'ALREADY_REVERSED', 'Transaction has already been reversed');
      }
      const origEntries = this.ledgerEntries.filter((e) => e.transactionId === orig.id);
      // Create exact offsetting double-entry postings (never mutate/delete original entries)
      const offsettingEntries = origEntries.map((e) => ({
        accountId: e.accountId,
        direction: e.direction === 'debit' ? 'credit' : 'debit',
        amountUnits: e.amountUnits,
      }));

      const dest = orig.destWalletId ? this.wallets.get(orig.destWalletId) : null;
      const source = orig.sourceWalletId ? this.wallets.get(orig.sourceWalletId) : null;
      if (dest && dest.balanceUnits < orig.amountUnits) {
        throw new AppError(422, 'REVERSAL_INSUFFICIENT_DEST_BALANCE', 'Destination wallet lacks funds to reverse');
      }

      const reversalTxn = this._postBalancedEntries({
        type: 'reversal',
        currency: orig.currency,
        amountUnits: orig.amountUnits,
        feeUnits: 0n,
        initiatedBy: actorUserId,
        sourceWalletId: orig.destWalletId,
        destWalletId: orig.sourceWalletId,
        relatedTxnId: orig.id,
        description: `Reversal of ${orig.reference}: ${reason}`,
        status: 'posted',
        entries: offsettingEntries,
      });

      if (dest) {
        dest.balanceUnits -= orig.amountUnits;
        dest.version += 1;
      }
      if (source) {
        source.balanceUnits += orig.amountUnits + orig.feeUnits;
        source.version += 1;
      }
      orig.status = 'reversed';

      if (this.authService) {
        this.authService.recordAudit({
          actorUserId,
          action: 'transaction.reversed',
          resourceType: 'transaction',
          resourceId: orig.id,
          requestId,
          outcome: 'success',
          metadata: { reversalTxnId: reversalTxn.id, reason },
        });
      }
      return { originalTransaction: this.serializeTransaction(orig), reversalTransaction: reversalTxn };
    });
  }

  async creditWalletFromProvider({ walletId, amount, providerRef, idempotencyKey }) {
    const amountUnits = assertPositiveMoney(amount, 'amount');
    return this.mutex.acquireMany([`idem:${idempotencyKey}`, `wallet:${walletId}`], async () => {
      if (this.idempotencyStore.has(idempotencyKey)) {
        return { ...this.idempotencyStore.get(idempotencyKey).response, idempotentReplay: true };
      }
      const wallet = this.wallets.get(walletId);
      if (!wallet) throw new AppError(404, 'WALLET_NOT_FOUND', 'Wallet not found');

      const txn = this._postBalancedEntries({
        type: 'deposit',
        currency: wallet.currency,
        amountUnits,
        feeUnits: 0n,
        destWalletId: walletId,
        idempotencyKey,
        description: `Sandbox provider settlement (${providerRef})`,
        status: 'settled',
        entries: [
          { accountId: this.systemClearingAccount.id, direction: 'debit', amountUnits },
          { accountId: wallet.accountId, direction: 'credit', amountUnits },
        ],
      });
      wallet.balanceUnits += amountUnits;
      wallet.version += 1;
      const response = { transaction: txn, wallet: this.serializeWallet(wallet), idempotentReplay: false };
      this.idempotencyStore.set(idempotencyKey, { requestHash: providerRef, response });
      return response;
    });
  }

  raiseDispute({ userId, transactionId, reasonCode, description }) {
    const txn = this.transactions.get(transactionId);
    if (!txn) throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found');
    const id = crypto.randomUUID();
    const dispute = {
      id,
      transactionId,
      raisedBy: userId,
      reasonCode,
      description,
      disputedAmount: txn.amount,
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    this.disputes.set(id, dispute);
    return dispute;
  }

  generateStatement({ walletId }) {
    const wallet = this.wallets.get(walletId);
    if (!wallet) throw new AppError(404, 'WALLET_NOT_FOUND', 'Wallet not found');
    const entries = this.ledgerEntries.filter((e) => e.accountId === wallet.accountId);
    let totalDebits = 0n;
    let totalCredits = 0n;
    for (const e of entries) {
      if (e.direction === 'debit') totalDebits += e.amountUnits;
      else totalCredits += e.amountUnits;
    }
    return {
      walletId: wallet.id,
      accountCode: wallet.accountCode,
      currency: wallet.currency,
      isSimulated: true,
      closingBalance: formatMoney(wallet.balanceUnits),
      totalDebits: formatMoney(totalDebits),
      totalCredits: formatMoney(totalCredits),
      entryCount: entries.length,
      generatedAt: new Date().toISOString(),
    };
  }

  verifyLedgerInvariant() {
    let globalDebits = 0n;
    let globalCredits = 0n;
    const perTxn = new Map();

    for (const e of this.ledgerEntries) {
      const acc = perTxn.get(e.transactionId) || { debits: 0n, credits: 0n };
      if (e.direction === 'debit') {
        globalDebits += e.amountUnits;
        acc.debits += e.amountUnits;
      } else {
        globalCredits += e.amountUnits;
        acc.credits += e.amountUnits;
      }
      perTxn.set(e.transactionId, acc);
    }

    const unbalancedTxns = [];
    for (const [txnId, sums] of perTxn.entries()) {
      if (sums.debits !== sums.credits) unbalancedTxns.push(txnId);
    }

    return {
      balanced: globalDebits === globalCredits && unbalancedTxns.length === 0,
      globalDebits: formatMoney(globalDebits),
      globalCredits: formatMoney(globalCredits),
      transactionCount: perTxn.size,
      entryCount: this.ledgerEntries.length,
      unbalancedTransactions: unbalancedTxns,
    };
  }
}

module.exports = { LedgerEngine, VALID_TRANSITIONS };
