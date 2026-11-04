// GENERATED COPY - source: packages/shared/src/xiaotao-operation-pricing-v3.mjs
// Pure calculation for the operation pricing contract.
// The caller must supply authenticated, immutable per-operation snapshot values
// and verified per-stage costs. This module neither authorizes nor charges.

function number(value, name, {allowZero = true} = {}) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!/^\d+(?:\.\d+)?$/.test(text)) throw new TypeError(`${name} is invalid`);
    value = Number(text);
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

// Decimal values are represented as an integer coefficient and a base-10
// scale. This avoids rounding each provider stage through binary floating
// point before the operation total is quantized for the six-place ledger.
function decimal(value, name = 'value', options) {
  number(value, name, options);
  const text = typeof value === 'string' ? value.trim() : String(value);
  if (text.length > 512) throw new TypeError(`${name} is invalid`);
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) throw new TypeError(`${name} is invalid`);
  let coefficient = BigInt(match[1] + (match[2] || ''));
  let scale = (match[2] || '').length - Number(match[3] || 0);
  if (!Number.isSafeInteger(scale) || Math.abs(scale) > 512) throw new TypeError(`${name} is invalid`);
  if (scale < 0) { coefficient *= 10n ** BigInt(-scale); scale = 0; }
  return compactDecimal({coefficient, scale});
}
function compactDecimal(value) {
  let {coefficient, scale} = value;
  if (coefficient === 0n) return {coefficient:0n, scale:0};
  while (scale > 0 && coefficient % 10n === 0n) { coefficient /= 10n; scale--; }
  return {coefficient, scale};
}
function multiplyDecimal(a, b) {
  return compactDecimal({coefficient:a.coefficient * b.coefficient, scale:a.scale + b.scale});
}
function addDecimal(a, b) {
  const scale = Math.max(a.scale, b.scale);
  return compactDecimal({coefficient:a.coefficient * 10n ** BigInt(scale - a.scale)
    + b.coefficient * 10n ** BigInt(scale - b.scale), scale});
}
function compareDecimal(a, b) {
  const scale = Math.max(a.scale, b.scale);
  const left = a.coefficient * 10n ** BigInt(scale - a.scale);
  const right = b.coefficient * 10n ** BigInt(scale - b.scale);
  return left < right ? -1 : left > right ? 1 : 0;
}
function decimalText(value) {
  const digits = value.coefficient.toString();
  if (!value.scale) return digits;
  const padded = digits.padStart(value.scale + 1, '0');
  return padded.slice(0, -value.scale) + '.' + padded.slice(-value.scale);
}
function ceilLedgerUnits(value) {
  if (value.scale <= 6) return value.coefficient * 10n ** BigInt(6 - value.scale);
  const divisor = 10n ** BigInt(value.scale - 6);
  return (value.coefficient + divisor - 1n) / divisor;
}
function divideDecimalPowerTen(value, power) {
  if (!Number.isSafeInteger(power) || power < 0 || power > 512) throw new TypeError('decimal divisor is invalid');
  return compactDecimal({coefficient:value.coefficient,scale:value.scale + power});
}

export {decimal as parseCreditDecimal, multiplyDecimal as multiplyCreditDecimal,
  addDecimal as addCreditDecimal, compareDecimal as compareCreditDecimal,
  divideDecimalPowerTen as divideCreditDecimalPowerTen, decimalText as creditDecimalText,
  ceilLedgerUnits as ceilCreditLedgerUnits};

