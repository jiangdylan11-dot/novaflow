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

test('automatic editor guide takes priority over an earlier UI reference in the analysis request',async()=>{
 const context={setTimeout,clearTimeout,console};vm.createContext(context);
 for(const name of ['ui-design-prompt.pipeline.js','ui-design-assistant.workflow.js'])vm.runInContext(readFileSync(new URL('../../renderer/'+name,import.meta.url),'utf8'),context);
 let request;
 await context.NovaFlowUiDesignAssistantWorkflow.run({provider:'local',engine:'grok',targetEngine:'qwen-2.1',sessionToken:'test',prompt:'设计机器人界面',size:{width:1200,height:800},structure:{width:1200,height:800,regions:[{x:100,y:50,width:400,height:600,purpose:'人物'}]},references:[{role:'layout',dataUrl:'data:image/png;base64,old-screen'},{role:'layout',uiLayoutId:'new-layout',dataUrl:'data:image/png;base64,guide'}],electronAPI:{smartAiImageReverse:async payload=>{
  request=payload;
  return {ok:true,prompt:'将自建定位图设计成完整机器人界面',uiPlan:{version:1,layoutMode:'preserve',layoutReference:2,visualMode:'create',references:[{index:1,role:'layout'},{index:2,role:'layout'}],layoutChanges:[],preserve:[],grids:[]}};
 }}});
 assert.match(request.requirements,/图2是当前自建布局定位图，layoutReference必须使用它/);
 assert.equal(request.images.length,2);assert.notEqual(request.purpose,'ui-design-layout-facts');
});

test('assistant restores image tokens in the partial-layout plan as well as its prompt',async()=>{
  const context={setTimeout,clearTimeout,console};vm.createContext(context);
  for(const name of ['ui-design-prompt.pipeline.js','ui-design-assistant.workflow.js'])vm.runInContext(readFileSync(new URL('../../renderer/'+name,import.meta.url),'utf8'),context);
  const result=await context.NovaFlowUiDesignAssistantWorkflow.run({provider:'local',engine:'grok',targetEngine:'qwen-2.1',sessionToken:'test',prompt:'缩小@参考图1的人物',references:[{dataUrl:'data:image/png;base64,AA==',role:'layout'}],electronAPI:{smartAiImageReverse:async payload=>{
    const token=payload.prompt.match(/__NOVAFLOW_[A-Z0-9_:-]+__/)[0];
    return {ok:true,prompt:'缩小'+token+'人物。',uiPlan:{version:1,layoutMode:'partial',layoutReference:1,visualMode:'partial',references:[{index:1,role:'layout'}],layoutChanges:['缩小'+token+'人物'],preserve:['其他区域不变'],grids:[{description:'符号',columns:6,rows:5}]}};
  }}});
  assert.equal(result.uiPlan.layoutChanges[0],'缩小@参考图1人物');assert.equal(result.prompt,'缩小@参考图1人物。');
  assert.equal(result.uiPlan.grids[0].rows,5);
});

test('assistant keeps a single UI screenshot as layout when the request explicitly says unchanged',async()=>{
  const context={setTimeout,clearTimeout,console};vm.createContext(context);
  for(const name of ['ui-design-prompt.pipeline.js','ui-design-assistant.workflow.js'])vm.runInContext(readFileSync(new URL('../../renderer/'+name,import.meta.url),'utf8'),context);
  const result=await context.NovaFlowUiDesignAssistantWorkflow.run({provider:'local',engine:'grok',targetEngine:'qwen-2.1',sessionToken:'test',
    prompt:'参考图1，做一个中国风的生肖牛主题的老虎机，布局一样。',references:[{dataUrl:'data:image/png;base64,AA==',role:'reference'}],
    electronAPI:{smartAiImageReverse:async payload=>({ok:true,prompt:'将'+payload.prompt.match(/__NOVAFLOW_[A-Z0-9_:-]+__/)[0]+'改成生肖牛老虎机。',uiPlan:{version:1,layoutMode:'preserve',layoutReference:1,visualMode:'theme-redesign',references:[{index:1,role:'layout'}],layoutChanges:[],preserve:[]}})}});
  assert.equal(result.uiPlan.layoutReference,1);
  assert.equal(result.uiPlan.layoutMode,'preserve');
  assert.equal(result.uiPlan.visualMode,'theme-redesign');
  assert.equal(result.uiPlan.references[0].role,'layout');
});

