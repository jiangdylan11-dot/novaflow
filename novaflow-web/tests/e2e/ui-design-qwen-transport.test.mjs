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
    if(payload.purpose==='ui-design-layout-facts')return {ok:true,prompt:'6列5行',uiPlan:{version:1,layoutMode:'preserve',layoutReference:1,visualMode:'partial',references:[{index:1,role:'combined'}],layoutChanges:[],preserve:['底部按钮不计入网格'],grids:[{description:'符号',columns:6,rows:5}]}};
    const token=payload.prompt.match(/__NOVAFLOW_[A-Z0-9_:-]+__/)[0];
    return {ok:true,prompt:'缩小'+token+'人物。',uiPlan:{version:1,layoutMode:'partial',layoutReference:1,visualMode:'partial',references:[{index:1,role:'layout'}],layoutChanges:['缩小'+token+'人物'],preserve:['其他区域不变'],grids:[{description:'符号',columns:6,rows:5}]}};
  }}});
  assert.equal(result.uiPlan.layoutChanges[0],'缩小@参考图1人物');assert.equal(result.prompt,'缩小@参考图1人物。');
  assert.equal(result.uiPlan.grids[0].rows,5);
});

test('layout counting sees the canvas alone and requires an independent matching grid reading',async()=>{
  const context={setTimeout,clearTimeout,console};vm.createContext(context);
  for(const name of ['ui-design-prompt.pipeline.js','ui-design-assistant.workflow.js'])vm.runInContext(readFileSync(new URL('../../renderer/'+name,import.meta.url),'utf8'),context);
  const calls=[];
  const result=await context.NovaFlowUiDesignAssistantWorkflow.run({provider:'local',engine:'grok',targetEngine:'qwen-2.1',sessionToken:'test',prompt:'太空科幻主题',references:[{dataUrl:'data:image/png;base64,style',role:'style'},{dataUrl:'data:image/png;base64,layout',role:'layout'}],electronAPI:{smartAiImageReverse:async payload=>{
    calls.push(payload);
    const first=payload.purpose==='ui-design-layout-facts';
    return {ok:true,prompt:first?'逐行数清六列五行':'机器人、空间站和能量晶体。',uiPlan:{version:1,layoutMode:'preserve',layoutReference:first?1:2,visualMode:first?'partial':'theme-redesign',references:first?[{index:1,role:'combined'}]:[{index:1,role:'style'},{index:2,role:'layout'}],layoutChanges:[],preserve:['底部五按钮'],grids:[{description:'符号阵列',columns:6,rows:5}]}};
  }}});
  assert.equal(calls.length,2);assert.equal(calls[0].images.length,1);assert.equal(calls[0].images[0].imageUrl,'data:image/png;base64,layout');
  assert.equal(calls[1].images.length,2);assert.doesNotMatch(calls[1].requirements,/逐行数清六列五行|columns|已单独清点/);
  assert.equal(result.uiPlan.grids[0].rows,5);
  const controller=new AbortController(),abortedCalls=[];
  await assert.rejects(context.NovaFlowUiDesignAssistantWorkflow.run({provider:'local',engine:'grok',targetEngine:'qwen-2.1',sessionToken:'test',signal:controller.signal,prompt:'新主题',references:[{dataUrl:'data:image/png;base64,layout-cancel',role:'layout'}],electronAPI:{smartAiImageReverse:async payload=>{
    abortedCalls.push(payload);controller.abort();return {ok:true,prompt:'数清',uiPlan:{version:1,layoutMode:'preserve',layoutReference:1,visualMode:'partial',references:[{index:1,role:'combined'}],layoutChanges:[],preserve:[],grids:[]}};
  }}}),/任务已中止/);
  assert.equal(abortedCalls.length,1);
  let mismatchCalls=0;
  await assert.rejects(context.NovaFlowUiDesignAssistantWorkflow.run({provider:'local',engine:'grok',targetEngine:'qwen-2.1',sessionToken:'test',prompt:'新主题',references:[{dataUrl:'data:image/png;base64,mismatch',role:'layout'}],electronAPI:{smartAiImageReverse:async payload=>{
    mismatchCalls++;const first=payload.purpose==='ui-design-layout-facts';
    return {ok:true,prompt:'编辑',uiPlan:{version:1,layoutMode:'preserve',layoutReference:1,visualMode:first?'partial':'theme-redesign',references:[{index:1,role:'combined'}],layoutChanges:[],preserve:[],grids:[{description:'网格',columns:6,rows:first?5:7}]}};
  }}}),/行列识别不一致/);
  assert.equal(mismatchCalls,2);
});
