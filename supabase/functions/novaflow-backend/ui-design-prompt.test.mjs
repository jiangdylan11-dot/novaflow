import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildGrokImageReverseRequest,buildGrokPromptOptimizeRequest,grokResponsesPublicResult} from './smart-ai-grok.workflow.mjs';

const payload={surface:'ui-design',purpose:'ui-design-reference',prompt:'做一个埃及木乃伊主题的老虎机，不需要保留任何元素',supportsNegativePrompt:false,uiDesignIntent:'redesign'};
test('UI image and text planning use the same dedicated contract and retain the original requirement',()=>{
  for(const request of [buildGrokPromptOptimizeRequest(payload),buildGrokImageReverseRequest({...payload,scenario:'role_reference',images:[{imageUrl:'data:image/png;base64,AA==',role:'reference'}]})]){
    assert.equal(request.resultOptions.uiDesignPrompt,true);
    assert.equal(request.resultOptions.artFiveSectionPrompt,undefined);
    assert.equal(request.body.text.format.name,'novaflow_ui_design_v1');
    const input=JSON.stringify(request.body.input);
    assert.ok(input.includes(payload.prompt));
    assert.match(input,/人物、背景、图标符号、边框装饰、按钮和面板/);
    assert.match(input,/矩形只是占位范围/);
    assert.match(input,/没有布局时/);
    assert.match(input,/网格准确行列数/);
    assert.match(input,/人物展示区.*全部保留/);
  }
});
test('style transfer preserves content identities and the original layout',()=>{
  const request=buildGrokPromptOptimizeRequest({...payload,prompt:'只把界面风格换成水彩',uiDesignIntent:'style-transfer'});
  const input=JSON.stringify(request.body.input);
  assert.match(input,/本次是风格迁移：保留内容图的功能/);
  assert.match(input,/人物身份和姿势、物品/);
  assert.match(input,/未要求改变的布局、区域占比、网格行列及数量不变/);
});
test('incomplete and drawing plans are refused while a complete UI plan reaches the result',()=>{
  const request=buildGrokPromptOptimizeRequest(payload);
  for(const prompt of ['木乃伊法老立于波涛之上','[风格设定]写实\n[主体物品]木乃伊','[界面目标]\n[参考用途]\n[布局与功能]\n[区域设计]\n[视觉规范]']){
    assert.throws(()=>grokResponsesPublicResult({output_text:JSON.stringify({prompt})},request.resultOptions),/UI 设计方案不完整/);
  }
  const prompt='[界面目标]\n埃及木乃伊老虎机。\n[参考用途]\n图1只借鉴功能关系。\n[布局与功能]\n顶部奖池，中间卷轴，底部操作。\n[区域设计]\n沙漠神殿背景，圣甲虫与象形纹章符号，纸莎草面板。\n[视觉规范]\n统一沙金与青蓝配色，数字清晰，按钮等距对齐。';
  assert.equal(grokResponsesPublicResult({output_text:JSON.stringify({prompt})},request.resultOptions).output_text,prompt);
  const token='__NOVAFLOW_UI_REFERENCE_1_0__';
  const protectedRequest=buildGrokPromptOptimizeRequest({...payload,prompt:'参考'+token+'换风格'});
  for(const answer of [prompt,prompt+'\n'+token+' '+token]) {
    const restored=grokResponsesPublicResult({output_text:JSON.stringify({prompt:answer})},protectedRequest.resultOptions).output_text;
    assert.equal(restored.split(token).length-1,1);
    assert.match(restored,/人物展示|沙漠神殿/);
  }
  const groundedRequest=buildGrokPromptOptimizeRequest({...payload,uiPreserveLayout:true});
  const guessed=prompt.replace('上方奖池、中间符号、底部操作。','中央改成3列4行，占满人物展示区域。');
  const grounded=grokResponsesPublicResult({output_text:JSON.stringify({prompt:guessed})},groundedRequest.resultOptions).output_text;
  assert.match(grounded,/沿用布局参考图的全部区域/);
  assert.doesNotMatch(grounded,/3列4行|占满人物展示区域/);
});
test('maintained admin and Edge share the UI planning implementation',()=>{
  const sources=['./smart-ai-grok.workflow.mjs','../../../novaflow-web/admin/admin-server/server.js'].map(p=>readFileSync(new URL(p,import.meta.url),'utf8').replaceAll('\r\n','\n'));
  const helper=s=>s.slice(s.indexOf('function isUiDesignPromptPayload('),s.indexOf('function buildGrokPromptOptimizeRequest('));
  assert.equal(helper(sources[0]),helper(sources[1]));
});