test('packaged client stops when cloud planning rejects a valid layout reference',async()=>{
  const context={setTimeout,clearTimeout,console};vm.createContext(context);
  for(const name of ['ui-design-prompt.pipeline.js','ui-design-assistant.workflow.js'])vm.runInContext(readFileSync(new URL('../../renderer/'+name,import.meta.url),'utf8'),context);
  let sent,calls=0;
  await assert.rejects(context.NovaFlowUiDesignAssistantWorkflow.run({provider:'local',engine:'grok',targetEngine:'qwen-2.1',sessionToken:'test',
    prompt:'参考图1的布局，生成一个高质量的2次元风格，生肖牛主题的老虎机。',preserveLayout:true,generationIntent:'redesign',references:[{dataUrl:'data:image/png;base64,AA==',role:'reference'}],
    electronAPI:{smartAiImageReverse:async payload=>{sent=payload;calls++;throw new Error('Qwen 2.1 UI 设计规划不完整，请重试；本次未提交生成')},promptAssistantReverseImagePrompt:async()=>{throw new Error('must not change provider')}}}),/规划不完整/);
  assert.equal(calls,1);assert.equal(sent.images[0].role,'layout');
});

test('web runtime planning and authentication failures propagate without a fallback prompt',async()=>{
  const context={setTimeout,clearTimeout,console};vm.createContext(context);
  for(const name of ['ui-design-prompt.pipeline.js','ui-design-assistant.workflow.js'])vm.runInContext(readFileSync(new URL('../../renderer/'+name,import.meta.url),'utf8'),context);
  const input={provider:'local',engine:'grok',targetEngine:'qwen-2.1',sessionToken:'test',
    prompt:'参考图1的布局，生成一个高质量的2次元风格，生肖牛主题的老虎机。',preserveLayout:true,generationIntent:'redesign',
    references:[{dataUrl:'data:image/png;base64,AA==',role:'reference'}]};
  for(const error of ['2.1 UI 设计规划不完整，请重试；本次未提交生成','登录已过期']) {
    let calls=0;
    await assert.rejects(context.NovaFlowUiDesignAssistantWorkflow.run({...input,electronAPI:{smartAiImageReverse:async()=>{calls++;return {ok:false,error}}}}),new RegExp(error.split('，')[0]));
    assert.equal(calls,1);
  }
});

test('native UI planning uses all references once without an implicit grid-count gate',async()=>{
  const context={setTimeout,clearTimeout,console};vm.createContext(context);
  for(const name of ['ui-design-prompt.pipeline.js','ui-design-assistant.workflow.js'])vm.runInContext(readFileSync(new URL('../../renderer/'+name,import.meta.url),'utf8'),context);
  const calls=[];
  const result=await context.NovaFlowUiDesignAssistantWorkflow.run({provider:'local',engine:'grok',targetEngine:'qwen-2.1',sessionToken:'test',prompt:'太空科幻主题',references:[{dataUrl:'data:image/png;base64,style',role:'style'},{dataUrl:'data:image/png;base64,layout',role:'layout'}],electronAPI:{smartAiImageReverse:async payload=>{
    calls.push(payload);
    return {ok:true,prompt:'机器人、空间站和能量晶体。',uiPlan:{version:1,layoutMode:'preserve',layoutReference:2,visualMode:'theme-redesign',references:[{index:1,role:'style'},{index:2,role:'layout'}],layoutChanges:[],preserve:['底部操作保持原位'],grids:[]}};
  }}});
  assert.equal(calls.length,1);assert.equal(calls[0].images.length,2);
  assert.notEqual(calls[0].purpose,'ui-design-layout-facts');
  assert.equal(result.uiPlan.layoutReference,2);
  const controller=new AbortController(),abortedCalls=[];
  await assert.rejects(context.NovaFlowUiDesignAssistantWorkflow.run({provider:'local',engine:'grok',targetEngine:'qwen-2.1',sessionToken:'test',signal:controller.signal,prompt:'新主题',references:[{dataUrl:'data:image/png;base64,layout-cancel',role:'layout'}],electronAPI:{smartAiImageReverse:async payload=>{
    abortedCalls.push(payload);controller.abort();return {ok:true,prompt:'编辑',uiPlan:{version:1,layoutMode:'preserve',layoutReference:1,visualMode:'theme-redesign',references:[{index:1,role:'combined'}],layoutChanges:[],preserve:[],grids:[]}};
  }}}),/任务已中止/);
  assert.equal(abortedCalls.length,1);
});