function calculateDecimalOperation({stages, creditsPerUsd, markup, round, outcome}) {
  const factor = multiplyDecimal(decimal(creditsPerUsd, 'creditsPerUsd', {allowZero:false}),
    decimal(markup, 'markup', {allowZero:false}));
  if (!Number.isFinite(Number(decimalText(factor)))) throw new TypeError('conversion is invalid');
  let total = {coefficient:0n, scale:0};
  const normalized = stages.map((stage, index) => {
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) throw new TypeError(`stage ${index} is invalid`);
    const usd = number(stage.usd, `stage ${index} cost`);
    const raw = multiplyDecimal(decimal(stage.usd, `stage ${index} cost`), factor);
    const cap = number(stage.cap, `stage ${index} cap`, {allowZero:false});
    if (!Number.isSafeInteger(cap) || cap > 1000000) throw new TypeError(`stage ${index} cap is invalid`);
    const rawCredits = Number(decimalText(raw));
    if (!Number.isFinite(rawCredits)) throw new TypeError(`stage ${index} cost is invalid`);
    const capped = compareDecimal(raw, {coefficient:BigInt(cap),scale:0}) > 0
      ? {coefficient:BigInt(cap),scale:0} : raw;
    total = addDecimal(total, capped);
    return {usd, rawCredits, cappedRawCredits:Number(decimalText(capped)), cap};
  });
  const units = ceilLedgerUnits(total);
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError('total is invalid');
  const rawCreditsExact = decimalText(total);
  const credits = Number(units) / 1000000;
  return {stages:normalized, rawCredits:Number(rawCreditsExact), rawCreditsExact, credits,
    round, minimumPositiveCredits:0, credit_amount_policy:'decimal-v1', credit_precision:6, credit_rounding:'ceil', minimum_positive_credits:0};
}

/**
 * Aggregate verified stage costs using the operation's frozen policy.
 * Each stage retains its own existing cap. The operation has no extra cap;
 * only after summing capped raw credits do we round. Legacy snapshots retain
 * their existing whole-credit rounding and minimum. An explicit decimal-v1
 * snapshot instead quantizes a nonzero total upward to the ledger's six
 * decimal places, without an additional one-credit minimum. This helper
 * cannot itself verify a stage.
 *
 * This helper does not handle holds, dispatch, identity, stale operations or
 * settlement; callers must validate and enforce those contracts independently.
 */
export function calculateXiaotaoOperationCredits(options = {}) {
  const {stages, creditsPerUsd, markup, round = 'ceil', outcome,
    credit_amount_policy, credit_precision, credit_rounding, minimum_positive_credits} = options;
  // The existing planner allows 10 rounds plus one four-round handoff.
  if (!Array.isArray(stages) || stages.length > 14) throw new TypeError('stages is invalid');
  if (!['ceil', 'round', 'floor'].includes(round)) throw new TypeError('round is invalid');
  if (outcome !== undefined && !['success', 'cancel'].includes(outcome)) throw new TypeError('outcome is invalid');
  if (outcome === 'success' && stages.length === 0) throw new TypeError('successful operation has no recorded stage');
  if (['credit_amount_policy','credit_precision','credit_rounding','minimum_positive_credits'].some(key => Object.hasOwn(options,key))) {
    if (credit_amount_policy !== 'decimal-v1' || credit_precision !== 6 || credit_rounding !== 'ceil' || minimum_positive_credits !== 0) {
      throw new TypeError('credit amount policy is invalid');
    }
    return calculateDecimalOperation({stages, creditsPerUsd, markup, round, outcome});
  }
  const factor = number(creditsPerUsd, 'creditsPerUsd', {allowZero:false}) * number(markup, 'markup', {allowZero:false});
  if (!Number.isFinite(factor)) throw new TypeError('conversion is invalid');
  let total = 0;
  const normalized = stages.map((stage, index) => {
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) throw new TypeError(`stage ${index} is invalid`);
    const usd = number(stage.usd, `stage ${index} cost`);
    const cap = number(stage.cap, `stage ${index} cap`, {allowZero:false});
    if (!Number.isSafeInteger(cap) || cap > 1000000) throw new TypeError(`stage ${index} cap is invalid`);
    const raw = usd * factor;
    if (!Number.isFinite(raw)) throw new TypeError(`stage ${index} cost is invalid`);
    const capped = Math.min(raw, cap);
    total += capped;
    if (!Number.isFinite(total)) throw new TypeError('total is invalid');
    return {usd, rawCredits:raw, cappedRawCredits:capped, cap};
  });
  const minimumPositiveCredits = outcome === 'cancel' ? 0 : 1;
  if (total === 0) return {stages:normalized, rawCredits:0, credits:outcome === 'success' ? 1 : 0, round, minimumPositiveCredits};
  const rounded = round === 'floor' ? Math.floor(total + 1e-9)
    : round === 'round' ? Math.round(total) : Math.ceil(total - 1e-9);
  if (!Number.isSafeInteger(rounded)) throw new TypeError('total is invalid');
  return {stages:normalized, rawCredits:total, credits:Math.max(minimumPositiveCredits, rounded), round, minimumPositiveCredits};
}
