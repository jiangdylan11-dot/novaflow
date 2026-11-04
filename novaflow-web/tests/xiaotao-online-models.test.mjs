// One list of 小桃 online brains: every server allowlist, the browser copies
// and the material route accept exactly these ids, and nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import {XIAOTAO_ONLINE_MODEL_IDS,XIAOTAO_FLAT_RATE_MODEL_IDS,xiaotaoOnlineModel} from '../packages/shared/src/xiaotao-online-models.mjs';
import {responsesToChatCompletions} from '../packages/shared/src/runninghub-llm.mjs';
import {hasXiaotaoModelRate,xiaotaoModelRatePolicy} from '../packages/shared/src/xiaotao-model-rates.mjs';
import {companionPricingPolicy} from '../packages/shared/src/companion-pricing.mjs';

const root=new URL('../',import.meta.url);
const QWEN='qwen/qwen3.8-flash-next',GLM='bytedance/doubao-seed-2.1-lite';

test('Qwen and Doubao are online brains beside DeepSeek, Grok and GPT', () => {
  const DOUBAO='bytedance/doubao-seed-2.1-lite';
  assert.deepEqual([...XIAOTAO_ONLINE_MODEL_IDS].sort(),['deepseek/deepseek-v4.1-flash',DOUBAO,'openai/gpt-6.1-sol-saver',QWEN,'xai/grok-4.7'].sort());
  assert.deepEqual([...XIAOTAO_FLAT_RATE_MODEL_IDS].sort(),['deepseek/deepseek-v4.1-flash',DOUBAO,QWEN].sort());
  for(const id of XIAOTAO_FLAT_RATE_MODEL_IDS)assert.equal(hasXiaotaoModelRate(id),true,id);
  const policy=xiaotaoModelRatePolicy();
  for(const id of [QWEN,GLM])assert.ok(policy[id].input>0&&policy[id].output>0&&policy[id].cached>=0,id);
});

test('no source keeps its own hand-written online model list', () => {
  const files=execFileSync('git',['ls-files','packages/shared/src','renderer','supabase/functions/novaflow-companion'],{cwd:root,encoding:'utf8'}).split('\n')
    .filter(name=>/\.(mjs|js|ts)$/.test(name)&&!name.includes('backend-legacy-')&&name!=='packages/shared/src/xiaotao-online-models.mjs');
  for(const name of files){
    const source=readFileSync(new URL(name,root),'utf8').replace(/\/\/ BEGIN GENERATED xiaotao-online-models[\s\S]*?\/\/ END GENERATED xiaotao-online-models/g,'');
    assert.doesNotMatch(source,/\[\s*'xai\/grok-4\.7'\s*,\s*'openai\/gpt-6\.1-sol-saver'\s*,\s*'deepseek/,name);
    assert.doesNotMatch(source,/GLM 已移除|RETIRED_GLM/,name);
  }
});

test('browser copies are generated from the shared list and in sync', () => {
  execFileSync(process.execPath,['tools/sync-xiaotao-online-models.mjs','--check'],{cwd:root});
  const context={};context.window=context;
  runInNewContext(readFileSync(new URL('renderer/feature-credit-prices.js',root),'utf8'),context);
  const source=readFileSync(new URL('renderer/xiaotao-art-agent.js',root),'utf8');
  for(const id of XIAOTAO_ONLINE_MODEL_IDS)assert.ok(source.includes(JSON.stringify(id)),id);
});

test('cloud material recognition accepts every online brain', () => {
  const {AIFX_MATERIAL_MODELS}=createRequire(import.meta.url)('../admin/admin-server/aifx-material.js');
  assert.deepEqual([...AIFX_MATERIAL_MODELS].sort(),[...XIAOTAO_ONLINE_MODEL_IDS].sort());
});

test('Qwen and GLM turn thinking off for ordinary calls and keep it for explicit high effort', () => {
  const body={input:[{role:'user',content:[{type:'input_text',text:'hi'}]}]};
  assert.equal(responsesToChatCompletions(body,QWEN).enable_thinking,false);
  assert.deepEqual(responsesToChatCompletions(body,GLM).thinking,{type:'disabled'});
  assert.deepEqual(responsesToChatCompletions(body,'deepseek/deepseek-v4.1-flash').thinking,{type:'disabled'});
  const high=responsesToChatCompletions({...body,reasoning:{effort:'high'}},QWEN);
  assert.equal(high.enable_thinking,undefined);assert.equal(high.reasoning_effort,'high');
  const grok=responsesToChatCompletions(body,'xai/grok-4.7');
  assert.equal(grok.thinking,undefined);assert.equal(grok.enable_thinking,undefined);
  assert.equal(Object.isFrozen(xiaotaoOnlineModel(GLM).thinkingOff),true);
});

test('Qwen and GLM are offered only with operation billing and an explicit server grant', async () => {
  const base={apiKey:'fixture',model:'xai/grok-4.7',pricingSnapshotReady:true,configRevision:'1'};
  const granted=await companionPricingPolicy({...base,operationTextChatV3:true,creditConfig:{xiaotao_online:{enabled_models:[QWEN,GLM]}}});
  const available=id=>granted.models.find(row=>row.id===id)?.available;
  assert.equal(available(QWEN),true);assert.equal(available(GLM),true);assert.equal(available('deepseek/deepseek-v4.1-flash'),false);
  const legacy=await companionPricingPolicy({...base,creditConfig:{xiaotao_online:{enabled_models:[QWEN,GLM]}}});
  assert.equal(legacy.models.find(row=>row.id===QWEN).available,false);
  assert.equal(legacy.models.find(row=>row.id===GLM).available,false);
});
test('Qwen gets thinking room in max_tokens and in the reservation',()=>{
  const body={input:[{role:'user',content:[{type:'input_text',text:'x'}]}],max_output_tokens:3000};
  assert.equal(responsesToChatCompletions(body,GLM).max_tokens,3000);assert.equal(responsesToChatCompletions(body,QWEN).max_tokens,8000);
  assert.equal(responsesToChatCompletions(body,'deepseek/deepseek-v4.1-flash').max_tokens,3000);
});
