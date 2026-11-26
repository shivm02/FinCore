'use strict';

const crypto = require('crypto');
const { AppError } = require('../../core/errors');
const { parseMoney, formatMoney, assertPositiveMoney } = require('../../core/money');

class SandboxNotificationService {
  constructor() {
    this.sentMessages = [];
  }

  send({ channel, recipient, subject, body, correlationId }) {
    const record = {
      id: crypto.randomUUID(),
      channel, // 'email' | 'sms'
      mode: 'sandbox',
      recipient,
      subject,
      body,
      correlationId,
      sentAt: new Date().toISOString(),
    };
    this.sentMessages.push(record);
    return record;
  }
}

class PaymentIntegrationService {
  constructor({ ledgerEngine, authService, webhookSecret, notifications } = {}) {
    this.ledgerEngine = ledgerEngine;
    this.authService = authService;
    this.webhookSecret = webhookSecret || process.env.PAYMENT_WEBHOOK_SECRET || 'whsec_test_placeholder_signature_secret';
    this.notifications = notifications || new SandboxNotificationService();
    this.paymentIntents = new Map();
    this.processedWebhookEvents = new Map();
    this.settlements = new Map();
    this.failedJobs = [];
  }

  signWebhookPayload(rawBody, timestampSec = Math.floor(Date.now() / 1000)) {
    const signedPayload = `${timestampSec}.${rawBody}`;
    const sig = crypto.createHmac('sha256', this.webhookSecret).update(signedPayload).digest('hex');
    return `t=${timestampSec},v1=${sig}`;
  }

