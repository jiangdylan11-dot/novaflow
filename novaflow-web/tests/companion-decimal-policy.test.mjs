import test from 'node:test';
import assert from 'node:assert/strict';
import {companionPricingPolicy} from '../packages/shared/src/companion-pricing.mjs';

const config = {credits_per_usd:211, xiaotao_online:{markup:1.5}};
const decimalConfig = {...config,xiaotao_online:{...config.xiaotao_online,
  credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0}};
const provider = {apiKey:'test',model:'xai/grok-4.7',configRevision:'1',pricingSnapshotReady:true,
  operationTextChatV3:true,creditConfig:config};

test('fractional credit policy is default-closed and requires both trusted readiness signals', async () => {
  const baseline = await companionPricingPolicy(provider,{revision:'test'});
  assert.equal(baseline.config.xiaotao_online.minimum_positive_credits,1);
  assert.equal(baseline.config.xiaotao_online.credit_amount_policy,undefined);
  const unchanged=await companionPricingPolicy({...provider,operationDecimalCreditsV1:false,operationDecimalLedgerReady:false},{revision:'test'});
  assert.equal(unchanged.version,baseline.version);
  assert.equal(baseline.models.find(row=>row.id==='xai/grok-4.7').available,true);
  for (const flags of [
    {},{operationDecimalCreditsV1:true},
    {operationDecimalLedgerReady:true},
    {operationDecimalCreditsV1:true,operationDecimalLedgerReady:false}
  ]) {
    const candidate=await companionPricingPolicy({...provider,creditConfig:decimalConfig,...flags},{revision:'test'});
    assert.equal(candidate.config.xiaotao_online.credit_amount_policy,undefined);
    assert.ok(candidate.models.every(row=>row.available===false));
  }
});

test('verified decimal configuration is versioned, six-place and has no one-credit minimum', async () => {
  const oldPolicy=await companionPricingPolicy(provider,{revision:'test'});
  const policy=await companionPricingPolicy({...provider,creditConfig:decimalConfig,operationDecimalCreditsV1:true,operationDecimalLedgerReady:true},{revision:'test'});
  assert.notEqual(policy.version,oldPolicy.version);
  assert.equal(policy.config.xiaotao_online.minimum_positive_credits,0);
  assert.equal(policy.config.xiaotao_online.credit_amount_policy,'decimal-v1');
  assert.equal(policy.config.xiaotao_online.credit_precision,6);
  assert.equal(policy.config.xiaotao_online.credit_rounding,'ceil');
  assert.equal(policy.config.xiaotao_online.markup,oldPolicy.config.xiaotao_online.markup);
  assert.equal(policy.config.credits_per_usd,oldPolicy.config.credits_per_usd);
  for (const override of [{credit_precision:5},{credit_rounding:'round'},{credit_amount_policy:'unknown'},{minimum_positive_credits:1}]) {
    const invalid={...provider,operationDecimalCreditsV1:true,operationDecimalLedgerReady:true,
      creditConfig:{...decimalConfig,xiaotao_online:{...decimalConfig.xiaotao_online,...override}}};
    const result=await companionPricingPolicy(invalid,{revision:'test'});
    assert.equal(result.config.xiaotao_online.credit_amount_policy,undefined);
    assert.equal(result.config.xiaotao_online.minimum_positive_credits,1);
    assert.ok(result.models.every(row=>row.available===false));
  }
});

