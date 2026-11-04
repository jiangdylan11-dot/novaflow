import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateXiaotaoOperationCredits as calculate, parseCreditDecimal, multiplyCreditDecimal,
  addCreditDecimal, divideCreditDecimalPowerTen, creditDecimalText, ceilCreditLedgerUnits} from '../packages/shared/src/xiaotao-operation-pricing-v3.mjs';

const price = (values, extra = {}) => calculate({stages:values.map(usd => ({usd, cap:80})), creditsPerUsd:1, markup:1, ...extra});
test('positive stages share one operation minimum and one rounding step', () => {
  assert.equal(price([0.2, 0.2]).credits, 1);
  assert.equal(price([1.1, 1.1]).credits, 3);
  assert.equal(price([0, 0]).credits, 0);
  assert.equal(price([]).credits, 0);
});
test('only an explicit successful operation with a recorded stage has a zero-cost minimum', () => {
  for(const round of ['ceil','round','floor']) {
    assert.equal(price([0],{outcome:'success',round}).credits,1);
    assert.equal(price([0,0],{outcome:'success',round}).credits,1);
    assert.equal(price([0],{outcome:'cancel',round}).credits,0);
    assert.equal(price([0,0],{outcome:'cancel',round}).credits,0);
    assert.equal(price([0],{round}).credits,0);
  }
  assert.throws(()=>price([],{outcome:'success'}),/no recorded stage/);
  assert.equal(price([],{outcome:'cancel'}).credits,0);
  for(const outcome of [null,'pending','unknown',''])assert.throws(()=>price([0],{outcome}),/outcome is invalid/);
  assert.equal(price([0.2,0.2],{outcome:'cancel'}).credits,1);
  assert.equal(price([1.1,1.1],{outcome:'success'}).credits,3);
});
test('each request retains its own cap without an operation-wide cap', () => {
  const result = price([100, 60]);
  assert.equal(result.credits, 140);
  assert.deepEqual(result.stages.map(s => s.cappedRawCredits), [80, 60]);
});
test('snapshot conversion and configured rounding remain explicit', () => {
  assert.equal(calculate({stages:[{usd:0.00007,cap:80}],creditsPerUsd:211,markup:1.5}).credits, 1);
  assert.equal(price([1.1,1.1],{round:'floor'}).credits, 2);
  assert.equal(price([1.1,1.1],{round:'round'}).credits, 2);
  assert.equal(price([0.01],{round:'floor'}).credits, 1);
  assert.equal(calculate({stages:[{usd:90,cap:50},{usd:70,cap:75}],creditsPerUsd:1,markup:1}).credits, 120);
});
test('only success applies minimum to positive totals with each rounding mode', () => {
  for (const [round, cancelled] of [['ceil',1],['round',0],['floor',0]]) {
    assert.equal(price([0.2],{round,outcome:'success'}).credits,1);
    const result=price([0.2],{round,outcome:'cancel'});
    assert.equal(result.credits,cancelled);
    assert.equal(result.minimumPositiveCredits,0);
    assert.equal(price([0.2],{round}).credits,1);
  }
});
test('unverified or malformed inputs fail closed instead of inventing cost', () => {
  for (const bad of [null, undefined, '', -1, Infinity, NaN, '1e3', true]) {
    assert.throws(() => price([bad]));
  }
  assert.throws(() => calculate({stages:[{usd:1}],creditsPerUsd:1,markup:1}));
  assert.throws(() => calculate({stages:[{usd:1,cap:1.5}],creditsPerUsd:1,markup:1}));
  assert.equal(price(Array(14).fill(.1)).credits, 2);
  assert.throws(() => price(Array(15).fill(1)));
  assert.throws(() => calculate({stages:[{usd:1,cap:80}],creditsPerUsd:1,markup:0}));
  assert.throws(() => price([1],{round:'other'}));
});

