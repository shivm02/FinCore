'use strict';

/**
 * Exact fixed-point monetary arithmetic scaled to 10,000 (4 decimal places, matching NUMERIC(19,4)).
 * Avoids IEEE-754 binary floating-point rounding defects.
 */
const SCALE = 10000n;
const MONEY_PATTERN = /^(-?)(\d+)(?:\.(\d{1,4}))?$/;

function parseMoney(value) {
  if (typeof value === 'bigint') return value;
  const str = String(value).trim();
  const match = MONEY_PATTERN.exec(str);
  if (!match) {
    throw new Error(`Invalid monetary amount: "${value}". Expected decimal string with up to 4 decimals.`);
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2]);
  const frac = BigInt((match[3] || '').padEnd(4, '0'));
  return sign * (whole * SCALE + frac);
}

function formatMoney(units) {
  const big = typeof units === 'bigint' ? units : BigInt(units);
  const sign = big < 0n ? '-' : '';
  const abs = big < 0n ? -big : big;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(4, '0');
  return `${sign}${whole}.${frac}`;
}

function assertPositiveMoney(value, fieldName = 'amount') {
  const units = parseMoney(value);
  if (units <= 0n) {
    throw new Error(`${fieldName} must be greater than zero`);
  }
  return units;
}

/**
 * Compute transfer fee using basis points (e.g., 25 bps = 0.25%) with HALF_EVEN (banker's) rounding to 2 decimals.
 */
function calculateFeeBps(amountUnits, bps = 25n, minFeeUnits = 5000n, maxFeeUnits = 250000n) {
  if (amountUnits <= 0n) return 0n;
  // Raw scaled by 10,000 bps -> divide by 10,000 with half-even rounding to nearest cent (100 units = $0.01)
  const numerator = amountUnits * BigInt(bps);
  const divisor = 10000n * 100n; // 100 units = $0.01
  const q = numerator / divisor;
  const r = numerator % divisor;
  const half = divisor / 2n;
  let cents = q;
  if (r > half || (r === half && (q % 2n === 1n))) {
    cents = q + 1n;
  }
  let feeUnits = cents * 100n;
  if (feeUnits < minFeeUnits) feeUnits = minFeeUnits;
  if (feeUnits > maxFeeUnits) feeUnits = maxFeeUnits;
  return feeUnits;
}

module.exports = {
  SCALE,
  parseMoney,
  formatMoney,
  assertPositiveMoney,
  calculateFeeBps,
};