test('Qwen 2.1 planning carries independent layout and visual scopes through the public response',()=>{
  const request=buildGrokImageReverseRequest({...payload,targetEngine:'qwen-2.1',scenario:'role_reference',images:[{imageUrl:'data:image/png;base64,AA==',role:'layout'}]});
  assert.equal(request.body.text.format.name,'novaflow_ui_qwen21_v1');
  assert.equal(request.resultOptions.uiQwen21Plan,true);assert.equal(request.resultOptions.uiDesignPrompt,undefined);
  const ui_plan={version:1,layoutMode:'partial',layoutReference:1,visualMode:'theme-redesign',references:[{index:1,role:'layout'}],layoutChanges:['人物缩小20%'],preserve:['其他区域保持原位']};
  const result=grokResponsesPublicResult({output_text:JSON.stringify({prompt:'全新科幻界面，人物缩小20%。',ui_plan})},request.resultOptions);
  assert.deepEqual(result.uiPlan,ui_plan);assert.doesNotMatch(result.output_text,/沿用布局参考图的全部区域/);
  for(const patch of [{references:[]},{layoutReference:2},{layoutMode:'preserve'},{preserve:[]},{visualMode:'unknown'}]) {
    const recovered=grokResponsesPublicResult({output_text:JSON.stringify({prompt:'设计',ui_plan:{...ui_plan,...patch}})},request.resultOptions).uiPlan;
    assert.equal(recovered.layoutMode,'preserve');assert.equal(recovered.layoutReference,1);
  }
  const textRequest=buildGrokPromptOptimizeRequest({...payload,targetEngine:'qwen-2.1'});
  const create={version:1,layoutMode:'create',layoutReference:0,visualMode:'create',references:[],layoutChanges:[],preserve:[]};
  assert.deepEqual(grokResponsesPublicResult({output_text:JSON.stringify({prompt:'原创界面',ui_plan:create})},textRequest.resultOptions).uiPlan,create);
});

test('ordinary UI screenshot stays the layout source when planner fields are wrong',()=>{
  const request=buildGrokImageReverseRequest({surface:'ui-design',purpose:'ui-design-reference',targetEngine:'qwen-2.1',
    prompt:'参考图1的布局，生成一个高质量的2次元风格，生肖牛主题的老虎机。',uiPreserveLayout:true,scenario:'role_reference',
    images:[{imageUrl:'data:image/png;base64,AA==',role:'reference'}]});
  const wrong={version:1,layoutMode:'create',layoutReference:0,visualMode:'create',
    references:[{index:1,role:'style'}],layoutChanges:['重新排版'],preserve:[],grids:[]};
  const result=grokResponsesPublicResult({output_text:JSON.stringify({prompt:'将旧主题替换为中国风生肖牛老虎机。',ui_plan:wrong})},request.resultOptions);
  assert.equal(result.uiPlan.layoutMode,'preserve');
  assert.equal(result.uiPlan.layoutReference,1);
  assert.equal(result.uiPlan.visualMode,'theme-redesign');
  assert.deepEqual(result.uiPlan.references,[{index:1,role:'layout'}]);
  assert.deepEqual(result.uiPlan.layoutChanges,[]);
});

test('admin and Edge response adapters do not discard the Qwen plan',()=>{
  const admin=readFileSync(new URL('../../../novaflow-web/admin/admin-server/server.js',import.meta.url),'utf8');
  const edge=readFileSync(new URL('./index.ts',import.meta.url),'utf8');
  assert.equal((edge.match(/data\.uiPlan \? \{ uiPlan: data\.uiPlan \}/g)||[]).length,2);
  assert.equal((admin.match(/grok\.data\.uiPlan \? \{uiPlan:grok\.data\.uiPlan\}/g)||[]).length,2);
  const ordinary=admin.slice(admin.indexOf('if (options.ordinaryArtStructuredPrompt === true)'),admin.indexOf('if (options.ordinaryArtPromptPatch === true)'));
  assert.doesNotMatch(ordinary,/uiPlan/,'ordinary Drawing must not reference UI-only variables');
});

test('Qwen layout counting uses a separate deterministic request and validates actual counts',()=>{
  const request=buildGrokImageReverseRequest({...payload,targetEngine:'qwen-2.1',purpose:'ui-design-layout-facts',images:[{imageUrl:'data:image/png;base64,AA==',role:'reference'}]});
  assert.equal(request.body.temperature,0);
  assert.match(JSON.stringify(request.body.input),/没有画网格边线的对齐符号/);
  const ui_plan={version:1,layoutMode:'preserve',layoutReference:1,visualMode:'partial',references:[{index:1,role:'combined'}],layoutChanges:[],preserve:[],grids:[{description:'符号阵列',columns:6,rows:5}]};
  assert.equal(grokResponsesPublicResult({output_text:JSON.stringify({prompt:'每行六个，共五行',ui_plan})},request.resultOptions).uiPlan.grids[0].rows,5);
  for(const grids of [[{description:'符号',columns:6,rows:0}],[{description:'符号',columns:6,rows:1.5}],null])assert.throws(()=>grokResponsesPublicResult({output_text:JSON.stringify({prompt:'数清',ui_plan:{...ui_plan,grids}})},request.resultOptions),/规划不完整/);
});
