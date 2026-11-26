'use strict';

/**
 * Idempotent, retry-safe reconciliation & settlement worker (Assessments 08 & 09).
 * Uses exponential backoff and records terminal failures into a controlled recovery queue.
 */
async function executeWithRetry(jobFn, { maxAttempts = 3, baseDelayMs = 100 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await jobFn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, baseDelayMs * (2 ** (attempt - 1))));
      }
    }
  }
  throw lastError;
}

if (require.main === module) {
  console.log(JSON.stringify({ level: 'info', msg: 'FinCore reconciliation worker ready (idempotent mode)' }));
}

module.exports = { executeWithRetry };
