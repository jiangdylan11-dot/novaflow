// Decimal-v1 only. Inputs must come from server-validated provider usage and
// the immutable server price snapshot, never directly from a browser payload.
// Keep each request's own rate tier. No ledger rounding occurs in this file.
import {parseCreditDecimal, multiplyCreditDecimal, addCreditDecimal, compareCreditDecimal,
  divideCreditDecimalPowerTen, creditDecimalText, ceilCreditLedgerUnits}
  from './xiaotao-operation-pricing-v3.mjs';

const zero = () => parseCreditDecimal(0, 'zero');
const count = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} is invalid`);
  return value;
};
const rate = (value, name) => {
  const parsed = parseCreditDecimal(value, name);
  if (Number(value) > 1000) throw new TypeError(`${name} is invalid`);
  return parsed;
};

export function xiaotaoCreditAmountPolicy(config) {
  const online = config?.xiaotao_online;
  const markers = ['credit_amount_policy','credit_precision','credit_rounding'];
  const present = markers.some(key => online != null && Object.hasOwn(online,key));
  const hasMinimum = online != null && Object.hasOwn(online,'minimum_positive_credits');
  if (!present) return !hasMinimum || online.minimum_positive_credits === 1 ? 'legacy' : 'invalid';
  return online?.credit_amount_policy === 'decimal-v1'
    && online?.credit_precision === 6 && online?.credit_rounding === 'ceil'
    && online?.minimum_positive_credits === 0 ? 'decimal-v1' : 'invalid';
}
export const hasXiaotaoDecimalV1 = config => xiaotaoCreditAmountPolicy(config) === 'decimal-v1';

// This validates credit amounts only. Token counts, sequence numbers and
// feature prices retain their original integer contracts.
export function isXiaotaoCreditAmount(value, config, {allowZero=false, max=1000000} = {}) {
  if (!Number.isSafeInteger(max) || max < 0) return false;
  const policy = xiaotaoCreditAmountPolicy(config);
  if (policy === 'invalid') return false;
  if (policy === 'legacy') {
    return Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1) && value <= max;
  }
  try {
    if (!['number','string'].includes(typeof value)) return false;
    const parsed = parseCreditDecimal(value, 'credit amount');
    if (parsed.scale > 6) return false;
    const units = ceilCreditLedgerUnits(parsed);
    return (allowZero || units > 0n) && units <= BigInt(max) * 1000000n;
  } catch {return false;}
}

// Reservation totals use integer microcredits. Do not add decimal Numbers in
// a loop: the total is a hold, not the eventual aggregate charge.
export function sumXiaotaoCreditAmounts(values, config) {
  if (!Array.isArray(values) || values.length > 14) throw new TypeError('credit amounts are invalid');
  const policy = xiaotaoCreditAmountPolicy(config);
  if (policy === 'invalid') throw new TypeError('credit amount policy is invalid');
  if (policy === 'legacy') {
    if (values.some(value => !isXiaotaoCreditAmount(value, config, {allowZero:true}))) throw new TypeError('credit amounts are invalid');
    const total = values.reduce((sum, value) => sum + value, 0);
    if (!Number.isSafeInteger(total)) throw new TypeError('credit total is invalid');
    return total;
  }
  let units=0n;
  for (const value of values) {
    if (!isXiaotaoCreditAmount(value, config, {allowZero:true})) throw new TypeError('credit amounts are invalid');
    units += ceilCreditLedgerUnits(parseCreditDecimal(value, 'credit amount'));
  }
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError('credit total is invalid');
  return Number(units) / 1000000;
}

export function equalXiaotaoCreditAmounts(left, right, config, options) {
  if (!isXiaotaoCreditAmount(left, config, options) || !isXiaotaoCreditAmount(right, config, options)) return false;
  if (!hasXiaotaoDecimalV1(config)) return left === right;
  return compareCreditDecimal(parseCreditDecimal(left, 'left amount'),parseCreditDecimal(right, 'right amount')) === 0;
}

// Parts are normalized token-rate estimates from the established validation
// path. Do not sum Number `usd` or the ledger's eight-place USD field.
export function exactXiaotaoTokenCost(parts, creditsPerUsd, markup) {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 10) throw new TypeError('parts are invalid');
  let usd = zero();
  for (const part of parts) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) throw new TypeError('part is invalid');
    const input = count(part.inputTokens, 'inputTokens');
    const output = count(part.outputTokens, 'outputTokens');
    const cached = count(part.cachedTokens, 'cachedTokens');
    if (cached > input || !Number.isSafeInteger(input + output) || input + output === 0) throw new TypeError('token usage is invalid');
    const components = [
      [input-cached, rate(part.inputRate, 'inputRate')],
      [cached, rate(part.cachedRate, 'cachedRate')],
      [output, rate(part.outputRate, 'outputRate')]
    ];
    let request = zero();
    for (const [tokens, unitRate] of components) {
      request = addCreditDecimal(request, multiplyCreditDecimal(parseCreditDecimal(tokens, 'tokens'), unitRate));
    }
    usd = addCreditDecimal(usd, divideCreditDecimalPowerTen(request, 6));
  }
  const conversion = multiplyCreditDecimal(parseCreditDecimal(creditsPerUsd, 'creditsPerUsd', {allowZero:false}),
    parseCreditDecimal(markup, 'markup', {allowZero:false}));
  const raw = multiplyCreditDecimal(usd, conversion);
  const usdExact = creditDecimalText(usd);
  const rawCreditsExact = creditDecimalText(raw);
  if (!Number.isFinite(Number(usdExact)) || !Number.isFinite(Number(rawCreditsExact))) throw new TypeError('cost is invalid');
  return {usdExact, rawCreditsExact};
}

// For a reservation only. Final settlement must aggregate all stage raw
// costs first in PostgreSQL, then quantize the operation once.
export function ceilXiaotaoLedgerCredit(raw) {
  const units = ceilCreditLedgerUnits(parseCreditDecimal(raw, 'credit amount'));
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError('credit amount is invalid');
  return Number(units) / 1000000;
}
