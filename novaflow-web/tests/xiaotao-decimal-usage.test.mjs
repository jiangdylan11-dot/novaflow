import test from 'node:test';
import assert from 'node:assert/strict';
import {exactXiaotaoTokenCost,ceilXiaotaoLedgerCredit,hasXiaotaoDecimalV1,isXiaotaoCreditAmount,sumXiaotaoCreditAmounts,equalXiaotaoCreditAmounts}
  from '../packages/shared/src/xiaotao-decimal-usage.mjs';
import {estimateXiaotaoOnlineCredits} from '../packages/shared/src/feature-credits.mjs';

test('exact cached-token cost survives eight-place USD storage precision', () => {
  const value=exactXiaotaoTokenCost([{inputTokens:1,outputTokens:0,cachedTokens:1,
    inputRate:0.177,outputRate:0.7062,cachedRate:0.0036}],211,1.5);
  assert.deepEqual(value,{usdExact:'0.0000000036',rawCreditsExact:'0.0000011394'});
  assert.equal(ceilXiaotaoLedgerCredit(value.rawCreditsExact),0.000002);
});

test('sum request costs exactly before quantizing, never round each request', () => {
  const part={inputTokens:0,outputTokens:1,cachedTokens:0,inputRate:0.1,outputRate:0.00001,cachedRate:0.01};
  const one=exactXiaotaoTokenCost([part],211,1.5);
  const both=exactXiaotaoTokenCost([part,part],211,1.5);
  assert.equal(one.rawCreditsExact,'0.000000003165');
  assert.equal(both.rawCreditsExact,'0.00000000633');
  assert.equal(ceilXiaotaoLedgerCredit(both.rawCreditsExact),0.000001);
  assert.equal(ceilXiaotaoLedgerCredit('0'),0);
});

test('per-request tiers and exact decimals are honored without binary accumulation', () => {
  const make=(n,rate)=>({inputTokens:n,outputTokens:0,cachedTokens:0,inputRate:rate,outputRate:0,cachedRate:0});
  const value=exactXiaotaoTokenCost([make(1,0.1),make(1,0.2)],1,1);
  assert.equal(value.usdExact,'0.0000003');
  assert.equal(value.rawCreditsExact,'0.0000003');
  assert.equal(ceilXiaotaoLedgerCredit(value.rawCreditsExact),0.000001);
});

test('invalid usage and malformed policy fail closed', () => {
  const good={inputTokens:1,outputTokens:1,cachedTokens:0,inputRate:1,outputRate:1,cachedRate:1};
  assert.throws(()=>exactXiaotaoTokenCost([{...good,cachedTokens:2}],211,1.5));
  assert.throws(()=>exactXiaotaoTokenCost([{...good,outputTokens:0.5}],211,1.5));
  assert.throws(()=>exactXiaotaoTokenCost([{...good,inputRate:-1}],211,1.5));
  assert.throws(()=>exactXiaotaoTokenCost([{...good,outputRate:1001}],211,1.5));
  assert.throws(()=>ceilXiaotaoLedgerCredit('999999999999999999'));
  assert.equal(hasXiaotaoDecimalV1({xiaotao_online:{credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0}}),true);
  assert.equal(hasXiaotaoDecimalV1({xiaotao_online:{credit_amount_policy:'decimal-v1',credit_precision:5,credit_rounding:'ceil'}}),false);
});

test('new reservation is explicit, six-place and leaves legacy quote unchanged', () => {
  const config={credits_per_usd:211,xiaotao_online:{markup:1.5,chars_per_token:2,
    credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0}};
  const args={text:'hi',system:'',outputTokens:0,config,model:'deepseek/deepseek-v4.1-flash'};
  const old=estimateXiaotaoOnlineCredits(args);
  assert.equal(old.credits,1);
  const quote=estimateXiaotaoOnlineCredits({...args,amountPolicy:'decimal-v1'});
  assert.equal(quote.rawCreditsExact,'0.0000560205');
  assert.equal(quote.credits,0.000057);
  assert.throws(()=>estimateXiaotaoOnlineCredits({...args,amountPolicy:'decimal-v1',config:{}}));
  assert.throws(()=>estimateXiaotaoOnlineCredits({...args,amountPolicy:'decimal-v1',model:'unknown'}));
});

test('amount validation accepts exactly six places only under the frozen decimal policy', () => {
  const decimal={xiaotao_online:{credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0}};
  assert.equal(isXiaotaoCreditAmount(0.000001,decimal),true);
  assert.equal(isXiaotaoCreditAmount(0.0000001,decimal),false);
  assert.equal(isXiaotaoCreditAmount(0,decimal),false);
  assert.equal(isXiaotaoCreditAmount(0,decimal,{allowZero:true}),true);
  assert.equal(isXiaotaoCreditAmount(0.1,{}),false);
  assert.equal(isXiaotaoCreditAmount(1,{}),true);
  assert.equal(isXiaotaoCreditAmount(1,{xiaotao_online:{credit_amount_policy:'decimal-v1'}}),false);
  assert.equal(isXiaotaoCreditAmount(1,{xiaotao_online:{minimum_positive_credits:null}}),false);
  assert.equal(sumXiaotaoCreditAmounts([0.1,0.2,0.000001],decimal),0.300001);
  assert.equal(equalXiaotaoCreditAmounts(0.3,'0.300000',decimal),true);
  assert.equal(equalXiaotaoCreditAmounts(0.3,'0.300001',decimal),false);
  assert.equal(equalXiaotaoCreditAmounts(1,'1',{}),false);
  assert.throws(()=>sumXiaotaoCreditAmounts([1],{xiaotao_online:{credit_amount_policy:'decimal-v1'}}));
});
