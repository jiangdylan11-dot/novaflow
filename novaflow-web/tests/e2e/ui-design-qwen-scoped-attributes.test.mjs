import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function runtime(){const root={setTimeout,clearTimeout};vm.createContext(root);for(const file of ['ui-design-prompt.pipeline.js','ui-design-assistant.workflow.js'])vm.runInContext(readFileSync(new URL('../../renderer/'+file,import.meta.url),'utf8'),root);return root;}
test('a one-button revision keeps literal lettering, actual reference roles and unaffected UI without redesign prose',()=>{
 const root=runtime(),references=[{id:'style',role:'style',dataUrl:'style'},{id:'canvas',role:'layout',dataUrl:'canvas'}],uiPlan={version:1,layoutReference:2,layoutMode:'preserve',visualMode:'partial',references:[{index:1,role:'style'},{index:2,role:'layout'}],layoutChanges:[],preserve:['图2余额250，其他按钮位置不变']};
 const result=root.NovaFlowUiDesignPromptPipeline.compileQwenPlan({prompt:'只把主按钮改为薄荷绿，按钮文案使用新的中文标签，其他保持。',uiPlan},{prompt:'只将图2主按钮改成图1的薄荷绿质感，按钮文字改为“继续 Start”，其余不变',generationIntent:'iteration',references,preserveLayout:true});
 assert.equal(result.references[0].id,'canvas');assert.match(result.prompt,/继续 Start/);assert.match(result.prompt,/余额250/);assert.match(result.prompt,/<image2>是风格来源/);assert.match(result.prompt,/不取布局、文字或人物/);assert.match(result.prompt,/其他区域的身份、布局、风格、光照与功能状态保持输入一致/);assert.doesNotMatch(result.prompt,/主题重设计只保留|重新设计组件构造、边框组织/);
});
test('native UI guidance fits the real 4000-character transport and separates visible text from edit prose',()=>{
 const root=runtime(),structure={width:1200,height:800,regions:[{x:100,y:50,width:400,height:600,purpose:'人物'}]},references=[{role:'layout',dataUrl:'canvas'},{role:'style',dataUrl:'style'}];
 const requirements=root.NovaFlowUiDesignAssistantWorkflow.buildRequirements({targetEngine:'qwen-2.1',prompt:'只改主按钮',size:structure,requirements:'保留文案'},structure,references);
 assert.ok(requirements.length<4000);assert.match(requirements,/未点名的区域用概括性保留条款/);assert.match(requirements,/画面文字独立/);assert.match(requirements,/简洁任务不凑字数/);
});
