import test from 'node:test';
import assert from 'node:assert/strict';
import {createRunningHubLiveRates,parseRunningHubRates,withLiveRates} from '../packages/shared/src/runninghub-live-rates.mjs';
import {xiaotaoModelRatePolicy} from '../packages/shared/src/xiaotao-model-rates.mjs';

const tier=(unit,discount)=>({unitPrice:unit,discountUnitPrice:discount});
const row=(publicName,input,output,cached)=>({publicName,pricing:{input:{tiers:input},output:{tiers:output},dimensions:{cache_read:{tiers:cached}}}});
const list=(scale=1)=>({data:[
  row('bytedance/doubao-seed-2.1-lite',[tier(.000118,.0000826*scale)],[tier(.000398,.0002786*scale)],[tier(.000024,.0000168*scale)]),
  row('openai/gpt-6.1-sol-saver',[tier(.002,.0007),tier(.004,.0014)],[tier(.01,.0035),tier(.015,.00525)],[tier(.0001,.000035),tier(.0002,.00007)]),
  row('xai/grok-4.7',[tier(.002,.0017),tier(.004,.0034)],[tier(.006,.0051),tier(.012,.0102)],[tier(.0005,.000425),tier(.001,.00085)]),
  row('deepseek/deepseek-v4.1-flash',[tier(.000295,.0000885)],[tier(.001177,.0003531)],[tier(.000006,.0000018)])
]});
const base=xiaotaoModelRatePolicy();

test('list prices become USD per million, the discount wins and DeepSeek stays fixed',()=>{
  const r=parseRunningHubRates(list(),base);
  assert.deepEqual(r.rejected,[]);
  assert.equal(r.model_rates['bytedance/doubao-seed-2.1-lite'].input,.0826);
  assert.equal(r.model_rates['openai/gpt-6.1-sol-saver'].highOutput,5.25);
  assert.equal(r.grok_4_7_rates.high_cached_input,.85);
  assert.equal(Object.hasOwn(r.model_rates,'deepseek/deepseek-v4.1-flash'),false);
});
test('a discount ending is followed, a broken reading keeps the built-in price',()=>{
  assert.equal(parseRunningHubRates(list(1/.7),base).model_rates['bytedance/doubao-seed-2.1-lite'].input,.118);
  for(const scale of [100,.01]){
    const r=parseRunningHubRates(list(scale),base);
    assert.equal(Object.hasOwn(r.model_rates,'bytedance/doubao-seed-2.1-lite'),false);assert.deepEqual(r.rejected,['bytedance/doubao-seed-2.1-lite']);
  }
  assert.equal(Object.keys(parseRunningHubRates({},base).model_rates).length,0);
});
test('one reading an hour, and a failed reading keeps the last good one',async()=>{
  let at=1000,calls=0,fail=false;
  const live=createRunningHubLiveRates({base,now:()=>at,fetchImpl:async()=>{calls++;if(fail)throw Error('down');return {ok:true,json:async()=>list()};}});
  const first=await live.current();await live.current();assert.equal(calls,1);
  at+=3600001;fail=true;assert.deepEqual(await live.current(),first);assert.equal(calls,2);assert.equal(live.status().failed,true);
  await live.current();assert.equal(calls,2,'retries wait five minutes');
  at+=300001;fail=false;await live.current();assert.equal(calls,3);assert.equal(live.status().failed,false);
});
test('with no reading the stored prices are untouched',()=>{
  const online={model_rates:{x:1}};
  assert.equal(withLiveRates(online,null),online);
  assert.deepEqual(withLiveRates(online,{model_rates:{y:2},grok_4_7_rates:{input:1}}),{model_rates:{x:1,y:2},grok_4_7_rates:{input:1}});
});
