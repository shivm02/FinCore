'use strict';

const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const { AppError, formatErrorResponse } = require('./core/errors');
const { AuthService, ROLES } = require('./modules/auth/authService');
const { LedgerEngine } = require('./modules/ledger/ledgerEngine');
const { PaymentIntegrationService } = require('./modules/payments/paymentIntegration');

function createFinCoreRuntime(options = {}) {
  const auth = new AuthService(options.auth);
  const ledger = new LedgerEngine({ authService: auth });
  const payments = new PaymentIntegrationService({
    ledgerEngine: ledger,
    authService: auth,
    webhookSecret: options.webhookSecret,
  });

  const metrics = {
    requestsTotal: 0,
    transfersTotal: 0,
    webhookInvalidSigTotal: 0,
  };

  function getBearerToken(req) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return null;
    return header.slice(7).trim();
  }

  async function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  function sendJson(res, statusCode, payload, requestId) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
      'X-Simulation-Mode': 'true',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(payload));
  }

  async function handler(req, res) {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    metrics.requestsTotal += 1;
    const parsedUrl = new URL(req.url, 'http://localhost');
    const path = parsedUrl.pathname;
    const method = req.method.toUpperCase();

    try {
      // Health, readiness, and Prometheus metrics
      if (method === 'GET' && path === '/health/live') {
        return sendJson(res, 200, { status: 'alive', service: 'fincore-api', simulationMode: true }, requestId);
      }
      if (method === 'GET' && path === '/health/ready') {
        const invariant = ledger.verifyLedgerInvariant();
        return sendJson(res, invariant.balanced ? 200 : 503, { status: invariant.balanced ? 'ready' : 'degraded', ledgerInvariant: invariant }, requestId);
      }
      if (method === 'GET' && path === '/metrics') {
        const inv = ledger.verifyLedgerInvariant();
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
        return res.end([
          `fincore_requests_total ${metrics.requestsTotal}`,
          `fincore_transfers_total ${metrics.transfersTotal}`,
          `fincore_webhook_invalid_signature_total ${metrics.webhookInvalidSigTotal}`,
          `fincore_ledger_imbalance_total ${inv.balanced ? 0 : 1}`,
        ].join('\n') + '\n');
      }

      const rawBody = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : '';
      const body = rawBody ? JSON.parse(rawBody) : {};

      // Auth routes
      if (method === 'POST' && path === '/api/v1/auth/register') {
        const user = auth.registerUser({ ...body, requestId });
        return sendJson(res, 201, { user }, requestId);
      }
      if (method === 'POST' && path === '/api/v1/auth/login') {
        const result = auth.login({ ...body, requestId });
        return sendJson(res, 200, result, requestId);
      }
      if (method === 'POST' && path === '/api/v1/auth/mfa/verify') {
        const session = auth.verifyMfaAndCreateSession({ ...body, requestId });
        return sendJson(res, 200, session, requestId);
      }
      if (method === 'POST' && path === '/api/v1/auth/refresh') {
        const refreshed = auth.refreshSession({ ...body, requestId });
        return sendJson(res, 200, refreshed, requestId);
      }
      if (method === 'POST' && path === '/api/v1/auth/logout') {
        const out = auth.revokeSession({ accessToken: getBearerToken(req), requestId });
        return sendJson(res, 200, out, requestId);
      }
      if (method === 'POST' && path === '/api/v1/auth/reauth') {
        const out = auth.reauthenticateSensitiveAction({ accessToken: getBearerToken(req), password: body.password, requestId });
        return sendJson(res, 200, out, requestId);
      }

      // Payment Provider Signed Webhook (no bearer token; verified by HMAC signature)
      if (method === 'POST' && path === '/api/v1/webhooks/provider') {
        try {
          const out = await payments.handleProviderWebhook({
            rawBody,
            signatureHeader: req.headers['x-fincore-signature'],
            requestId,
          });
          return sendJson(res, 200, out, requestId);
        } catch (err) {
          if (err instanceof AppError && err.code.includes('SIGNATURE')) {
            metrics.webhookInvalidSigTotal += 1;
          }
          throw err;
        }
      }

      // Protected API routes
      const authCtx = auth.authenticate(getBearerToken(req));

      // Wallets
      if (method === 'POST' && path === '/api/v1/wallets') {
        auth.authorize(authCtx, 'wallet:create:own', { requestId });
        const wallet = ledger.createWallet({ userId: authCtx.user.id, ...body });
        return sendJson(res, 201, { wallet }, requestId);
      }
      if (method === 'GET' && path === '/api/v1/wallets') {
        const isStaff = authCtx.user.role !== ROLES.CUSTOMER;
        const list = [...ledger.wallets.values()]
          .filter((w) => isStaff || w.userId === authCtx.user.id)
          .map((w) => ledger.serializeWallet(w));
        return sendJson(res, 200, { data: list, total: list.length }, requestId);
      }

      // Beneficiaries
      if (method === 'POST' && path === '/api/v1/beneficiaries') {
        auth.authorize(authCtx, 'beneficiary:manage:own', { requestId });
        const ben = ledger.addBeneficiary({ userId: authCtx.user.id, ...body });
        return sendJson(res, 201, { beneficiary: ben }, requestId);
      }

      // Transfers (Idempotent & Atomic)
      if (method === 'POST' && path === '/api/v1/transfers') {
        const sourceWallet = ledger.wallets.get(body.sourceWalletId);
        auth.authorize(authCtx, 'transfer:create:own', {
          ownerUserId: sourceWallet ? sourceWallet.userId : null,
          requestId,
        });
        const idempotencyKey = req.headers['idempotency-key'] || body.idempotencyKey;
        const result = await ledger.transfer({
          actorUserId: authCtx.user.id,
          sourceWalletId: body.sourceWalletId,
          destWalletId: body.destWalletId,
          amount: body.amount,
          applyFee: Boolean(body.applyFee),
          expectedSourceVersion: body.expectedSourceVersion ?? null,
          description: body.description,
          idempotencyKey,
          requestId,
        });
        metrics.transfersTotal += 1;
        return sendJson(res, result.idempotentReplay ? 200 : 201, result, requestId);
      }

      // Reversals (Finance Admin / Platform Admin + recent re-authentication required)
      if (method === 'POST' && path === '/api/v1/reversals') {
        auth.authorize(authCtx, 'reversal:execute', { requireRecentReauth: true, requestId });
        const result = await ledger.reverseTransaction({
          actorUserId: authCtx.user.id,
          transactionId: body.transactionId,
          reason: body.reason,
          requestId,
        });
        return sendJson(res, 201, result, requestId);
      }

      // Payment Intents
      if (method === 'POST' && path === '/api/v1/payment-intents') {
        auth.authorize(authCtx, 'payment_intent:create:own', { requestId });
        const intent = payments.createPaymentIntent({
          userId: authCtx.user.id,
          walletId: body.walletId,
          amount: body.amount,
          currency: body.currency || 'USD',
          idempotencyKey: req.headers['idempotency-key'] || body.idempotencyKey,
        });
        return sendJson(res, 201, { paymentIntent: intent }, requestId);
      }

      // Disputes
      if (method === 'POST' && path === '/api/v1/disputes') {
        auth.authorize(authCtx, 'dispute:create:own', { requestId });
        const dispute = ledger.raiseDispute({ userId: authCtx.user.id, ...body });
        return sendJson(res, 201, { dispute }, requestId);
      }

      // Statements
      if (method === 'GET' && path.startsWith('/api/v1/statements/')) {
        const walletId = path.split('/').pop();
        const wallet = ledger.wallets.get(walletId);
        if (!wallet) throw new AppError(404, 'WALLET_NOT_FOUND', 'Wallet not found');
        if (authCtx.user.role === ROLES.CUSTOMER) {
          auth.authorize(authCtx, 'statement:read:own', { ownerUserId: wallet.userId, requestId });
        } else {
          auth.authorize(authCtx, 'statement:read:any', { requestId });
        }
        return sendJson(res, 200, { statement: ledger.generateStatement({ walletId }) }, requestId);
      }

      // Ledger invariant & audit trail (Operations/Finance/Admin)
      if (method === 'GET' && path === '/api/v1/ledger/invariant') {
        auth.authorize(authCtx, 'ledger:verify', { requestId });
        return sendJson(res, 200, ledger.verifyLedgerInvariant(), requestId);
      }
      if (method === 'GET' && path === '/api/v1/audit-logs') {
        auth.authorize(authCtx, 'audit:read', { requestId });
        const limit = Math.min(Number(parsedUrl.searchParams.get('limit') || 50), 200);
        return sendJson(res, 200, { data: auth.auditLogs.slice(-limit), total: auth.auditLogs.length }, requestId);
      }

      throw new AppError(404, 'ROUTE_NOT_FOUND', `Route ${method} ${path} not found`);
    } catch (err) {
      if (err instanceof SyntaxError) {
        return sendJson(res, 400, { error: { code: 'INVALID_JSON', message: 'Malformed JSON body', requestId } }, requestId);
      }
      const formatted = formatErrorResponse(err, requestId);
      return sendJson(res, formatted.statusCode, formatted.body, requestId);
    }
  }

  return {
    auth,
    ledger,
    payments,
    metrics,
    createServer: () => http.createServer(handler),
    handler,
  };
}

module.exports = { createFinCoreRuntime };
