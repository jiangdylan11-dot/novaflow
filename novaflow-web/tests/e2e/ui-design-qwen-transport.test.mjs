import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOptimizeRequest,normalizeReverseRequest} from '../../worker/src/prompt-assistant.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('local Qwen UI keeps its planner scope and long requirements across the worker boundary',()=>{
  const payload={surface:'ui-design',purpose:'ui-design-reference',targetEngine:'qwen-2.1',uiDesignIntent:'redesign',uiPreserveLayout:true,supportsNegativePrompt:false,requirements:'约束'.repeat(1750),images:[{dataUrl:'data:image/png;base64,AA==',role:'layout'}]};
  for(const normalize of [normalizeOptimizeRequest,normalizeReverseRequest]){
    const {request}=normalize(payload);
    assert.equal(request.targetEngine,'qwen-2.1');assert.equal(request.requirements,payload.requirements);
    assert.equal(request.uiPreserveLayout,true);assert.equal(request.supportsNegativePrompt,false);
    assert.equal(normalize({...payload,surface:'art'}).request.targetEngine,undefined);
  }
});

test('assistant restores image tokens in the partial-layout plan as well as its prompt',async()=>{
  const context={setTimeout,clearTimeout,console};vm.createContext(context);
  for(const name of ['ui-design-prompt.pipeline.js','ui-design-assistant.workflow.js'])vm.runInContext(readFileSync(new URL('../../renderer/'+name,import.meta.url),'utf8'),context);
  const result=await context.NovaFlowUiDesignAssistantWorkflow.run({provider:'local',engine:'grok',targetEngine:'qwen-2.1',sessionToken:'test',prompt:'缩小@参考图1的人物',references:[{dataUrl:'data:image/png;base64,AA==',role:'layout'}],electronAPI:{smartAiImageReverse:async payload=>{
    const token=payload.prompt.match(/__NOVAFLOW_[A-Z0-9_:-]+__/)[0];
    return {ok:true,prompt:'缩小'+token+'人物。',uiPlan:{version:1,layoutMode:'partial',layoutReference:1,visualMode:'partial',references:[{index:1,role:'layout'}],layoutChanges:['缩小'+token+'人物'],preserve:['其他区域不变']}};
  }}});
  assert.equal(result.uiPlan.layoutChanges[0],'缩小@参考图1人物');assert.equal(result.prompt,'缩小@参考图1人物。');
});
