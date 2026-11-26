'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AuthService, ROLES } = require('../src/modules/auth/authService');

test('Assessment 04: scrypt password hashing, MFA simulation, JWT refresh & revocation', () => {
  const auth = new AuthService();
  const user = auth.registerUser({
    email: 'alice@fincore.sim',
    password: 'StrongPassword!2026',
    fullName: 'Alice Mercer',
    role: ROLES.CUSTOMER,
  });

  // Never store plaintext password
  const stored = auth.users.get(user.id);
  assert.ok(stored.passwordHash.startsWith('scrypt$'));
  assert.ok(!stored.passwordHash.includes('StrongPassword!2026'));

  // Login issues MFA challenge
  const loginRes = auth.login({ email: 'alice@fincore.sim', password: 'StrongPassword!2026' });
  assert.equal(loginRes.mfaRequired, true);

  // Wrong MFA code rejected
  assert.throws(
    () => auth.verifyMfaAndCreateSession({ challengeId: loginRes.challengeId, code: '000000' }),
    (err) => err.code === 'MFA_INVALID'
  );

  // Correct MFA code creates session
  const session = auth.verifyMfaAndCreateSession({
    challengeId: loginRes.challengeId,
    code: loginRes.simulatedOtp,
  });
  assert.ok(session.accessToken);
  assert.ok(session.refreshToken);

  // Refresh works
  const refreshed = auth.refreshSession({ refreshToken: session.refreshToken });
  assert.ok(refreshed.accessToken);

  // Revoke invalidates session & token
  auth.revokeSession({ accessToken: session.accessToken });
  assert.throws(
    () => auth.authenticate(session.accessToken),
    (err) => err.code === 'TOKEN_REVOKED' || err.code === 'SESSION_REVOKED'
  );
});

test('Assessment 04: 5-role RBAC enforcement, resource ownership, and sensitive-action reauth', () => {
  const auth = new AuthService();
  const makeSession = (email, role) => {
    auth.registerUser({ email, password: 'StrongPassword!2026', fullName: role, role });
    const l = auth.login({ email, password: 'StrongPassword!2026' });
    const s = auth.verifyMfaAndCreateSession({ challengeId: l.challengeId, code: l.simulatedOtp });
    return { token: s.accessToken, ctx: auth.authenticate(s.accessToken), user: s.user };
  };

  const custA = makeSession('c1@fincore.sim', ROLES.CUSTOMER);
  const custB = makeSession('c2@fincore.sim', ROLES.CUSTOMER);
  const support = makeSession('sup@fincore.sim', ROLES.SUPPORT_AGENT);
  const ops = makeSession('ops@fincore.sim', ROLES.OPERATIONS_ANALYST);
  const finance = makeSession('fin@fincore.sim', ROLES.FINANCE_ADMIN);
  const admin = makeSession('adm@fincore.sim', ROLES.PLATFORM_ADMIN);

  // Customer cannot access another customer's wallet or execute reversals
  assert.throws(
    () => auth.authorize(custA.ctx, 'transfer:create:own', { ownerUserId: custB.user.id }),
    (err) => err.code === 'RESOURCE_FORBIDDEN'
  );
  assert.throws(
    () => auth.authorize(custA.ctx, 'reversal:execute'),
    (err) => err.code === 'FORBIDDEN'
  );

  // Support agent can read audit logs but cannot execute reversals
  assert.equal(auth.authorize(support.ctx, 'audit:read'), true);
  assert.throws(() => auth.authorize(support.ctx, 'reversal:execute'), (err) => err.code === 'FORBIDDEN');

  // Operations analyst can review risk & run reconciliation
  assert.equal(auth.authorize(ops.ctx, 'risk:review'), true);
  assert.equal(auth.authorize(ops.ctx, 'reconciliation:run'), true);

  // Finance admin can execute reversal only with recent re-authentication
  finance.ctx.session.reauthVerifiedAt = Date.now() - 10 * 60 * 1000; // stale 10m ago
  assert.throws(
    () => auth.authorize(finance.ctx, 'reversal:execute', { requireRecentReauth: true }),
    (err) => err.code === 'REAUTH_REQUIRED'
  );
  auth.reauthenticateSensitiveAction({ accessToken: finance.token, password: 'StrongPassword!2026' });
  assert.equal(auth.authorize(finance.ctx, 'reversal:execute', { requireRecentReauth: true }), true);

  // Platform admin has wildcard permission
  assert.equal(auth.authorize(admin.ctx, 'ledger:verify'), true);

  // Audit logs are append-only & frozen
  assert.ok(auth.auditLogs.length >= 6);
  assert.equal(Object.isFrozen(auth.auditLogs[0]), true);
});
