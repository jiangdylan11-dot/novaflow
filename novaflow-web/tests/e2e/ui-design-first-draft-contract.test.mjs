import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function runtime(){const c={setTimeout,clearTimeout};vm.createContext(c);for(const f of ['ui-design-prompt.pipeline.js','ui-design-assistant.workflow.js'])vm.runInContext(readFileSync(new URL('../../renderer/'+f,import.meta.url),'utf8'),c);return c;}
const refs=[{id:'business-source',role:'layout',dataUrl:'data:image/png;base64,layout'},{id:'style-source',role:'style',dataUrl:'data:image/png;base64,style'}];
function compile(prompt,facts,references=refs,intent='redesign'){return runtime().NovaFlowUiDesignPromptPipeline.compileQwenPlan({prompt:'规划误写：保留旧主题外观',uiPlan:{version:1,layoutReference:references.findIndex(r=>r.role==='layout')+1,layoutMode:'preserve',visualMode:'theme-redesign',references:references.map((r,i)=>({index:i+1,role:r.role==='layout'?'layout':'content'})),layoutChanges:[],preserve:facts}},{prompt,references,preserveLayout:true,generationIntent:intent,...(intent==='iteration'?{editRegion:{x:0,y:0,width:80,height:80}}:{})});}
test('whole theme splits obsolete identities from amounts and controls in one Chinese preservation fact',()=>{
 for(const theme of ['糖果王国','埃及神殿','生肖庭院']){const r=compile('整屏重做为'+theme+'主题，功能位置和金额保持，图2只提供美术风格',['原角色身份保持不变，顶部余额¥250保持不变，3个操作控件功能不变','原图装饰道具位置不变','原符号外观与奖励金额120保持不变']);assert.match(r.prompt,/余额¥250/);assert.match(r.prompt,/3个操作控件功能不变/);assert.match(r.prompt,/奖励金额120/);assert.doesNotMatch(r.prompt,/原角色身份|原图装饰道具|原符号外观/);}
});
test('English old identities cannot survive in a business preservation list',()=>{
 const r=compile('换成糖果主题，保留业务功能',['Keep original character identity; balance 250 unchanged; retain 3 controls','Keep old scenery appearance and position']);assert.match(r.prompt,/balance 250 unchanged/);assert.match(r.prompt,/retain 3 controls/);assert.doesNotMatch(r.prompt,/original character identity|old scenery appearance/);
});
test('explicit human identity preservation survives a whole-theme request',()=>{
 const r=compile('更换糖果主题，但保留原角色身份，图2仅提供风格',['原角色身份保持不变','余额¥250']);assert.ok(r.plan.preserve.includes('原角色身份保持不变'));assert.match(r.prompt,/余额¥250/);
});
test('planner preservation facts cannot import text from a style or material source',()=>{
 const references=[refs[1],refs[0],{id:'second-style',role:'material',dataUrl:'data:image/png;base64,material'}],r=compile('图2是布局，图1只提供风格，图3只提供材质，整屏重做为深海主题',['图1奖励金额99999，金额77777，图2奖励金额250，余额200，图3规则文案LOGIN，控件REGISTER','图1原角色身份保持不变，余额88888'],references);assert.doesNotMatch(r.prompt,/99999|77777|88888|LOGIN|REGISTER/);assert.match(r.prompt,/250/);assert.match(r.prompt,/余额200/);assert.deepEqual(Array.from(r.references,x=>x.id),['business-source','style-source','second-style']);assert.deepEqual(Array.from(r.plan.references,x=>x.role),['layout','style','style']);assert.match(r.prompt,/<image1>奖励金额250/);
});
test('one role contract uses the remapped stable layout and both styles without planner contamination',()=>{
 const references=[refs[1],refs[0],{id:'second-style',role:'material',dataUrl:'data:image/png;base64,material'}],r=compile('整屏重做为深海主题，图2负责布局，图1与图3提供风格',['图2余额¥250'],references);assert.match(r.prompt,/<image1>是唯一布局与业务依据/);assert.match(r.prompt,/<image3>是质感来源，只取画风材质配色，不取布局、文字或人物/);assert.doesNotMatch(r.prompt,/规划误写/);assert.equal(r.prompt.split('是唯一布局与业务依据').length-1,1);assert.equal(r.references[0].dataUrl,refs[0].dataUrl);assert.equal(r.references[1].dataUrl,refs[1].dataUrl);
});
test('whole-theme planner separates ordinary object identity from business inventory',async()=>{
 const c=runtime();let request;await c.NovaFlowUiDesignAssistantWorkflow.run({provider:'local',engine:'local',targetEngine:'qwen-2.1',prompt:'整屏重做为糖果主题，图2仅供风格',references:refs,preserveLayout:true,generationIntent:'redesign',size:{width:720,height:1280},electronAPI:{promptAssistantReverseImagePrompt:async r=>{request=r;return {ok:true,prompt:r.currentPrompt};}}}).then(()=>assert.fail('a reply without a plan must not reach generation'),error=>assert.match(error.message,/规划不完整/));assert.match(request.requirements,/普通物件的原身份和外观不写入保留事实/);assert.match(request.requirements,/业务事实只来自/);assert.doesNotMatch(request.requirements,/准确行列和逐格实例、字母牌与重复符号关系/);assert.equal(request.images[1].role,'style');
});
test('strict reskin and local iteration keep original identities and detailed preservation',()=>{
 const reskin=compile('整屏纯换皮，保留造型与原角色，只改材质',['原角色身份保持不变','奖励金额120'],refs,'style-transfer');
 assert.ok(reskin.plan.preserve.includes('原角色身份保持不变'));assert.match(reskin.prompt,/每个盘的行列和逐格实例/);
 assert.doesNotMatch(reskin.prompt,/最终参考职责|旧题材的展示物与装饰须替换/);
 // A local iteration is a masked edit: it names what changes and keeps every other region as it is.
 const local=compile('只修改按钮颜色，原角色和奖励金额不变',['原角色身份保持不变','奖励金额120'],refs,'iteration');
 assert.ok(local.plan.preserve.includes('原角色身份保持不变'));assert.equal(local.plan.visualMode,'partial');
 assert.match(local.prompt,/只执行上述指定对象及属性的修改，其他区域的身份、布局、风格、光照与功能/);
 assert.doesNotMatch(local.prompt,/最终参考职责|旧题材的展示物与装饰须替换|主题重设/);
});