const decimalPolicy = {credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0};
test('new decimal policy charges actual fractions without a one-credit minimum', () => {
  assert.equal(price([0.02], {...decimalPolicy,outcome:'success'}).credits, 0.02);
  const result=calculate({stages:[{usd:'0.00007',cap:80}],creditsPerUsd:'211',markup:'1.5',outcome:'success',...decimalPolicy});
  assert.equal(result.rawCreditsExact,'0.022155');
  assert.equal(result.credits,0.022155);
  assert.equal(result.minimumPositiveCredits,0);
  assert.equal(result.minimum_positive_credits,0);
  assert.equal(price([0], {...decimalPolicy,outcome:'success'}).credits,0);
  assert.equal(price([0], {...decimalPolicy,outcome:'cancel'}).credits,0);
});
test('stages sum exactly before a single six-place ledger quantization', () => {
  const result=price(['0.0000004','0.0000004','0.0000004'], {...decimalPolicy,outcome:'success'});
  assert.equal(result.rawCreditsExact,'0.0000012');
  assert.equal(result.credits,0.000002);
  assert.equal(price([0.1,0.2],decimalPolicy).rawCreditsExact,'0.3');
  assert.equal(price([0.1,0.2],decimalPolicy).credits,0.3);
  assert.equal(price([0.00000001],decimalPolicy).credits,0.000001);
  assert.equal(price([0.000001],decimalPolicy).credits,0.000001);
  assert.equal(price([0.0000010000001],decimalPolicy).credits,0.000002);
  assert.equal(price([1e-7],decimalPolicy).credits,0.000001);
});
test('decimal operation preserves stage caps and avoids operation-wide cap', () => {
  const result=price(['80.0000001','60.0000001'],decimalPolicy);
  assert.equal(result.rawCreditsExact,'140.0000001');
  assert.equal(result.credits,140.000001);
  assert.deepEqual(result.stages.map(stage=>stage.cappedRawCredits),[80,60.0000001]);
});
test('decimal policy is explicit and malformed policy or overflow fails closed', () => {
  for(const extra of [{credit_amount_policy:'decimal-v1'}, {credit_precision:6}, {minimum_positive_credits:0},
    {credit_amount_policy:undefined}, {credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil'},
    {...decimalPolicy,credit_precision:5}, {...decimalPolicy,credit_rounding:'floor'}, {...decimalPolicy,credit_amount_policy:'other'},
    {...decimalPolicy,minimum_positive_credits:1}, {...decimalPolicy,minimum_positive_credits:null},
    {...decimalPolicy,minimum_positive_credits:'0'}, {...decimalPolicy,minimum_positive_credits:undefined}]) {
    assert.throws(()=>price([0.02],extra),/credit amount policy is invalid/);
  }
  assert.throws(()=>calculate({stages:[{usd:'1',cap:80}],creditsPerUsd:Number.MAX_VALUE,markup:2,...decimalPolicy}),/conversion is invalid/);
  assert.throws(()=>price([Number.MAX_VALUE],{...decimalPolicy,markup:2}),/stage 0 cost is invalid/);
  assert.throws(()=>price(['1e-3'],decimalPolicy));
  assert.throws(()=>price(['1'.repeat(513)],decimalPolicy));
  assert.equal(price([0.02],{outcome:'success'}).credits,1);
});
test('decimal primitives support exact integer-token pricing without per-stage rounding', () => {
  const d=value=>parseCreditDecimal(value,'value');
  const tokens=addCreditDecimal(multiplyCreditDecimal(d(123),d('0.177')),
    multiplyCreditDecimal(d(45),d('0.7062')));
  const usd=divideCreditDecimalPowerTen(tokens,6);
  const credits=multiplyCreditDecimal(multiplyCreditDecimal(usd,d('211')),d('1.5'));
  assert.equal(creditDecimalText(usd),'0.00005355');
  assert.equal(creditDecimalText(credits),'0.016948575');
  assert.equal(ceilCreditLedgerUnits(credits),16949n);
  assert.equal(ceilCreditLedgerUnits(d(0)),0n);
  assert.throws(()=>divideCreditDecimalPowerTen(d(1),-1));
});
