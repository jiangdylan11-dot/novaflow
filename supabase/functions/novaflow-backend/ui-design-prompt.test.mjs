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
  }
});
test('incomplete and drawing plans are refused while a complete UI plan reaches the result',()=>{
  const request=buildGrokPromptOptimizeRequest(payload);
  for(const prompt of ['木乃伊法老立于波涛之上','[风格设定]写实\n[主体物品]木乃伊','[界面目标]\n[参考用途]\n[布局与功能]\n[区域设计]\n[视觉规范]']){
    assert.throws(()=>grokResponsesPublicResult({output_text:JSON.stringify({prompt})},request.resultOptions),/UI 设计方案不完整/);
  }
  const prompt='[界面目标]\n埃及木乃伊老虎机。\n[参考用途]\n图1只借鉴功能关系。\n[布局与功能]\n顶部奖池，中间卷轴，底部操作。\n[区域设计]\n沙漠神殿背景，圣甲虫与象形纹章符号，纸莎草面板。\n[视觉规范]\n统一沙金与青蓝配色，数字清晰，按钮等距对齐。';
  assert.equal(grokResponsesPublicResult({output_text:JSON.stringify({prompt})},request.resultOptions).output_text,prompt);
});
test('maintained admin and Edge share the UI planning implementation',()=>{
  const sources=['./smart-ai-grok.workflow.mjs','../../../novaflow-web/admin/admin-server/server.js'].map(p=>readFileSync(new URL(p,import.meta.url),'utf8').replaceAll('\r\n','\n'));
  const helper=s=>s.slice(s.indexOf('function isUiDesignPromptPayload('),s.indexOf('function buildGrokPromptOptimizeRequest('));
  assert.equal(helper(sources[0]),helper(sources[1]));
});