  verifyWebhookSignature(rawBody, signatureHeader, maxSkewSeconds = 300) {
    if (!signatureHeader || typeof signatureHeader !== 'string') {
      throw new AppError(401, 'MISSING_WEBHOOK_SIGNATURE', 'Webhook signature header is required');
    }
    const parts = Object.fromEntries(signatureHeader.split(',').map((kv) => kv.split('=')));
    const timestamp = Number(parts.t);
    const providedSig = parts.v1;
    if (!timestamp || !providedSig) {
      throw new AppError(401, 'MALFORMED_WEBHOOK_SIGNATURE', 'Invalid webhook signature header format');
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - timestamp) > maxSkewSeconds) {
      throw new AppError(401, 'WEBHOOK_TIMESTAMP_EXPIRED', 'Webhook timestamp outside allowed replay window');
    }
    const expected = crypto.createHmac('sha256', this.webhookSecret).update(`${timestamp}.${rawBody}`).digest('hex');
    const a = Buffer.from(providedSig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new AppError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Webhook HMAC signature verification failed');
    }
    return true;
  }

  createPaymentIntent({ userId, walletId, amount, currency = 'USD', idempotencyKey }) {
    const amountUnits = assertPositiveMoney(amount, 'amount');
    if (!this.ledgerEngine.wallets.has(walletId)) {
      throw new AppError(404, 'WALLET_NOT_FOUND', 'Target wallet not found');
    }
    for (const existing of this.paymentIntents.values()) {
      if (idempotencyKey && existing.idempotencyKey === idempotencyKey) {
        return { ...existing, idempotentReplay: true };
      }
    }
    const id = crypto.randomUUID();
    const intent = {
      id,
      userId,
      walletId,
      provider: 'stripe_sandbox',
      providerIntentId: `pi_sim_${id.slice(0, 12)}`,
      idempotencyKey: idempotencyKey || crypto.randomUUID(),
      amount: formatMoney(amountUnits),
      amountUnits,
      currency,
      status: 'requires_confirmation',
      createdAt: new Date().toISOString(),
    };
    this.paymentIntents.set(id, intent);
    return intent;
  }

  async handleProviderWebhook({ rawBody, signatureHeader, requestId }) {
    this.verifyWebhookSignature(rawBody, signatureHeader);
    const event = JSON.parse(rawBody);
    const { id: providerEventId, type, data } = event;

    if (!providerEventId || !type || !data) {
      throw new AppError(400, 'INVALID_WEBHOOK_PAYLOAD', 'Webhook payload missing id, type, or data');
    }

    // Strict event deduplication — retries/replays must NEVER credit an account twice
    if (this.processedWebhookEvents.has(providerEventId)) {
      return {
        status: 'duplicate_ignored',
        providerEventId,
        previousResult: this.processedWebhookEvents.get(providerEventId),
      };
    }

    const intent = [...this.paymentIntents.values()].find((p) => p.providerIntentId === data.providerIntentId);
    if (!intent) {
      throw new AppError(404, 'PAYMENT_INTENT_NOT_FOUND', `Unknown providerIntentId: ${data.providerIntentId}`);
    }

    let result;
    if (type === 'payment_intent.succeeded') {
      const settledUnits = parseMoney(data.settledAmount || intent.amount);
      const mismatch = settledUnits !== intent.amountUnits;
      if (mismatch) {
        // Record mismatched settlement and hold for finance/ops review — do NOT silently post wrong amount
        const settlement = {
          id: crypto.randomUUID(),
          providerEventId,
          providerIntentId: intent.providerIntentId,
          expectedAmount: intent.amount,
          settledAmount: formatMoney(settledUnits),
          discrepancyAmount: formatMoney(settledUnits - intent.amountUnits),
          status: 'mismatched',
          recordedAt: new Date().toISOString(),
        };
        this.settlements.set(providerEventId, settlement);
        intent.status = 'failed';
        result = { status: 'settlement_mismatch_flagged', settlement };
      } else {
        const creditRes = await this.ledgerEngine.creditWalletFromProvider({
          walletId: intent.walletId,
          amount: intent.amount,
          providerRef: providerEventId,
          idempotencyKey: `webhook:${providerEventId}`,
        });
        intent.status = 'succeeded';
        intent.transactionId = creditRes.transaction.id;
        const settlement = {
          id: crypto.randomUUID(),
          providerEventId,
          providerIntentId: intent.providerIntentId,
          transactionId: creditRes.transaction.id,
          expectedAmount: intent.amount,
          settledAmount: intent.amount,
          discrepancyAmount: '0.0000',
          status: 'settled',
          recordedAt: new Date().toISOString(),
        };
        this.settlements.set(providerEventId, settlement);
        this.notifications.send({
          channel: 'email',
          recipient: intent.userId,
          subject: 'Simulated Wallet Top-Up Confirmed',
          body: `Your simulated deposit of ${intent.currency} ${intent.amount} has settled.`,
          correlationId: requestId || providerEventId,
        });
        result = { status: 'settled', transaction: creditRes.transaction, settlement };
      }
    } else if (type === 'payment_intent.payment_failed') {
      intent.status = 'failed';
      const settlement = {
        id: crypto.randomUUID(),
        providerEventId,
        providerIntentId: intent.providerIntentId,
        expectedAmount: intent.amount,
        settledAmount: '0.0000',
        discrepancyAmount: formatMoney(-intent.amountUnits),
        status: 'failed',
        failureReason: data.failureReason || 'provider_settlement_failed',
        recordedAt: new Date().toISOString(),
      };
      this.settlements.set(providerEventId, settlement);
      this.failedJobs.push({ providerEventId, type, reason: settlement.failureReason, recordedAt: settlement.recordedAt });
      this.notifications.send({
        channel: 'sms',
        recipient: intent.userId,
        subject: 'Simulated Payment Failed',
        body: `Deposit ${intent.providerIntentId} failed: ${settlement.failureReason}`,
        correlationId: requestId || providerEventId,
      });
      result = { status: 'failed_recorded', settlement };
    } else {
      result = { status: 'ignored_event_type', type };
    }

    this.processedWebhookEvents.set(providerEventId, result);
    return result;
  }

  reconcileProviderEvents(providerRecords) {
    let matchedCount = 0;
    let mismatchCount = 0;
    let totalDiscrepancyUnits = 0n;
    const discrepancies = [];

    for (const rec of providerRecords) {
      const local = this.settlements.get(rec.providerEventId);
      const provUnits = parseMoney(rec.amount);
      if (!local) {
        mismatchCount += 1;
        totalDiscrepancyUnits += provUnits;
        discrepancies.push({ providerEventId: rec.providerEventId, issue: 'missing_local_settlement', providerAmount: formatMoney(provUnits) });
      } else if (parseMoney(local.settledAmount) !== provUnits || local.status !== 'settled') {
        mismatchCount += 1;
        const diff = provUnits - parseMoney(local.settledAmount);
        totalDiscrepancyUnits += diff;
        discrepancies.push({
          providerEventId: rec.providerEventId,
          issue: local.status === 'mismatched' ? 'amount_mismatch' : `status_${local.status}`,
          localAmount: local.settledAmount,
          providerAmount: formatMoney(provUnits),
          discrepancy: formatMoney(diff),
        });
      } else {
        matchedCount += 1;
      }
    }

    return {
      totalRecords: providerRecords.length,
      matchedCount,
      mismatchCount,
      totalDiscrepancy: formatMoney(totalDiscrepancyUnits),
      discrepancies,
    };
  }
}

module.exports = { PaymentIntegrationService, SandboxNotificationService };
