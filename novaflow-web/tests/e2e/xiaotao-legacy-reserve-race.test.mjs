import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeatureCreditPorts} from '../../packages/shared/src/feature-credits.mjs';
import {createOnlineAiCharge} from '../../packages/shared/src/online-ai-charge.mjs';

test('legacy Xiaotao unique conflict reports possible existing hold without invoking provider', async () => {
  let providerCalls = 0;
  const ports = createFeatureCreditPorts(async name => {
    assert.equal(name, 'reserve_feature_credits');
    throw Object.assign(new Error('duplicate key value'), {code:'23505'});
  });
  const charge = createOnlineAiCharge(ports);
  await assert.rejects(charge({userId:'user',feature:'xiaotao-text',amount:1,usageKey:'same-key',estimatedCredits:20,
    run:async()=>{providerCalls++;}}), error => error.statusCode === 503 &&
      error.code === 'xiaotao_reservation_status_unknown' && /正在进行的一笔重复/.test(error.message) && !/核对/.test(error.message) &&
      !/未扣积分|积分不足/.test(error.message));
  assert.equal(providerCalls,0);
});

test('non-Xiaotao unique conflicts do not acquire Xiaotao-specific semantics', async () => {
  const ports = createFeatureCreditPorts(async()=>{throw Object.assign(new Error('duplicate key value'),{code:'23505'});});
  await assert.rejects(ports.reserve({userId:'user',feature:'image_reverse',amount:1,usageKey:'other'}),
    error => error.statusCode === 402 && error.code !== 'xiaotao_reservation_status_unknown');
});
