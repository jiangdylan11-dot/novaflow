import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const real=JSON.parse(readFileSync(new URL('./ui-design-inventory-forwarding.fixture.json',import.meta.url),'utf8'));
function compile({prompt=real.prompt,facts=real.uiPlan.preserve,user=real.provenance.originalPrompt,wireframe=false,references,iteration=false}={}) {
 const context={};vm.createContext(context);
 vm.runInContext(readFileSync(new URL('../../renderer/ui-design-prompt.pipeline.js',import.meta.url),'utf8'),context);
 const refs=references||[{role:'layout',dataUrl:'data:image/png;base64,layout',...(wireframe?{uiLayoutId:'guide'}:{})}];
 const plan={...real.uiPlan,references:refs.map((ref,index)=>({index:index+1,role:ref.role})),preserve:facts,visualMode:iteration?'partial':real.uiPlan.visualMode};
 return context.NovaFlowUiDesignPromptPipeline.compileQwenPlan({prompt,uiPlan:plan},{prompt:user,references:refs,preserveLayout:true,generationIntent:iteration?'iteration':'redesign'});
}
test('the new real planner partial preserve list does not discard observed business labels',()=>{
 const result=compile();
 assert.equal(real.provenance.newLivePlanner,true);
 for(const label of ['BUY FREE GAMES','TOTAL WIN','WILD','SCATTER'])assert.ok(result.prompt.includes(label),label);
 assert.equal(result.businessFactsSource,'plan+observed-labels');
 assert.deepEqual(Array.from(result.analysisPlan.preserve),real.uiPlan.preserve);
 // Keep the actual bad vision reading visible. No correct count or unseen amount is injected.
 assert.match(result.prompt,/5x4/);assert.doesNotMatch(result.prompt,/5[×x]3|5列3行|10,000|50,000|99\.00|96\.00|¥1000/);
 assert.ok(result.businessFacts.some(fact=>fact.includes('BUY FREE GAMES')&&fact.includes('TOTAL WIN')));
 assert.equal(result.prompt.split('BUY FREE GAMES').length-1,1);
});
test('explicit plan values stay authoritative over conflicting prose inventories',()=>{
 const result=compile({facts:['MEGA 25','sound'],prompt:'图1金额（MEGA 50000），功能栏（TOTAL WIN 96.00、menu）。中国风。'});
 assert.equal(result.businessFactsSource,'plan');assert.match(result.prompt,/MEGA 25/);assert.doesNotMatch(result.prompt,/50000|96\.00/);
});
test('guide diagnostics and unscoped multi-image prose cannot supply observed labels',()=>{
 const directive='功能栏（invented control、TOTAL WIN）。中国风。';
 assert.doesNotMatch(compile({wireframe:true,prompt:directive}).prompt,/invented control/);
 const references=[{role:'layout',dataUrl:'data:image/png;base64,layout'},{role:'style',dataUrl:'data:image/png;base64,style'}];
 assert.doesNotMatch(compile({prompt:directive,references}).prompt,/invented control/);
});
test('explicit human business changes and strict iteration retain their existing authority',()=>{
 const result=compile({user:'参考图1布局换中国风，删除原功能栏按钮',prompt:'图1功能栏（OLD BUTTON）。中国风。'});
 assert.doesNotMatch(result.prompt,/OLD BUTTON/);
 const partial=compile({iteration:true,user:'只修改菜单颜色，其他全部保持'});
 assert.equal(partial.businessFactsSource,'plan');assert.deepEqual(Array.from(partial.businessFacts),real.uiPlan.preserve);
});
test('an already preserved observed inventory is not duplicated',()=>{
 const labels='BUY FREE GAMES、TOTAL WIN、下注控件、操作按钮';
 const result=compile({facts:[...real.uiPlan.preserve,labels]});
 assert.equal(result.businessFactsSource,'plan');assert.equal(result.prompt.split('BUY FREE GAMES').length-1,1);
});