test('assistant requires layout before transport and promotes the sole style image to layout',async()=>{
  const context={setTimeout,clearTimeout,console};vm.createContext(context);
  for(const name of ['ui-design-prompt.pipeline.js','ui-design-assistant.workflow.js'])vm.runInContext(readFileSync(new URL('../../renderer/'+name,import.meta.url),'utf8'),context);
  const requests=[],base={provider:'local',engine:'grok',targetEngine:'qwen-2.1',sessionToken:'test',prompt:'新主题组件构造设计',electronAPI:{smartAiImageReverse:async payload=>{requests.push(payload);return {ok:true,prompt:'重设计布局图组件',uiPlan:{version:1,layoutMode:'preserve',layoutReference:1,visualMode:'theme-redesign',references:[{index:1,role:'layout'}],layoutChanges:[],preserve:[]}};}}};
  await assert.rejects(context.NovaFlowUiDesignAssistantWorkflow.run({...base,references:[]}),/必须有布局图/);
  await assert.rejects(context.NovaFlowUiDesignAssistantWorkflow.run({...base,references:[{role:'style',dataUrl:'data:image/png;base64,style'},{role:'character',dataUrl:'data:image/png;base64,character'}]}),/缺少布局图/);
  assert.equal(requests.length,0);
  const result=await context.NovaFlowUiDesignAssistantWorkflow.run({...base,references:[{role:'style',dataUrl:'data:image/png;base64,only-image'}]});
  assert.equal(requests.length,1);assert.equal(requests[0].images[0].role,'layout');
  assert.match(requests[0].requirements,/只有一张图片时这张就是布局图/);
  assert.equal(result.uiPlan.layoutReference,1);assert.equal(result.uiPlan.layoutMode,'preserve');
});

test('UI dimensions stay literal while genuine reference identifiers are validated and reordered',()=>{
  const context={};vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../../renderer/ui-design-prompt.pipeline.js',import.meta.url),'utf8'),context);
  const references=[{role:'style',dataUrl:'data:image/png;base64,style'},{role:'layout',dataUrl:'data:image/png;base64,layout'}];
  const uiPlan={version:1,layoutMode:'preserve',layoutReference:2,visualMode:'partial',references:[{index:1,role:'style'},{index:2,role:'layout'}],layoutChanges:[],preserve:[],grids:[]};
  for(const dimension of ['1280×720','1280 x 720','1280X720','1280*720'])for(const prefix of ['完整布局图','参考图','@参考图']){
    const prompt=`${prefix}${dimension}，使用参考图2布局，参考图1配色，保留<image2>功能。`;
    const result=context.NovaFlowUiDesignPromptPipeline.compileQwenPlan({prompt,uiPlan},{prompt,references,generationIntent:'iteration',preserveLayout:true});
    assert.ok(result.prompt.includes(prefix+dimension));
    assert.match(result.prompt,/使用<image1>布局，<image2>配色，保留<image1>功能/);
    assert.equal(result.references[0].dataUrl,references[1].dataUrl);
  }
  for(const invalid of ['参考图3','图12','@参考图12','<image3>']){
    assert.throws(()=>context.NovaFlowUiDesignPromptPipeline.compileQwenPlan({prompt:invalid,uiPlan},{prompt:invalid,references,generationIntent:'iteration'}),/不存在的参考图/);
  }
});
