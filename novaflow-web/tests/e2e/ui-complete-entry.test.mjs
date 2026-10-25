import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {parseRepairFields} from '../../worker/src/complete-ui-draft.mjs';
import {createPromptAssistant,normalizeReverseRequest} from '../../worker/src/prompt-assistant.mjs';
const fixture=JSON.parse(readFileSync(new URL('../fixtures/ui-grok-vision-panda-history.json',import.meta.url),'utf8'));
const config={pythonPath:process.env.NOVAFLOW_TEST_PYTHON||'python',serviceScript:fileURLToPath(new URL('../../../particle-editor-desktop/prompt-assistant-service.py',import.meta.url))};
const payload=extra=>({surface:'ui-design',uiPlanner:'grok-vision-cpu-v1',...extra});
const image={role:'layout',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDikAAAAASUVORK5CYII='};

test('supported CPU handshake refuses old nodes before NF4 work; actual new CPU path performs no model calls',async()=>{
 assert.throws(()=>normalizeReverseRequest(payload({action:'capabilities',images:[{dataUrl:''}]})));
 const api=createPromptAssistant(config);
 assert.equal((await api.reverseImagePrompt(payload({action:'capabilities'}))).data.protocol,'nf.ui.grok-cpu.v1');
 const wrong=await api.reverseImagePrompt({...payload({action:'grok-vision-job'}),surface:'other'});assert.equal(wrong.ok,false);
 const job=await api.reverseImagePrompt(payload({action:'grok-vision-job',request:'霓虹都市主题，参考图1只提供布局',images:[image]}));
 assert.equal(job.ok,true,job.error);assert.equal(job.data.stage,'layout-style-identity');assert.equal(job.data.allowRetry,false);assert.equal(job.data.maxOutputTokens,8192);assert.deepEqual(job.data.images[0].imageSize,[1,1]);
 const compiled=await api.reverseImagePrompt(payload({action:'compile-grok-vision',request:fixture.theme,rawOutputText:fixture.rawOutputText}));
 assert.equal(compiled.ok,true,compiled.error);assert.equal(compiled.data.proof.all_target_art_fields_preserved_verbatim,true);assert.deepEqual(compiled.data.proof.grid,[3,3]);
 assert.equal(api.running,false);assert.equal(api.busy,false);
 const bad=await api.reverseImagePrompt(payload({action:'compile-grok-vision',request:fixture.theme,rawOutputText:'{"grid":{}}'}));assert.equal(bad.ok,false);assert.equal(api.running,false);
});

// Native flat Grok entry and failure routing are exercised by ui-native-production.test.mjs.

test('repair parser keeps exact requested fields from first complete valid object after malformed draft, without using later truncated repetition',()=>{
 const raw='未转义的草稿"GRAND"}\n</think>\n'+JSON.stringify({CARRIER1:'独立牌面显示“GRAND”“1000”，不含购买动作',CARRIER5:'一个连续显示面含“2 or more”“BONUS”“trigger bo”',style_context:'不能替换原全局方案'})+'\n</think>\n{"CARRIER1":"truncated';
 const fields=parseRepairFields(raw,['CARRIER1','CARRIER5'],'"CARRIER1":"');
 assert.equal(fields.value.CARRIER1,'独立牌面显示“GRAND”“1000”，不含购买动作');assert.equal(fields.value.CARRIER5,'一个连续显示面含“2 or more”“BONUS”“trigger bo”');
 assert.deepEqual(fields.proof.ignoredFields,['style_context']);assert.equal(fields.proof.artWordEdits,0);
});
