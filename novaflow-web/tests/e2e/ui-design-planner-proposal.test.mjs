import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
// Synthetic planner fixtures exercise data flow. None is a live model reply.
function pipeline(){const c={};vm.createContext(c);vm.runInContext(readFileSync(new URL('../../renderer/ui-design-prompt.pipeline.js',import.meta.url),'utf8'),c);return c.NovaFlowUiDesignPromptPipeline;}
const references=[{id:'layout',role:'layout',dataUrl:'data:image/png;base64,layout'},{id:'style',role:'style',dataUrl:'data:image/png;base64,style'}],brief='以图1布局换成糖果主题，图2参考风格，保留功能';
function compile(prompt,proposal,{facts=['图1奖励金额250','图1玩法盘5列3行'],refs=references,intent='redesign',visualMode='theme-redesign'}={}){const input={prompt,references:refs,preserveLayout:true,generationIntent:intent,...(intent==='iteration'?{editRegion:{x:0,y:0,width:80,height:80}}:{})},uiPlan={version:1,layoutMode:'preserve',layoutReference:refs.findIndex(r=>r.role==='layout')+1,visualMode,references:refs.map((r,i)=>({index:i+1,role:r.role==='layout'?'layout':'content'})),layoutChanges:[],preserve:facts};return pipeline().compileQwenPlan({prompt:proposal,uiPlan},input);}
test('short user brief retains concrete planner scene, material and component proposals',()=>{
 const r=compile(brief,'背景是一座漂浮糖果岛。人物采用穿薄荷斗篷的软糖精灵。主框使用奶油拱门承托与半透明糖玻璃边框。');for(const v of ['漂浮糖果岛','穿薄荷斗篷的软糖精灵','奶油拱门承托','半透明糖玻璃边框'])assert.ok(r.prompt.includes(v),v);assert.ok(r.prompt.includes('以<image1>布局换成糖果主题'));assert.match(r.prompt,/奖励金额250/);
});
test('human exclusions and fixed component shape reject only conflicting proposals',()=>{
 const r=compile(brief+'，不要熊和红色，主按钮保持圆形','主角是一只软糖熊。按钮采用红色。主按钮为矩形。背景采用漂浮糖果岛。主按钮用圆形薄荷凝胶壳。');assert.match(r.prompt,/不要熊和红色/);assert.match(r.prompt,/主按钮保持圆形/);assert.doesNotMatch(r.prompt,/主角是一只软糖熊|按钮采用红色|主按钮为矩形/);assert.match(r.prompt,/漂浮糖果岛/);assert.match(r.prompt,/圆形薄荷凝胶壳/);
});
test('reference style prose supplies visual detail without importing its labels or business values',()=>{
 const r=compile(brief,'图2提供薄荷绿凝胶质感。图2文案LOGIN。图2奖励金额99999。复制图2登录按钮。背景为奶油色糖果塔。');assert.match(r.prompt,/薄荷绿凝胶质感/);assert.match(r.prompt,/奶油色糖果塔/);assert.doesNotMatch(r.prompt,/LOGIN|99999|复制<image2>登录按钮/);assert.match(r.prompt,/奖励金额250/);assert.deepEqual(Array.from(r.references,x=>x.id),['layout','style']);
});
test('duplicate user text, planner clauses and observed business facts enter once',()=>{
 const r=compile(brief,brief+'。背景采用漂浮糖果岛。背景采用漂浮糖果岛。图1奖励金额250。',{facts:['图1奖励金额250']});assert.equal(r.prompt.split('以<image1>布局换成糖果主题').length-1,1);assert.equal(r.prompt.split('漂浮糖果岛').length-1,1);assert.equal(r.prompt.split('奖励金额250').length-1,1);
});
test('planner cannot invent amounts, grid dimensions or additional controls alongside visual detail',()=>{
 const r=compile(brief,'下注金额改为999。玩法盘5列4行。增加2个操作控件。保留原角色身份。背景为淡彩糖云。');assert.match(r.prompt,/淡彩糖云/);assert.doesNotMatch(r.prompt,/下注金额改为999|5列4行|增加2个操作控件|保留原角色身份/);assert.match(r.prompt,/5列3行/);
});
test('English exclusions retain an unrelated concrete scene proposal',()=>{
 const r=compile('replace theme with Candy; image2 supplies style; do not use robot or red','Scene uses floating sugar islands. Mascot is a robot. Buttons are red.');assert.match(r.prompt,/floating sugar islands/);assert.doesNotMatch(r.prompt,/Mascot is a robot|Buttons are red/);assert.match(r.prompt,/do not use robot or red/);
});
test('stable remapping preserves two style sources while retaining the actual visual proposal',()=>{
 const refs=[references[1],references[0],{id:'material',role:'material',dataUrl:'data:image/png;base64,material'}],r=compile('以图2布局换成糖果主题，图1参考风格，图3提供材质，保留功能','图1提供柔和糖霜高光。图3提供透亮凝胶质感。背景是漂浮糖果岛。',{refs,facts:['图2奖励金额250']});assert.match(r.prompt,/<image2>提供柔和糖霜高光/);assert.match(r.prompt,/<image3>提供透亮凝胶质感/);assert.deepEqual(Array.from(r.references,x=>x.id),['layout','style','material']);assert.deepEqual(Array.from(r.plan.references,x=>x.role),['layout','style','style']);assert.match(r.prompt,/<image1>奖励金额250/);
});
test('strict local scope never joins the whole-theme proposal branch',()=>{
 const r=compile('只修改主按钮为薄荷绿，背景与功能不变','只将主按钮重绘为薄荷绿凝胶，背景不变',{intent:'iteration'});assert.equal(r.plan.visualMode,'partial');assert.match(r.prompt,/只将主按钮重绘为薄荷绿凝胶/);assert.doesNotMatch(r.prompt,/规划补充|主题重设计只保留布局图的业务结构/);assert.match(r.prompt,/全部操作图标及功能状态逐项保留/);
});
test('pure reskin keeps construction without joining a whole-theme proposal',()=>{
 const r=compile('整屏纯换皮，保留整体造型，只改材质','整体组件构造重新设计；使用薄荷绿凝胶材质',{visualMode:'style-transfer',intent:'style-transfer'});assert.equal(r.plan.visualMode,'style-transfer');assert.match(r.prompt,/保留组件外轮廓/);assert.match(r.prompt,/薄荷绿凝胶材质/);assert.doesNotMatch(r.prompt,/整体组件构造重新设计|规划补充/);
});
test('an identical planner response does not repeat the brief as a proposal',()=>{
 const r=compile(brief,brief);assert.equal(r.prompt.split('以<image1>布局换成糖果主题').length-1,1);assert.doesNotMatch(r.prompt,/规划补充/);
});

test('explicitly retained character identity rejects a new character but keeps surface and scene proposals',()=>{
 const r=compile(brief+'，保留原角色身份','主角改为糖果精灵。角色采用浅蓝凝胶材质。背景采用漂浮糖果岛。');assert.doesNotMatch(r.prompt,/主角改为糖果精灵/);assert.match(r.prompt,/保留原角色身份/);assert.match(r.prompt,/浅蓝凝胶材质/);assert.match(r.prompt,/漂浮糖果岛/);
});
test('excluding an English color does not discard a redesign word and duplicate role declarations retain source isolation',()=>{
 const r=compile('replace theme with Candy; 图2参考风格; do not use red','图2参考风格。文案LOGIN。Scene is redesigned as floating sugar islands. Buttons are red.');assert.match(r.prompt,/redesigned as floating sugar islands/);assert.doesNotMatch(r.prompt,/LOGIN|Buttons are red/);
});

test('empty or whitespace user brief uses the planner directive once without duplicate supplementation',()=>{
 for(const brief of ['', '   ']){const r=compile(brief,'背景采用漂浮糖果岛。');assert.equal(r.prompt.split('漂浮糖果岛').length-1,1);assert.doesNotMatch(r.prompt,/规划补充/);}
});
