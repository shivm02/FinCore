'use strict';

const crypto = require('crypto');
const { AppError } = require('../../core/errors');

const ROLES = Object.freeze({
  CUSTOMER: 'customer',
  SUPPORT_AGENT: 'support_agent',
  OPERATIONS_ANALYST: 'operations_analyst',
  FINANCE_ADMIN: 'finance_administrator',
  PLATFORM_ADMIN: 'platform_administrator',
});

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.CUSTOMER]: new Set([
    'wallet:read:own', 'wallet:create:own', 'beneficiary:manage:own',
    'transfer:create:own', 'payment_intent:create:own', 'dispute:create:own',
    'statement:read:own', 'transaction:read:own',
  ]),
  [ROLES.SUPPORT_AGENT]: new Set([
    'wallet:read:any', 'transaction:read:any', 'dispute:read:any', 'dispute:update',
    'audit:read',
  ]),
  [ROLES.OPERATIONS_ANALYST]: new Set([
    'wallet:read:any', 'transaction:read:any', 'dispute:read:any', 'dispute:resolve',
    'risk:read', 'risk:review', 'reconciliation:run', 'reconciliation:read', 'audit:read',
  ]),
  [ROLES.FINANCE_ADMIN]: new Set([
    'wallet:read:any', 'transaction:read:any', 'refund:execute', 'reversal:execute',
    'reconciliation:run', 'reconciliation:read', 'statement:read:any', 'audit:read',
    'ledger:verify',
  ]),
  [ROLES.PLATFORM_ADMIN]: new Set(['*']),
});

