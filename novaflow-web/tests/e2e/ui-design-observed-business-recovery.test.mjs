import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function runtime(){const c={setTimeout,clearTimeout};vm.createContext(c);vm.runInContext(readFileSync(new URL('../../renderer/ui-design-prompt.pipeline.js',import.meta.url),'utf8'),c);return c.NovaFlowUiDesignPromptPipeline;}
function compile({directive,user='按图1业务内容和主要区域位置重做为梦幻糖果主题，金额文字与全部功能保持，图2是风格',facts=[],wireframe=false,layout=1,intent='redesign'}={}){
 const references=[{role:layout===1?'layout':'style',dataUrl:'data:image/png;base64,one'},{role:layout===2?'layout':'style',dataUrl:'data:image/png;base64,two'}];
 if(wireframe) references[layout-1].uiLayoutId='guide';
 const uiPlan={version:1,layoutReference:layout,layoutMode:'preserve',visualMode:'theme-redesign',references:references.map((r,i)=>({index:i+1,role:r.role})),layoutChanges:[],grids:[],preserve:facts};
 return runtime().compileQwenPlan({prompt:directive,uiPlan},{prompt:user,references,preserveLayout:true,generationIntent:intent});
}
// Inventory from the actual B planner reply; its real uiPlan.preserve was [].
const observed='将图1的完整界面按梦幻糖果主题重设计，顶部三个奖励档位名称与金额（MAJOR 10000、MEGA 50000、MINOR 50000）原位保留，中部5列3行玩法格子，底部功能栏（BUY FREE GAMES、TOTAL WIN 96.00、¥1000按钮、-、+、sound、quick spin、auto play、menu）原位保留。图2只参考画风。';
test('empty preserve recovers the actual observed jackpot and control inventory once',()=>{
 const r=compile({directive:observed});
 for(const fact of ['MAJOR 10000','MEGA 50000','MINOR 50000','TOTAL WIN 96.00','quick spin','menu']) assert.equal(r.prompt.split(fact).length-1,1,fact);
 assert.equal(r.businessFactsSource,'observed-directive');assert.equal(r.plan.preserve.length,2);assert.equal(r.analysisPlan.preserve.length,0);
 assert.ok(r.prompt.length<900);assert.match(r.prompt,/旧题材的展示物与装饰须替换为新题材物件，不只改材质/);assert.match(r.prompt,/除用户明确保留的身份外/);
});
test('style-image amounts are excluded while an image2 layout inventory is remapped',()=>{
 const r=compile({layout:2,user:'图2是业务布局，图1只提供风格，重做为糖果主题，金额功能保持',directive:'图1风格金额（MEGA 99999）。图2布局金额（REWARD 42），功能栏（menu、TOTAL 8）。'});
 assert.doesNotMatch(r.prompt,/99999/);assert.match(r.prompt,/REWARD 42/);assert.equal(r.plan.layoutReference,1);
});
test('guide diagnostics and source-less multiple-image prose do not become business facts',()=>{
 assert.doesNotMatch(compile({wireframe:true,directive:observed}).prompt,/MEGA 50000|96\.00/);
 assert.doesNotMatch(compile({directive:'金额（MEGA 77777），功能栏（mystery control）'}).prompt,/77777|mystery control/);
});
test('human business changes override inferred inventories and valid plan facts stay authoritative',()=>{
 const changed=compile({user:'图1重做糖果主题，金额改为20，图2只提供风格',directive:observed});assert.doesNotMatch(changed.prompt,/MEGA 50000|96\.00/);assert.match(changed.prompt,/金额改为20/);
 const planned=compile({directive:observed,facts:['MEGA 25','sound']});assert.match(planned.prompt,/MEGA 25/);assert.doesNotMatch(planned.prompt,/50000|96\.00/);assert.equal(planned.businessFactsSource,'plan');
});
test('iteration retains the existing detailed preservation contract',()=>{
 const r=compile({directive:observed,intent:'iteration'});assert.doesNotMatch(r.prompt,/旧题材的展示物与装饰须替换为新题材物件，不只改材质/);assert.equal(r.businessFactsSource,'none');
});