function base64UrlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecode(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function hashPassword(password) {
  if (!password || password.length < 10) {
    throw new AppError(400, 'WEAK_PASSWORD', 'Password must be at least 10 characters long');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

class AuthService {
  constructor({ accessSecret, refreshSecret } = {}) {
    this.accessSecret = accessSecret || process.env.JWT_ACCESS_SECRET || 'dev-only-access-secret-min-32-chars!!';
    this.refreshSecret = refreshSecret || process.env.JWT_REFRESH_SECRET || 'dev-only-refresh-secret-min-32-chars!';
    this.users = new Map();
    this.usersByEmail = new Map();
    this.sessions = new Map();
    this.revokedTokens = new Set();
    this.mfaChallenges = new Map();
    this.auditLogs = [];
  }

  recordAudit({ actorUserId, actorRole, action, resourceType, resourceId, requestId, outcome, metadata = {} }) {
    const entry = Object.freeze({
      id: crypto.randomUUID(),
      actorUserId: actorUserId || null,
      actorRole: actorRole || null,
      action,
      resourceType,
      resourceId: resourceId || null,
      requestId: requestId || crypto.randomUUID(),
      outcome,
      metadata: Object.freeze({ ...metadata }),
      createdAt: new Date().toISOString(),
    });
    this.auditLogs.push(entry);
    return entry;
  }

  registerUser({ email, password, fullName, role = ROLES.CUSTOMER, requestId }) {
    const normEmail = String(email || '').trim().toLowerCase();
    if (!normEmail || !normEmail.includes('@')) {
      throw new AppError(400, 'INVALID_EMAIL', 'A valid email address is required');
    }
    if (!Object.values(ROLES).includes(role)) {
      throw new AppError(400, 'INVALID_ROLE', 'Unsupported user role');
    }
    if (this.usersByEmail.has(normEmail)) {
      throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists');
    }
    const id = crypto.randomUUID();
    const user = {
      id,
      email: normEmail,
      passwordHash: hashPassword(password),
      fullName: String(fullName || 'FinCore User').trim(),
      role,
      status: 'active',
      mfaEnabled: true,
      failedLogins: 0,
      createdAt: new Date().toISOString(),
    };
    this.users.set(id, user);
    this.usersByEmail.set(normEmail, user);
    this.recordAudit({
      actorUserId: id,
      actorRole: role,
      action: 'user.register',
      resourceType: 'user',
      resourceId: id,
      requestId,
      outcome: 'success',
    });
    return this.sanitizeUser(user);
  }

  sanitizeUser(user) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      mfaEnabled: user.mfaEnabled,
      createdAt: user.createdAt,
    };
  }

  signJwt(payload, secret, ttlSeconds) {
    const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const now = Math.floor(Date.now() / 1000);
    const body = base64UrlEncode(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds, jti: crypto.randomUUID() }));
    const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
  }

  verifyJwt(token, secret) {
    if (!token || typeof token !== 'string') {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authentication token');
    }
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new AppError(401, 'INVALID_TOKEN', 'Malformed authentication token');
    }
    const [header, body, sig] = parts;
    const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid token signature');
    }
    const decoded = JSON.parse(base64UrlDecode(body));
    if (decoded.exp < Math.floor(Date.now() / 1000)) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Authentication token expired');
    }
    if (this.revokedTokens.has(decoded.jti)) {
      throw new AppError(401, 'TOKEN_REVOKED', 'Authentication token has been revoked');
    }
    return decoded;
  }

  login({ email, password, requestId }) {
    const user = this.usersByEmail.get(String(email || '').trim().toLowerCase());
    if (!user || !verifyPassword(password, user.passwordHash)) {
      if (user) user.failedLogins += 1;
      this.recordAudit({
        actorUserId: user ? user.id : null,
        actorRole: user ? user.role : null,
        action: 'auth.login',
        resourceType: 'session',
        requestId,
        outcome: 'denied',
      });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    if (user.status !== 'active') {
      throw new AppError(403, 'ACCOUNT_INACTIVE', 'Account is not active');
    }
    user.failedLogins = 0;

    // Issue MFA simulation challenge
    const challenge = this.createMfaChallenge(user.id, 'login');
    return {
      mfaRequired: true,
      challengeId: challenge.id,
      // Sandbox-only simulated OTP code returned for automated tests & local demo
      simulatedOtp: challenge.plainCode,
      user: this.sanitizeUser(user),
    };
  }

  createMfaChallenge(userId, purpose) {
    const plainCode = String(crypto.randomInt(100000, 999999));
    const id = crypto.randomUUID();
    const record = {
      id,
      userId,
      purpose,
      codeHash: crypto.createHash('sha256').update(plainCode).digest('hex'),
      expiresAt: Date.now() + 5 * 60 * 1000,
      consumed: false,
      attempts: 0,
    };
    this.mfaChallenges.set(id, record);
    return { id, plainCode, purpose, expiresAt: new Date(record.expiresAt).toISOString() };
  }

  verifyMfaAndCreateSession({ challengeId, code, requestId }) {
    const challenge = this.mfaChallenges.get(challengeId);
    if (!challenge || challenge.consumed || Date.now() > challenge.expiresAt) {
      throw new AppError(401, 'MFA_INVALID', 'MFA challenge is invalid or expired');
    }
    challenge.attempts += 1;
    if (challenge.attempts > 5) {
      throw new AppError(429, 'MFA_LOCKED', 'Too many MFA verification attempts');
    }
    const providedHash = crypto.createHash('sha256').update(String(code || '')).digest('hex');
    if (providedHash !== challenge.codeHash) {
      throw new AppError(401, 'MFA_INVALID', 'Incorrect MFA verification code');
    }
    challenge.consumed = true;
    const user = this.users.get(challenge.userId);
    const sessionId = crypto.randomUUID();
    const session = {
      id: sessionId,
      userId: user.id,
      role: user.role,
      mfaVerifiedAt: Date.now(),
      reauthVerifiedAt: Date.now(),
      revoked: false,
    };
    this.sessions.set(sessionId, session);

    const accessToken = this.signJwt({ sub: user.id, role: user.role, sid: sessionId, mfa: true }, this.accessSecret, 900);
    const refreshToken = this.signJwt({ sub: user.id, sid: sessionId, type: 'refresh' }, this.refreshSecret, 7 * 86400);

    this.recordAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'auth.session_created',
      resourceType: 'session',
      resourceId: sessionId,
      requestId,
      outcome: 'success',
    });

    return { accessToken, refreshToken, sessionId, user: this.sanitizeUser(user) };
  }

  authenticate(accessToken) {
    const claims = this.verifyJwt(accessToken, this.accessSecret);
    const session = this.sessions.get(claims.sid);
    if (!session || session.revoked) {
      throw new AppError(401, 'SESSION_REVOKED', 'Session has been revoked');
    }
    const user = this.users.get(claims.sub);
    if (!user || user.status !== 'active') {
      throw new AppError(401, 'UNAUTHORIZED', 'User not found or inactive');
    }
    return { user: this.sanitizeUser(user), session, claims };
  }

  refreshSession({ refreshToken, requestId }) {
    const claims = this.verifyJwt(refreshToken, this.refreshSecret);
    const session = this.sessions.get(claims.sid);
    if (!session || session.revoked) {
      throw new AppError(401, 'SESSION_REVOKED', 'Refresh session is revoked');
    }
    const user = this.users.get(claims.sub);
    const accessToken = this.signJwt({ sub: user.id, role: user.role, sid: session.id, mfa: true }, this.accessSecret, 900);
    this.recordAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'auth.token_refreshed',
      resourceType: 'session',
      resourceId: session.id,
      requestId,
      outcome: 'success',
    });
    return { accessToken };
  }

  revokeSession({ accessToken, requestId }) {
    const { user, session, claims } = this.authenticate(accessToken);
    session.revoked = true;
    this.revokedTokens.add(claims.jti);
    this.recordAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'auth.session_revoked',
      resourceType: 'session',
      resourceId: session.id,
      requestId,
      outcome: 'success',
    });
    return { revoked: true };
  }

  reauthenticateSensitiveAction({ accessToken, password, requestId }) {
    const { user, session } = this.authenticate(accessToken);
    const fullUser = this.users.get(user.id);
    if (!verifyPassword(password, fullUser.passwordHash)) {
      this.recordAudit({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'auth.reauth',
        resourceType: 'session',
        resourceId: session.id,
        requestId,
        outcome: 'denied',
      });
      throw new AppError(403, 'REAUTH_FAILED', 'Re-authentication failed');
    }
    session.reauthVerifiedAt = Date.now();
    this.recordAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'auth.reauth',
      resourceType: 'session',
      resourceId: session.id,
      requestId,
      outcome: 'success',
    });
    return { reauthenticatedAt: new Date(session.reauthVerifiedAt).toISOString() };
  }

  authorize(authContext, permission, { ownerUserId = null, requireRecentReauth = false, requestId } = {}) {
    const { user, session } = authContext;
    const perms = ROLE_PERMISSIONS[user.role] || new Set();
    const allowed = perms.has('*') || perms.has(permission);
    if (!allowed) {
      this.recordAudit({
        actorUserId: user.id,
        actorRole: user.role,
        action: `authz.denied:${permission}`,
        resourceType: 'authorization',
        requestId,
        outcome: 'denied',
      });
      throw new AppError(403, 'FORBIDDEN', `Role "${user.role}" lacks permission "${permission}"`);
    }
    if (permission.endsWith(':own') && ownerUserId && ownerUserId !== user.id && user.role !== ROLES.PLATFORM_ADMIN) {
      throw new AppError(403, 'RESOURCE_FORBIDDEN', 'You are not authorized to access this resource');
    }
    if (requireRecentReauth) {
      const ageMs = Date.now() - (session.reauthVerifiedAt || 0);
      if (ageMs > 5 * 60 * 1000) {
        throw new AppError(403, 'REAUTH_REQUIRED', 'Sensitive action requires recent password re-authentication');
      }
    }
    return true;
  }
}

module.exports = { AuthService, ROLES, ROLE_PERMISSIONS, hashPassword, verifyPassword };
